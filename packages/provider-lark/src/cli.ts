/**
 * lark-cli invocation wrapper — execute CLI via child_process, parse JSON output
 *
 * Core Design: Zero credential passing
 * - lark-cli manages OAuth tokens itself; this module only calls CLI commands and parses output
 * - v1 only supports user identity (--as user) for full read/write access
 */

import { execFileSync } from 'child_process'
import type { MailError } from '@mail-agent/core'
import { MailErrorClass } from '@mail-agent/core'

// ── CLI Output Types ──

/** lark-cli standard success output */
export interface CliOkResult<T = unknown> {
  ok: true
  data: T
}

/** lark-cli standard error output */
export interface CliErrorResult {
  ok: false
  error: {
    code: string
    message: string
  }
}

export type LarkCliResult<T = unknown> = CliOkResult<T> | CliErrorResult

// ── Lark Data Types (aligned with lark-cli +message / +triage output) ──

export interface LarkAddress {
  mail_address: string
  name: string
}

export interface LarkAttachment {
  id: string
  filename: string
  content_type: string
  attachment_type: number // 1=normal, 2=oversized
  is_inline: boolean
  cid?: string // Content-ID for inline images
  size?: number
}

export interface LarkSecurityLevel {
  is_risk: boolean
  risk_banner_level?: 'WARNING' | 'DANGER' | 'INFO'
  risk_banner_reason?: string
  is_header_from_external?: boolean
}

export interface LarkMessage {
  message_id: string
  thread_id?: string
  smtp_message_id?: string
  subject: string
  head_from: LarkAddress
  to: LarkAddress[]
  cc: LarkAddress[]
  bcc: LarkAddress[]
  date: string
  internal_date?: string
  date_formatted?: string
  in_reply_to?: string
  reply_to?: string
  references?: string[]
  message_state?: number // 1=received, 2=sent, 3=draft
  message_state_text?: string // "received"/"sent"/"draft"
  folder_id?: string // "INBOX"/"SENT"/"SPAM"/"ARCHIVED"/"STRANGER" or custom
  label_ids?: string[]
  priority_type?: number
  priority_type_text?: string
  draft_id?: string
  body_plain_text?: string
  body_preview?: string
  body_html?: string
  attachments: LarkAttachment[]
  security_level?: LarkSecurityLevel
}

/** +triage list result (message summaries) */
export interface LarkTriageResult {
  messages: LarkTriageMessage[]
  mailbox_id: string
  count: number
  has_more: boolean
  page_token: string
}

/** +triage message summary (lighter than full LarkMessage) */
export interface LarkTriageMessage {
  message_id: string
  mailbox_id: string
  date: string
  from: string // formatted string like "Alice <alice@example.com>"
  subject: string
  labels: string // comma-separated, e.g. "INBOX,UNREAD"
}

/** +thread result */
export interface LarkThreadResult {
  thread_id: string
  message_count: number
  messages: LarkMessage[]
}

/** +send / +reply / +forward result (confirm-send mode) */
export interface LarkSendResult {
  message_id?: string
  thread_id?: string
  draft_id?: string
  tip?: string
  automation_send_disable_reason?: string
  automation_send_disable_reference?: string
  recall_available?: boolean
  recall_tip?: string
}

/** auth status result */
export interface LarkAuthStatus {
  logged_in: boolean
  status: string
  token_status?: string
}

/** +me result — user mailbox profile */
export interface LarkMeResult {
  primary_email_address?: string
  user_mailbox_id?: string
  aliases?: Array<{
    email: string
    name: string
    is_primary: boolean
  }>
}

// ── CLI Execution ──

/** Default CLI command name */
const DEFAULT_CLI_PATH = 'lark-cli'

/** Global CLI path (overridable for testing) */
let cliPath = DEFAULT_CLI_PATH

/** Set lark-cli path (for testing or custom install paths) */
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

/** v1 identity flag — always use user identity */
const IDENTITY_ARGS = ['--as', 'user']

/**
 * Execute lark-cli command and parse JSON output
 *
 * @param args  Command arguments (e.g. ['mail', '+triage', '--max', '20'])
 * @returns     Parsed JSON result
 * @throws      Error when CLI execution fails or output is not valid JSON
 */
export function runCli<T = unknown>(args: string[]): LarkCliResult<T> {
  try {
    const fullArgs = [...args, ...IDENTITY_ARGS]
    const stdout = execFileSync(cliPath, fullArgs, {
      encoding: 'utf-8',
      timeout: 30_000, // 30 second timeout
      maxBuffer: 10 * 1024 * 1024, // 10 MB buffer (for large email bodies)
      env: { ...process.env },
    })

    const parsed = parseCliOutput(stdout)
    if (!parsed) {
      throw new Error(`lark-cli output parse failed: ${stdout.slice(0, 200)}`)
    }
    return parsed
  } catch (err: any) {
    // CLI execution failed (non-zero exit code) — try to parse error from stdout
    if (err.status && err.stdout) {
      const parsed = parseCliOutput(err.stdout)
      if (parsed) return parsed as LarkCliResult<T>
    }

    // CLI not found
    if (err.code === 'ENOENT') {
      throw new Error(
        `lark-cli not found, please install first: npx @larksuite/cli@latest install\n` +
          `Or set a custom path: setCliPath('/path/to/lark-cli')`,
      )
    }

    throw new Error(`lark-cli execution failed: ${err.message}`)
  }
}

/**
 * Parse CLI output (multi-line JSON + optional tip line)
 *
 * lark-cli output format:
 *   {                 ← JSON start
 *     "ok": true,
 *     "data": { ... }
 *   }                 ← JSON end
 *   tip: ...          ← Optional tip line
 */
function parseCliOutput(stdout: string): LarkCliResult | null {
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
 * Check lark-cli authentication status (user identity)
 * Called before connecting to ensure login and valid token
 *
 * @throws E1002 error when not logged in or token is invalid
 */
export function ensureAuth(): void {
  const result = runCli<LarkAuthStatus>(['auth', 'status'])

  if (!result || !result.ok) {
    throw {
      code: 'E1002',
      providerCode: result?.error?.code || 'auth_check_failed',
      message: result?.error?.message || 'Lark Mail auth check failed, please run: lark-cli auth login --domain mail',
      retryable: false,
    } satisfies MailError
  }

  const status = result.data

  // Not logged in
  if (!status.logged_in) {
    throw {
      code: 'E1002',
      providerCode: 'auth_not_logged_in',
      message: 'Lark Mail not logged in, please run first: lark-cli auth login --domain mail',
      retryable: false,
    } satisfies MailError
  }

  // Token expired, attempt refresh
  if (status.token_status === 'expired' || status.token_status === 'invalid') {
    const refreshResult = runCli<LarkAuthStatus>(['auth', 'refresh'])
    if (!refreshResult.ok || !refreshResult.data.logged_in) {
      throw {
        code: 'E1002',
        providerCode: 'auth_refresh_failed',
        message: 'Lark Mail token refresh failed, please re-run: lark-cli auth login --domain mail',
        retryable: false,
      } satisfies MailError
    }
  }
}

/**
 * Get current Lark user info
 */
export function getMe(): LarkMeResult {
  const result = runCli<LarkMeResult>(['+me'])
  if (!result.ok) {
    throw mapCliError(result.error, 'E5002')
  }
  return result.data
}

/**
 * Map CLI error to MailError
 */
function mapCliError(error: { code: string; message: string }, defaultCode: string): MailError {
  // Map based on lark-cli exit codes
  const codeMap: Record<string, string> = {
    '1': 'E1001', // Connection/network error
    '2': 'E4001', // Parameter error
    '3': 'E1002', // Authorization expired
    '6': 'E2001', // Business permanent rejection
    '7': 'E3001', // Rate limit triggered
    '10': 'E4003', // Confirmation gate (high-risk write without --yes)
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
    10: 'E4003',
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
