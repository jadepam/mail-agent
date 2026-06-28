/**
 * Local email scanner — automatically discovers locally available email accounts
 *
 * Scan sources:
 * 1. agently-cli — detect if installed, if logged in, read authorized emails
 * 2. lark-cli — detect if installed, if logged in, read authorized Lark mail emails
 * 3. Existing config — read existing accounts from ~/.mail-agent/config.yaml (avoid duplicate additions)
 *
 * Usage scenarios:
 * - `ma init` setup wizard
 * - `ma account add` manual addition prompts
 */

import { execFileSync } from 'child_process'
import type { AccountConfig } from '@mail-agent/core'
import { parseCliJson } from './shared.js'

// ── 扫描结果 ──

export interface DiscoveredAccount {
  /** Email address */
  email: string
  /** Source */
  source: 'agently-cli' | 'lark-cli'
  /** Provider type */
  provider: AccountConfig['provider']
  /** Whether already in configuration */
  alreadyConfigured: boolean
  /** Additional info */
  detail?: string
}

export interface ScanResult {
  /** Discovered account list */
  accounts: DiscoveredAccount[]
  /** Warnings/messages during scanning */
  warnings: string[]
}

// ── Scanner ──

/**
 * Scan locally discoverable email accounts
 *
 * @param existingAccounts  Already configured account list (used to mark alreadyConfigured)
 */
export function scanLocalAccounts(existingAccounts: AccountConfig[] = []): ScanResult {
  const accounts: DiscoveredAccount[] = []
  const warnings: string[] = []

  // Already configured email addresses (for deduplication)
  const configuredEmails = new Set(existingAccounts.map((a) => a.user?.toLowerCase()).filter(Boolean))

  // ── Scan agently-cli ──
  const agentlyResults = scanAgentlyCli(configuredEmails)
  accounts.push(...agentlyResults.accounts)
  warnings.push(...agentlyResults.warnings)

  // ── Scan lark-cli ──
  const larkResults = scanLarkCli(configuredEmails)
  accounts.push(...larkResults.accounts)
  warnings.push(...larkResults.warnings)

  return { accounts, warnings }
}

/**
 * Scan authorized emails from agently-cli
 */
function scanAgentlyCli(configuredEmails: Set<string>): { accounts: DiscoveredAccount[]; warnings: string[] } {
  const accounts: DiscoveredAccount[] = []
  const warnings: string[] = []

  // 1. Detect if agently-cli is installed
  let cliInstalled = false
  try {
    execFileSync('which', ['agently-cli'], { encoding: 'utf-8', stdio: 'pipe' })
    cliInstalled = true
  } catch {
    // agently-cli not installed, skip
  }

  if (!cliInstalled) {
    return { accounts, warnings }
  }

  // 2. Detect if logged in
  let loggedIn = false
  try {
    const statusOutput = execFileSync('agently-cli', ['auth', 'status'], { encoding: 'utf-8' })
    const statusJson = parseCliJson(statusOutput)
    loggedIn = statusJson?.data?.logged_in === true
  } catch {
    warnings.push('agently-cli is installed but not logged in. Run `agently-cli auth login` to authorize')
  }

  if (!loggedIn) {
    // Installed but not logged in, still report as a "discoverable" account (prompt user to log in)
    accounts.push({
      email: '(Not logged in)',
      source: 'agently-cli',
      provider: 'agently',
      alreadyConfigured: false,
      detail: 'agently-cli is installed but not logged in. Run `agently-cli auth login` first',
    })
    return { accounts, warnings }
  }

  // 3. Read authorized email addresses
  try {
    const meOutput = execFileSync('agently-cli', ['+me'], { encoding: 'utf-8' })
    const meJson = parseCliJson(meOutput)

    const aliases = meJson?.data?.aliases || []
    for (const alias of aliases) {
      const email = alias.email || ''
      if (!email) continue

      accounts.push({
        email,
        source: 'agently-cli',
        provider: 'agently',
        alreadyConfigured: configuredEmails.has(email.toLowerCase()),
        detail: alias.is_primary ? 'Primary email' : `Alias: ${alias.name || email}`,
      })
    }
  } catch (err: any) {
    warnings.push(`Failed to read agently-cli user info: ${err.message}`)
  }

  return { accounts, warnings }
}

/**
 * Scan authorized emails from lark-cli
 */
function scanLarkCli(configuredEmails: Set<string>): { accounts: DiscoveredAccount[]; warnings: string[] } {
  const accounts: DiscoveredAccount[] = []
  const warnings: string[] = []

  // 1. Detect if lark-cli is installed
  let cliInstalled = false
  try {
    execFileSync('which', ['lark-cli'], { encoding: 'utf-8', stdio: 'pipe' })
    cliInstalled = true
  } catch {
    // lark-cli not installed, skip
  }

  if (!cliInstalled) {
    return { accounts, warnings }
  }

  // 2. Detect if logged in (user identity)
  let loggedIn = false
  try {
    const statusOutput = execFileSync('lark-cli', ['auth', 'status', '--as', 'user'], { encoding: 'utf-8' })
    const statusJson = parseCliJson(statusOutput)
    loggedIn = statusJson?.data?.logged_in === true
  } catch {
    warnings.push('lark-cli is installed but not logged in. Run `lark-cli auth login --domain mail` to authorize')
  }

  if (!loggedIn) {
    // Installed but not logged in
    accounts.push({
      email: '(Not logged in)',
      source: 'lark-cli',
      provider: 'lark',
      alreadyConfigured: false,
      detail: 'lark-cli is installed but not logged in. Run `lark-cli auth login --domain mail` first',
    })
    return { accounts, warnings }
  }

  // 3. Read authorized user mailbox profile
  try {
    const profileOutput = execFileSync('lark-cli', ['mail', 'user_mailbox', 'profile', '--as', 'user'], {
      encoding: 'utf-8',
    })
    const profileJson = parseCliJson(profileOutput)

    const email = profileJson?.data?.primary_email_address || ''
    if (email) {
      accounts.push({
        email,
        source: 'lark-cli',
        provider: 'lark',
        alreadyConfigured: configuredEmails.has(email.toLowerCase()),
        detail: 'Lark / 飞书企业邮箱 (user identity)',
      })
    }
  } catch (err: any) {
    // Fallback: try +me to get user info
    try {
      const meOutput = execFileSync('lark-cli', ['+me', '--as', 'user'], { encoding: 'utf-8' })
      const meJson = parseCliJson(meOutput)

      const aliases = meJson?.data?.aliases || []
      for (const alias of aliases) {
        const email = alias.email || ''
        if (!email) continue

        accounts.push({
          email,
          source: 'lark-cli',
          provider: 'lark',
          alreadyConfigured: configuredEmails.has(email.toLowerCase()),
          detail: alias.is_primary ? 'Primary email' : `Alias: ${alias.name || email}`,
        })
      }
    } catch (err2: any) {
      warnings.push(`Failed to read lark-cli user info: ${err2.message}`)
    }
  }

  return { accounts, warnings }
}
