import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, statSync } from 'fs'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { parse, stringify } from 'yaml'
import type { AccountConfig, OAuth2Credentials } from '@mail-agent/core'
import { isEncrypted, encryptCredentials, decryptCredentials } from './crypto.js'

/** Current configuration format version; increment on format changes */
export const CONFIG_VERSION = 1

export interface AppConfig {
  /** Configuration format version number, used for migration */
  version?: number
  accounts: AccountConfig[]
  defaultAccount?: string
  mode?: 'human' | 'ai'
}

const CONFIG_DIR = join(homedir(), '.mail-agent')
const DEFAULT_CONFIG_PATH = join(CONFIG_DIR, 'config.yaml')
const DEFAULT_CREDENTIALS_PATH = join(CONFIG_DIR, 'credentials.yaml')

// ── Master password cache (entered once per process lifetime) ──

let _masterPassword: string | undefined

/**
 * Get master password (cached, entered only once per process)
 */
export function getMasterPassword(): string {
  if (_masterPassword) return _masterPassword
  // Use environment variable in MCP/non-interactive contexts
  if (process.env.MAIL_AGENT_MASTER_PASSWORD) {
    _masterPassword = process.env.MAIL_AGENT_MASTER_PASSWORD
    return _masterPassword
  }
  // Read from stdin in interactive mode (uses readline-sync)
  try {
    const readline = require('readline-sync') as any
    _masterPassword = readline.question('🔐 Enter master password: ', { hideEchoBack: true })
  } catch {
    throw new Error(
      'Credentials are encrypted but master password cannot be read. Set MAIL_AGENT_MASTER_PASSWORD or install readline-sync',
    )
  }
  return _masterPassword
}

/**
 * Set master password (used by encrypt/decrypt commands)
 */
export function setMasterPassword(password: string): void {
  _masterPassword = password
}

/**
 * Clear the cached master password to reduce the credential exposure window.
 *
 * Call after credential operations (encrypt/decrypt/rotate/revoke) or at the end
 * of sensitive operation chains so the master password is no longer retained in memory.
 * Long-lived processes like the MCP Server can call this periodically.
 */
export function clearMasterPassword(): void {
  _masterPassword = undefined
}

/**
 * Check whether the credentials file is encrypted
 */
export function isCredentialsEncrypted(): boolean {
  if (!existsSync(DEFAULT_CREDENTIALS_PATH)) return false
  const content = readFileSync(DEFAULT_CREDENTIALS_PATH, 'utf8')
  return isEncrypted(content)
}

// ── Permission hardening ──

const SECURE_DIR_MODE = 0o700
const SECURE_FILE_MODE = 0o600

/**
 * Secure file write: always use 0o600 permissions to avoid umask making files world-readable
 */
function secureWrite(filePath: string, content: string): void {
  writeFileSync(filePath, content, { encoding: 'utf-8', mode: SECURE_FILE_MODE })
}

/**
 * Ensure ~/.mail-agent/ directory and file permissions are secure (fallback remediation for externally modified permissions)
 */
export function ensureSecurePermissions(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }

  try {
    const stat = statSync(CONFIG_DIR)
    if ((stat.mode & 0o777) !== SECURE_DIR_MODE) {
      chmodSync(CONFIG_DIR, SECURE_DIR_MODE)
    }
  } catch {}

  const files = ['config.yaml', 'credentials.yaml']
  for (const file of files) {
    const filePath = join(CONFIG_DIR, file)
    if (!existsSync(filePath)) continue
    try {
      const stat = statSync(filePath)
      if ((stat.mode & 0o777) !== SECURE_FILE_MODE) {
        chmodSync(filePath, SECURE_FILE_MODE)
      }
    } catch {}
  }
}

// ── Credential encryption/decryption commands ──

/**
 * Encrypt credentials.yaml
 */
export function encryptCredentialFile(password?: string): void {
  if (!existsSync(DEFAULT_CREDENTIALS_PATH)) {
    console.error('❌ credentials.yaml does not exist, nothing to encrypt')
    return
  }
  const raw = readFileSync(DEFAULT_CREDENTIALS_PATH, 'utf8')
  if (isEncrypted(raw)) {
    console.log('ℹ️  credentials.yaml is already encrypted, skipping')
    return
  }
  const pwd = password || getMasterPassword()
  const encrypted = encryptCredentials(raw, pwd)
  secureWrite(DEFAULT_CREDENTIALS_PATH, encrypted)
}

/**
 * Decrypt credentials.yaml back to plaintext
 */
export function decryptCredentialFile(password?: string): void {
  if (!existsSync(DEFAULT_CREDENTIALS_PATH)) {
    console.error('❌ credentials.yaml does not exist')
    return
  }
  const raw = readFileSync(DEFAULT_CREDENTIALS_PATH, 'utf8')
  if (!isEncrypted(raw)) {
    console.log('ℹ️  credentials.yaml is not encrypted, skipping')
    return
  }
  const pwd = password || getMasterPassword()
  const decrypted = decryptCredentials(raw, pwd)
  secureWrite(DEFAULT_CREDENTIALS_PATH, decrypted)
}

// ── Load configuration ──

/**
 * Load non-sensitive configuration (config.yaml)
 */
export function loadConfig(configPath?: string): AppConfig {
  // Ensure ~/.mail-agent/ permissions are secure
  ensureSecurePermissions()

  const path =
    configPath ||
    process.env.MAIL_AGENT_CONFIG ||
    (existsSync('mail-agent.yaml') ? 'mail-agent.yaml' : undefined) ||
    DEFAULT_CONFIG_PATH

  if (!existsSync(path)) {
    return { accounts: [] }
  }

  let parsed: any
  try {
    const raw = readFileSync(path, 'utf-8')
    parsed = parse(raw)
  } catch (err: any) {
    throw new Error(`Failed to parse config file (${path}): ${err.message}`)
  }

  const validProviders = ['gmail', 'outlook', 'qq', '163', 'smtp-imap', 'agently', 'lark']

  const accounts: AccountConfig[] = (parsed?.accounts || []).map((a: any, i: number) => {
    if (!a.alias) {
      throw new Error(`Account at position ${i + 1} is missing required field: alias`)
    }
    if (a.provider && !validProviders.includes(a.provider)) {
      throw new Error(
        `Account "${a.alias}" has unsupported provider: ${a.provider}. Supported: ${validProviders.join(', ')}`,
      )
    }
    const account = parseAccountConfig(a, i)

    // Merge sensitive info from credentials.yaml
    const creds = loadCredentialsForAccount(account.id)
    if (creds) {
      account.pass = creds.pass
      account.oauth2 = creds.oauth2
      account.apiKey = creds.apiKey
    }

    return account
  })

  const defaultAccount = accounts.find((a) => a.isDefault)?.alias
  const mode = parsed?.mode === 'ai' ? 'ai' : 'human'
  const version = parsed?.version || CONFIG_VERSION
  return { version, accounts, defaultAccount, mode }
}

/**
 * Parse account config from YAML (excludes sensitive info)
 */
function parseAccountConfig(a: any, i: number): AccountConfig {
  return {
    id: a.id || `acc_${i}`,
    alias: a.alias,
    purpose: a.purpose || '',
    isDefault: a.is_default ?? i === 0,
    provider: a.provider || 'smtp-imap',
    network: a.network || 'public',
    user: a.user || '',
    // pass, oauth2, apiKey loaded from credentials.yaml, not stored in config.yaml
    inboxId: a.inbox_id || a.inboxId, // for multi-inbox platforms
    smtp: a.smtp
      ? {
          host: a.smtp.host || undefined,
          port: a.smtp.port || undefined,
          secure: a.smtp.secure ?? undefined,
          rejectUnauthorized: a.smtp.reject_unauthorized,
        }
      : undefined,
    imap: a.imap
      ? {
          host: a.imap.host || undefined,
          port: a.imap.port || undefined,
          tls: a.imap.tls ?? undefined,
          rejectUnauthorized: a.imap.reject_unauthorized,
        }
      : undefined,
  }
}

// ── Credential management ──

interface AccountCredentials {
  id: string
  pass?: string
  oauth2?: OAuth2Credentials
  apiKey?: string // API Key (for API-first platforms)
}

/**
 * Load credentials.yaml (auto-detects encryption state)
 */
function loadAllCredentials(credsPath?: string): AccountCredentials[] {
  const path = credsPath || DEFAULT_CREDENTIALS_PATH
  if (!existsSync(path)) return []

  let raw = readFileSync(path, 'utf-8')

  // Detect and decrypt encrypted file
  if (isEncrypted(raw)) {
    const password = getMasterPassword()
    try {
      raw = decryptCredentials(raw, password)
    } catch (err: any) {
      throw new Error(`Credential decryption failed: ${err.message}`)
    }
  }

  let parsed: any
  try {
    parsed = parse(raw)
  } catch (err: any) {
    throw new Error(`Failed to parse credentials file (${path}): ${err.message}`)
  }
  return (parsed?.accounts || []).map((a: any) => ({
    id: a.id,
    pass: a.pass,
    apiKey: a.api_key || a.apiKey,
    oauth2: a.oauth2
      ? {
          clientId: a.oauth2.client_id || a.oauth2.clientId,
          clientSecret: a.oauth2.client_secret || a.oauth2.clientSecret,
          refreshToken: a.oauth2.refresh_token || a.oauth2.refreshToken,
          accessToken: a.oauth2.access_token || a.oauth2.accessToken,
          expires: a.oauth2.expires,
        }
      : undefined,
  }))
}

/**
 * Load credentials for a specific account
 */
function loadCredentialsForAccount(accountId: string): AccountCredentials | null {
  const allCreds = loadAllCredentials(DEFAULT_CREDENTIALS_PATH)
  return allCreds.find((c) => c.id === accountId) || null
}

/**
 * Save credentials to credentials.yaml
 * Sensitive info stored separately; AI agents won't read it
 */
function saveCredentials(accounts: AccountCredentials[], credsPath?: string): void {
  const path = credsPath || DEFAULT_CREDENTIALS_PATH
  const dir = dirname(path)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const yamlObj = {
    _comment: 'This file contains sensitive credentials. Do not share or commit to version control.',
    accounts: accounts.map((a) => {
      const obj: any = { id: a.id }
      if (a.pass) obj.pass = a.pass
      if (a.apiKey) obj.api_key = a.apiKey
      if (a.oauth2) {
        obj.oauth2 = {
          client_id: a.oauth2.clientId,
          client_secret: a.oauth2.clientSecret,
          refresh_token: a.oauth2.refreshToken,
          ...(a.oauth2.accessToken && { access_token: a.oauth2.accessToken }),
          ...(a.oauth2.expires && { expires: a.oauth2.expires }),
        }
      }
      return obj
    }),
  }

  const yaml = stringify(yamlObj)

  // Check if the current credentials file is encrypted (preserve encryption on write)
  let shouldEncrypt = false
  if (existsSync(path)) {
    const current = readFileSync(path, 'utf8')
    shouldEncrypt = isEncrypted(current)
  }

  const content = shouldEncrypt ? encryptCredentials(yaml, getMasterPassword()) : yaml
  secureWrite(path, content)
}

// ── Find account ──

export function getAccount(config: AppConfig, alias?: string): AccountConfig | undefined {
  if (alias) {
    return config.accounts.find((a) => a.alias === alias)
  }
  return config.accounts.find((a) => a.isDefault) || config.accounts[0]
}

// ── Save configuration ──

/**
 * Serialize AppConfig to YAML (non-sensitive → config.yaml, sensitive → credentials.yaml)
 */
export function saveConfig(config: AppConfig, configPath?: string): void {
  const cp = configPath || DEFAULT_CONFIG_PATH
  const credsPath = DEFAULT_CREDENTIALS_PATH

  // config.yaml: excludes pass / oauth2
  const configYaml = {
    version: config.version || CONFIG_VERSION,
    ...(config.mode === 'ai' ? { mode: config.mode } : {}),
    accounts: config.accounts.map((a) => {
      const obj: any = {
        id: a.id,
        alias: a.alias,
        purpose: a.purpose,
        is_default: a.isDefault,
        provider: a.provider,
        network: a.network,
        user: a.user,
      }
      if (a.inboxId) {
        obj.inbox_id = a.inboxId
      }
      if (a.smtp) {
        obj.smtp = {}
        if (a.smtp.host) obj.smtp.host = a.smtp.host
        if (a.smtp.port) obj.smtp.port = a.smtp.port
        if (a.smtp.secure !== undefined) obj.smtp.secure = a.smtp.secure
        if (a.smtp.rejectUnauthorized !== undefined) obj.smtp.reject_unauthorized = a.smtp.rejectUnauthorized
      }
      if (a.imap) {
        obj.imap = {}
        if (a.imap.host) obj.imap.host = a.imap.host
        if (a.imap.port) obj.imap.port = a.imap.port
        if (a.imap.tls !== undefined) obj.imap.tls = a.imap.tls
        if (a.imap.rejectUnauthorized !== undefined) obj.imap.reject_unauthorized = a.imap.rejectUnauthorized
      }
      return obj
    }),
  }

  const dir = dirname(cp)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  secureWrite(cp, stringify(configYaml))

  // credentials.yaml: pass / oauth2 / apiKey
  const creds: AccountCredentials[] = config.accounts
    .filter((a) => a.pass || a.oauth2 || a.apiKey)
    .map((a) => ({
      id: a.id,
      pass: a.pass,
      apiKey: a.apiKey,
      oauth2: a.oauth2,
    }))

  if (creds.length > 0) {
    saveCredentials(creds, credsPath)
  }
}

/**
 * Remove a specific account (removes from both config.yaml and credentials.yaml)
 */
export function removeAccount(accountId: string, configPath?: string): void {
  const cp = configPath || DEFAULT_CONFIG_PATH

  // Remove from config.yaml
  if (existsSync(cp)) {
    const raw = readFileSync(cp, 'utf-8')
    const parsed = parse(raw)
    if (parsed?.accounts) {
      parsed.accounts = parsed.accounts.filter((a: any) => a.id !== accountId)
      secureWrite(cp, stringify(parsed))
    }
  }

  // Remove from credentials.yaml (handles encryption state automatically)
  const allCreds = loadAllCredentials()
  const filtered = allCreds.filter((c) => c.id !== accountId)
  if (filtered.length === 0) {
    // No more credentials; write empty comment-only file
    secureWrite(
      credsPath,
      stringify({ _comment: 'This file contains sensitive credentials. Do not share or commit to version control.' }),
    )
  } else {
    saveCredentials(filtered)
  }
}

/**
 * Update OAuth2 credentials for a single account (called after token refresh)
 */
export function updateOAuth2Token(accountId: string, oauth2: OAuth2Credentials): void {
  const allCreds = loadAllCredentials()
  const existing = allCreds.find((c) => c.id === accountId)

  if (existing) {
    existing.oauth2 = oauth2
  } else {
    allCreds.push({ id: accountId, oauth2 })
  }

  saveCredentials(allCreds)
}

/**
 * Persist refreshed OAuth2 token (only if actually updated)
 * Called by CLI/MCP after operations to ensure refreshed tokens are persisted to credentials.yaml
 */
export function persistRefreshedToken(account: AccountConfig): void {
  if (account.oauth2 && account.oauth2.accessToken) {
    updateOAuth2Token(account.id, account.oauth2)
  }
}
