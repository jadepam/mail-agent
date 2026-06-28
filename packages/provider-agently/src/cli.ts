/**
 * agently-cli invocation wrapper — execute CLI via child_process, parse JSON output
 *
 * Core Design: Zero credential passing
 * - agently-cli manages OAuth tokens itself (stored in macOS Keychain / Linux Secret Service)
 * - This module only calls CLI commands and parses output; it never touches credentials
 */

import { execFileSync } from 'child_process'
import type { MailError } from '@mail-agent/core'
import { MailErrorClass } from '@mail-agent/core'

// ── CLI Output Types ──

/** agently-cli standard success output */
export interface CliOkResult<T = unknown> {
  ok: true
  data: T
}

/** agently-cli standard error output */
export interface CliErrorResult {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type AgentlyCliResult<T = unknown> = CliOkResult<T> | CliErrorResult

// ── Agently Data Types (aligned with CLI output) ──

export interface AgentlyAddress {
  email: string
  name: string
}

export interface AgentlyMessage {
  message_id: string
  from: AgentlyAddress
  to: AgentlyAddress[]
  subject: string
  snippet: string
  body?: string
  body_format?: string
  created_at: string
  is_read: boolean
  has_attachments: boolean
  dir?: {
    dir_id: number
    dir_name: string
  }
  attachments?: AgentlyAttachment[]
  rfc_message_id?: string
}

export interface AgentlyAttachment {
  attachment_id: string
  filename: string
  content_type: string
  size: number
}

export interface AgentlyListResult {
  data: AgentlyMessage[]
  pagination: {
    has_more: boolean
    next_cursor: string
  }
}

export interface AgentlySendResult {
  confirmation_required: boolean
  confirmation_token?: string
  summary?: string
  message_id?: string
}

export interface AgentlyMeResult {
  aliases: Array<{
    alias_id: string
    email: string
    is_primary: boolean
    name: string
  }>
}

export interface AgentlyAuthStatus {
  logged_in: boolean
  status: string
  token_status: string
}

// ── CLI Execution ──

/** Default CLI command name */
const DEFAULT_CLI_PATH = 'agently-cli'

/** Global CLI path (overridable) */
let cliPath = DEFAULT_CLI_PATH

/** Set agently-cli path (for testing or custom install paths) */
export function setCliPath(path: string): void {
  cliPath = path
}

/** Get current CLI path */
export function getCliPath(): string {
  return cliPath
}

/** Reset to default path */
export function resetCliPath(): void {
  cliPath = DEFAULT_CLI_PATH
}

/**
 * Execute agently-cli command and parse JSON output
 *
 * @param args  Command arguments (e.g. ['message', '+list', '--limit', '10'])
 * @returns     Parsed JSON result
 * @throws      Error when CLI execution fails or output is not valid JSON
 */
export function runCli<T = unknown>(args: string[]): AgentlyCliResult<T> {
  try {
    const stdout = execFileSync(cliPath, args, {
      encoding: 'utf-8',
      timeout: 30_000, // 30 second timeout
      maxBuffer: 10 * 1024 * 1024, // 10 MB buffer (for large email bodies)
      env: { ...process.env },
    })

    // agently-cli may output JSON followed by a tip line; only take the JSON part
    const parsed = parseCliOutput(stdout)
    if (!parsed) {
      throw new Error(`agently-cli output parse failed: ${stdout.slice(0, 200)}`)
    }
    return parsed
  } catch (err: any) {
    // CLI execution failed (non-zero exit code)
    if (err.status && err.stdout) {
      const parsed = parseCliOutput(err.stdout)
      if (parsed) return parsed as AgentlyCliResult<T>
    }

    // CLI not found
    if (err.code === 'ENOENT') {
      throw new Error(
        `agently-cli not found, please install first: npm install -g agently-cli\n` +
          `Or set a custom path: setCliPath('/path/to/agently-cli')`,
      )
    }

    throw new Error(`agently-cli execution failed: ${err.message}`)
  }
}

/**
 * Parse CLI output (multi-line JSON + optional tip line)
 *
 * agently-cli output format:
 *   {                 ← JSON start
 *     "ok": true,
 *     "data": { ... }
 *   }                 ← JSON end
 *   tip: ...          ← Optional tip line
 */
function parseCliOutput(stdout: string): AgentlyCliResult | null {
  const trimmed = stdout.trim()
  if (!trimmed) return null

  // Strategy 1: Try parsing the whole string (stdout is pure JSON)
  try {
    return JSON.parse(trimmed)
  } catch {}

  // Strategy 2: Find the first { and last } positions, extract substring to parse
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const jsonStr = trimmed.substring(firstBrace, lastBrace + 1)
    try {
      return JSON.parse(jsonStr)
    } catch {}
  }

  return null
}

/**
 * Check agently-cli authentication status
 * Called before connecting to ensure login and valid token
 *
 * @throws E1002 error when not logged in or token is invalid
 */
export function ensureAuth(): void {
  const result = runCli<AgentlyAuthStatus>(['auth', 'status'])

  if (!result || !result.ok) {
    throw {
      code: 'E1002',
      providerCode: result?.error?.code || 'auth_check_failed',
      message: result?.error?.message || 'Agently Mail auth check failed, please run: agently-cli auth login',
      retryable: false,
    } satisfies MailError
  }

  const status = result.data

  // Not logged in
  if (!status.logged_in) {
    throw {
      code: 'E1002',
      providerCode: 'auth_not_logged_in',
      message: 'Agently Mail not logged in, please run first: agently-cli auth login',
      retryable: false,
    } satisfies MailError
  }

  // Token expired, attempt refresh
  if (status.token_status === 'expired' || status.token_status === 'invalid') {
    const refreshResult = runCli<AgentlyAuthStatus>(['auth', 'refresh'])
    if (!refreshResult.ok || !refreshResult.data.logged_in) {
      throw {
        code: 'E1002',
        providerCode: 'auth_refresh_failed',
        message: 'Agently Mail token refresh failed, please re-run: agently-cli auth login',
        retryable: false,
      } satisfies MailError
    }
  }
}

/**
 * Get current Agently user info
 */
export function getMe(): AgentlyMeResult {
  const result = runCli<AgentlyMeResult>(['+me'])
  if (!result.ok) {
    throw mapCliError(result.error, 'E5002')
  }
  return result.data
}

/**
 * Map CLI error to MailError
 */
function mapCliError(error: { code: string; message: string }, defaultCode: string): MailError {
  // Map based on agently-cli exit codes
  const codeMap: Record<string, string> = {
    '1': 'E1001', // Connection/network error
    '2': 'E4001', // Parameter error
    '3': 'E1002', // Authorization expired
    '6': 'E2001', // Business permanent rejection
    '7': 'E3001', // Rate limit triggered
    '8': 'E0008', // Confirmation token required (internal handling)
  }

  return {
    code: codeMap[error.code] || defaultCode,
    providerCode: error.code,
    message: error.message,
    retryable: error.code === '1' || error.code === '7',
  }
}

/**
 * 退出码到 MailError 的映射（供 provider 使用）
 */
export function mapExitCodeToError(exitCode: number, message: string): MailError {
  const codeMap: Record<number, string> = {
    1: 'E1001',
    2: 'E4001',
    3: 'E1002',
    6: 'E2001',
    7: 'E3001',
    8: 'E0008',
  }

  const retryableMap: Record<number, boolean> = {
    1: true,
    7: true,
  }

  return new MailErrorClass({
    code: codeMap[exitCode] || 'E5001',
    providerCode: String(exitCode),
    message,
    retryable: retryableMap[exitCode] || false,
  })
}
