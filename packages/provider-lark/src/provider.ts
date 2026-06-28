/**
 * Lark (Feishu) Enterprise Mail Adapter — operate Lark mailboxes via lark-cli
 *
 * Core Design:
 * - Zero credential passing: OAuth tokens are managed by lark-cli itself
 * - This adapter only calls CLI commands and parses output; it never touches or stores credentials
 * - v1 only supports user identity (--as user) for full read/write access
 * - All send/reply/forward operations use --confirm-send (Mail Agent has its own Human/AI Mode confirmation)
 */

import type {
  MailProvider,
  ProviderCapabilities,
  AccountConfig,
  Mail,
  MailThread,
  OutboundMail,
  SendResult,
  FetchCriteria,
  SearchCriteria,
  HealthStatus,
  ConnectionDiagnostics,
  MailAddress,
  MailError,
  ReplyOptions,
  ForwardOptions,
  AttachmentContent,
} from '@mail-agent/core'
import {
  runCli,
  ensureAuth,
  type LarkMessage,
  type LarkTriageResult,
  type LarkSendResult,
  type LarkThreadResult,
  type LarkAuthStatus,
} from './cli.js'
import { toMail, triageToMail, toThread, buildFilterJson } from './convert.js'
import { mapLarkCliError } from './errors.js'
import { v7 as uuidv7 } from 'uuid'

export class LarkProvider implements MailProvider {
  private _config: AccountConfig | null = null

  async connect(config: AccountConfig): Promise<void> {
    this._config = config
    // Check lark-cli authentication status; throw if not logged in or token expired
    ensureAuth()
  }

  async disconnect(): Promise<void> {
    // lark-cli is stateless, no connection to close
    this._config = null
  }

  async healthCheck(): Promise<HealthStatus> {
    const accountId = this._config?.id || ''
    const alias = this._config?.alias || ''
    const provider = 'lark'

    const diagnostics: ConnectionDiagnostics = {}

    try {
      ensureAuth()

      diagnostics.cli = {
        connected: true,
        host: 'lark-cli',
        port: 0,
        secure: true,
        authMethod: 'lark-cli OAuth (user)',
        latencyMs: 0,
      }

      return {
        connected: true,
        accountId,
        alias,
        provider,
        diagnostics,
      }
    } catch (err: any) {
      diagnostics.cli = {
        connected: false,
        host: 'lark-cli',
        port: 0,
        secure: true,
        authMethod: 'lark-cli OAuth (user)',
        latencyMs: 0,
        error: err.message,
      }

      return {
        connected: false,
        accountId,
        alias,
        provider,
        diagnostics,
      }
    }
  }

  async send(mail: OutboundMail): Promise<SendResult> {
    const args = ['mail', '+send']

    for (const addr of mail.to) {
      args.push('--to', addr.address)
    }
    if (mail.cc) {
      for (const addr of mail.cc) {
        args.push('--cc', addr.address)
      }
    }
    if (mail.bcc) {
      for (const addr of mail.bcc) {
        args.push('--bcc', addr.address)
      }
    }
    args.push('--subject', mail.subject)
    args.push('--body', mail.body.text || mail.body.html || '')
    if (mail.body.html) {
      // lark-cli auto-detects HTML; no explicit flag needed unless --plain-text
    } else {
      args.push('--plain-text')
    }
    // Always --confirm-send: Mail Agent has its own Human/AI Mode confirmation
    args.push('--confirm-send')

    const result = runCli<LarkSendResult>(args)

    if (!result.ok) {
      return {
        success: false,
        mailId: '',
        errorCode: (result as any).error?.code || 'E2001',
        errorMessage: (result as any).error?.message || 'Lark CLI send failed',
      }
    }

    const sendData = result.data
    return {
      success: true,
      mailId: uuidv7(),
      providerId: sendData.message_id || '',
    }
  }

  async fetch(criteria: FetchCriteria): Promise<Mail[]> {
    const args = ['mail', '+triage', '--format', 'json']

    // Build --filter JSON from criteria
    const filterOptions: Parameters<typeof buildFilterJson>[0] = {}
    if (criteria.folder) {
      filterOptions.folder = criteria.folder
    }
    if (criteria.unread) {
      filterOptions.unread = true
    }
    if (criteria.since) {
      filterOptions.startTime = criteria.since.toISOString()
    }
    const filterJson = buildFilterJson(filterOptions)
    // Only add --filter if there are actual filter conditions
    if (filterJson !== '{}') {
      args.push('--filter', filterJson)
    }

    if (criteria.limit) {
      args.push('--max', String(criteria.limit))
    }
    if (criteria.cursor) {
      args.push('--page-token', criteria.cursor)
    }

    const result = runCli<LarkTriageResult>(args)

    if (!result.ok) {
      throw mapResultToError(result)
    }

    const accountId = this._config?.id || ''
    const accountAlias = this._config?.alias || ''

    return result.data.messages.map((msg) => triageToMail(msg, accountId, accountAlias))
  }

  async read(mailId: string): Promise<Mail> {
    const result = runCli<LarkMessage>(['mail', '+message', '--message-id', mailId])

    if (!result.ok) {
      throw mapResultToError(result)
    }

    return toMail(result.data, this._config?.id || '', this._config?.alias || '')
  }

  async search(criteria: SearchCriteria): Promise<Mail[]> {
    const args = ['mail', '+triage', '--format', 'json']

    if (criteria.query) {
      args.push('--query', criteria.query)
    }

    // Build --filter for non-query criteria
    const filterOptions: Parameters<typeof buildFilterJson>[0] = {}
    if (criteria.folder) {
      filterOptions.folder = criteria.folder
    }
    if (criteria.unread) {
      filterOptions.unread = true
    }
    if (criteria.from) {
      filterOptions.from = criteria.from
    }
    if (criteria.hasAttachments) {
      filterOptions.hasAttachment = true
    }
    const filterJson = buildFilterJson(filterOptions)
    if (filterJson !== '{}') {
      args.push('--filter', filterJson)
    }

    if (criteria.limit) {
      args.push('--max', String(criteria.limit))
    }

    const result = runCli<LarkTriageResult>(args)

    if (!result.ok) {
      throw mapResultToError(result)
    }

    const accountId = this._config?.id || ''
    const accountAlias = this._config?.alias || ''

    return result.data.messages.map((msg) => triageToMail(msg, accountId, accountAlias))
  }

  async getThread(threadId: string): Promise<MailThread> {
    const result = runCli<LarkThreadResult>(['mail', '+thread', '--thread-id', threadId])

    if (!result.ok) {
      throw mapResultToError(result)
    }

    return toThread(result.data, this._config?.id || '', this._config?.alias || '')
  }

  async trash(mailId: string): Promise<void> {
    // No +trash shortcut — use raw API: user_mailbox.messages trash
    const result = runCli<{ message_id: string }>([
      'mail',
      'user_mailbox.messages',
      'trash',
      '--params',
      JSON.stringify({ user_mailbox_id: 'me', message_id: mailId }),
      '--yes',
    ])

    if (!result.ok) {
      throw mapResultToError(result)
    }
  }

  async reply(mailId: string, body: string, options?: ReplyOptions): Promise<SendResult> {
    const shortcut = options?.replyAll ? '+reply-all' : '+reply'
    const args = ['mail', shortcut, '--message-id', mailId, '--body', body]

    if (options?.cc) {
      for (const addr of options.cc) {
        args.push('--cc', addr.address)
      }
    }
    // Always --confirm-send
    args.push('--confirm-send')

    const result = runCli<LarkSendResult>(args)

    if (!result.ok) {
      return {
        success: false,
        mailId: '',
        errorCode: (result as any).error?.code || 'E2001',
        errorMessage: (result as any).error?.message || 'Lark CLI reply failed',
      }
    }

    return {
      success: true,
      mailId: uuidv7(),
      providerId: result.data.message_id || '',
    }
  }

  async forward(mailId: string, to: MailAddress[], options?: ForwardOptions): Promise<SendResult> {
    const args = ['mail', '+forward', '--message-id', mailId]

    for (const addr of to) {
      args.push('--to', addr.address)
    }
    if (options?.body) {
      args.push('--body', options.body)
    }
    // Always --confirm-send
    args.push('--confirm-send')

    const result = runCli<LarkSendResult>(args)

    if (!result.ok) {
      return {
        success: false,
        mailId: '',
        errorCode: (result as any).error?.code || 'E2001',
        errorMessage: (result as any).error?.message || 'Lark CLI forward failed',
      }
    }

    return {
      success: true,
      mailId: uuidv7(),
      providerId: result.data.message_id || '',
    }
  }

  async fetchAttachment(mailId: string, filename: string): Promise<AttachmentContent> {
    // First read the email to get attachment metadata
    const msgResult = runCli<LarkMessage>(['mail', '+message', '--message-id', mailId])
    if (!msgResult.ok) {
      throw mapResultToError(msgResult)
    }

    const msg = msgResult.data
    const att = (msg.attachments || []).find((a) => a.filename === filename)
    if (!att) {
      const available = (msg.attachments || []).map((a) => a.filename).join(', ')
      throw new Error(`Attachment "${filename}" not found. Available attachments: ${available || 'none'}`)
    }

    // Get download URL via raw API
    const dlUrlResult = runCli<{ url: string; expires_at: number }>([
      'mail',
      'user_mailbox.message.attachments',
      'download_url',
      '--params',
      JSON.stringify({
        user_mailbox_id: 'me',
        message_id: mailId,
        attachment_id: att.id,
      }),
    ])

    if (!dlUrlResult.ok) {
      throw mapResultToError(dlUrlResult)
    }

    // Download the attachment content
    const https = await import('https')
    const content = await new Promise<Buffer>((resolve, reject) => {
      https
        .get(dlUrlResult.data.url, (res) => {
          const chunks: Buffer[] = []
          res.on('data', (chunk: Buffer) => chunks.push(chunk))
          res.on('end', () => resolve(Buffer.concat(chunks)))
          res.on('error', reject)
        })
        .on('error', reject)
    })

    return {
      filename,
      contentType: att.content_type,
      size: att.size || content.length,
      content,
    }
  }

  capabilities(): ProviderCapabilities {
    return {
      realtimePush: false, // Could be enabled via +watch later
      imapIdle: false, // Not using IMAP
      threadNative: true, // Lark has native thread support (+thread)
      aiParsing: false,
      attachmentOcr: false,
      maxAttachmentSize: 30 * 1024 * 1024, // 30 MB (Lark Mail limit)
      sendRateLimit: 50, // Lark enterprise mail is generous
    }
  }
}

// ── Helper Functions ──

/**
 * Convert CLI error result to MailError and throw
 */
function mapResultToError(result: any): MailError {
  const err = result.error || {}
  return mapLarkCliError(
    { code: String(err.code || 'unknown'), message: err.message || 'Lark CLI command execution failed' },
    'E5001',
  )
}
