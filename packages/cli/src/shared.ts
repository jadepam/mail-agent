/**
 * Shared utility functions between CLI and MCP Server
 *
 * Extracted from repeated code in index.ts and mcp-server.ts:
 * - cliResult: Unified JSON output format
 * - parseAddresses: Address string parsing
 * - summarizeMail: Mail summary (for list/search, excludes body)
 * - summarizeMailDetail: Mail detail (for read, includes body)
 * - shouldConfirm: Mode detection (Human Mode / AI Mode)
 * - confirmAction: Interactive confirmation prompt (prompts for destructive ops in Human Mode)
 */

import inquirer from 'inquirer'
import { loadConfig, getAccount, persistRefreshedToken } from './config.js'
import { createProvider } from './factory.js'
import type { Mail, MailProvider, AccountConfig, CliResult } from '@mail-agent/core'

/** Unified CLI / MCP JSON output format */
export function cliResult<T = unknown>(ok: boolean, data?: T, error?: string): CliResult<T> {
  return { ok, data, ...(error ? { error } : {}) }
}

/**
 * Parse JSON from CLI output (multi-line JSON + tip lines)
 * Shared by scanner.ts, account.ts, init.ts
 */
export function parseCliJson(stdout: string): any {
  const trimmed = stdout.trim()
  try {
    return JSON.parse(trimmed)
  } catch {}
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.substring(firstBrace, lastBrace + 1))
    } catch {}
  }
  return null
}

/** Parse address strings ("Name <email>" or plain "email") into structured address arrays */
export function parseAddresses(raw: string): { name: string; address: string }[] {
  return raw.split(',').map((s) => {
    const trimmed = s.trim()
    const match = trimmed.match(/^(.+?)\s*<(.+?)>$/)
    if (match) return { name: match[1].trim(), address: match[2].trim() }
    return { name: '', address: trimmed }
  })
}

/** Mail summary (for list/search, excludes body) */
export function summarizeMail(mail: Mail) {
  return {
    id: mail.id,
    thread_id: mail.threadId || undefined,
    from: mail.from.name ? `${mail.from.name} <${mail.from.address}>` : mail.from.address,
    to: mail.to.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)),
    subject: mail.subject,
    date: mail.date.toISOString(),
    read: mail.read,
    starred: mail.starred,
    attachments: mail.attachments.length > 0 ? mail.attachments.map((a) => a.filename) : undefined,
    account: mail.accountAlias,
  }
}

/** Mail detail (for read, includes body) */
export function summarizeMailDetail(mail: Mail) {
  return {
    id: mail.id,
    thread_id: mail.threadId || undefined,
    from: mail.from.name ? `${mail.from.name} <${mail.from.address}>` : mail.from.address,
    to: mail.to.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)),
    cc: mail.cc.length > 0 ? mail.cc.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)) : undefined,
    subject: mail.subject,
    date: mail.date.toISOString(),
    read: mail.read,
    starred: mail.starred,
    body: mail.body.text || '(no body)',
    attachments:
      mail.attachments.length > 0 ? mail.attachments.map((a) => ({ filename: a.filename, size: a.size })) : undefined,
    account: mail.accountAlias,
  }
}

// ── Human Mode / AI Mode ──

/**
 * Determine whether interactive confirmation is needed (Human Mode vs AI Mode)
 *
 * Priority: --json > --yes / -y > config.mode > default human
 * - --json implicitly skips confirmation (programmatic JSON consumers shouldn't prompt)
 * - --yes / -y explicitly skips confirmation
 * - config.yaml mode: ai permanently skips confirmation
 * - Default human mode: requires confirmation
 */
export function shouldConfirm(opts: { yes?: boolean; json?: boolean }, config: { mode?: 'human' | 'ai' }): boolean {
  // --json implies AI mode (structured output consumed by programs, no interactive prompt)
  if (opts.json) return false

  // --yes / -y: explicitly skip confirmation
  if (opts.yes) return false

  // config.yaml mode: ai
  if (config.mode === 'ai') return false

  // Default: human mode, requires confirmation
  return true
}

/**
 * Interactive confirmation prompt -- requests user confirmation for destructive ops in human mode
 * @param message Confirmation prompt message, e.g. "Confirm send?"
 * @returns true if user confirms, false if user declines
 */
export async function confirmAction(message: string): Promise<boolean> {
  const { confirmed } = await inquirer.prompt<{
    confirmed: boolean
  }>([
    {
      type: 'confirm',
      name: 'confirmed',
      message,
      default: false,
    },
  ])
  return confirmed
}

/**
 * Connect to a mail provider for the given account alias
 *
 * Used by CLI commands to resolve account config, create provider, and connect.
 * The caller is responsible for calling provider.disconnect() and persistRefreshedToken()
 * in a finally block after use.
 */
export async function connectProvider(
  config: ReturnType<typeof loadConfig>,
  alias?: string,
): Promise<{ provider: MailProvider; accountConfig: AccountConfig }> {
  const accountConfig = getAccount(config, alias)
  if (!accountConfig) {
    if (alias) {
      console.error(`❌ Account alias "${alias}" not found. Run ma +me to see available accounts`)
    } else {
      console.error('❌ No email accounts configured')
      console.error('   Run ma init for quick setup, or ma account add to add manually')
    }
    process.exit(1)
  }

  const provider = createProvider(accountConfig)
  await provider.connect(accountConfig)
  return { provider, accountConfig }
}
