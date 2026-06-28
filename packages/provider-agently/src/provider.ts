/**
 * Agently Mail Adapter — operate Agent-native mailboxes via agently-cli
 *
 * Core Design:
 * - Zero credential passing: OAuth tokens are managed by agently-cli itself (macOS Keychain / Linux Secret Service)
 * - This adapter only calls CLI commands and parses output; it never touches or stores credentials
 * - Two-phase confirmation: send/reply/forward/trash first call returns ctk, second call with ctk completes the operation
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
  type AgentlyMessage,
  type AgentlyListResult,
  type AgentlySendResult,
  type AgentlyAttachment,
  mapExitCodeToError,
} from './cli.js'
import { v7 as uuidv7 } from 'uuid'

/** Folder name mapping: IMAP standard name → agently-cli internal name */
const FOLDER_MAP: Record<string, string> = {
  INBOX: 'inbox',
  Sent: 'sent',
  Trash: 'trash',
  Spam: 'spam',
}

export class AgentlyProvider implements MailProvider {
  private _config: AccountConfig | null = null

  async connect(config: AccountConfig): Promise<void> {
    this._config = config
    // Check agently-cli authentication status; throw if not logged in or token expired
    ensureAuth()
  }

  async disconnect(): Promise<void> {
    // agently-cli is stateless, no connection to close
    this._config = null
  }

  async healthCheck(): Promise<HealthStatus> {
    const accountId = this._config?.id || ''
    const alias = this._config?.alias || ''
    const provider = 'agently'

    const diagnostics: ConnectionDiagnostics = {}

    try {
      const { execSync } = await import('child_process')
      const cliPath = execSync('which agently-cli', { encoding: 'utf-8' }).trim()

      ensureAuth()

      diagnostics.cli = {
        connected: true,
        host: 'agently-cli',
        port: 0,
        secure: true,
        authMethod: 'agently-cli OAuth',
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
        host: 'agently-cli',
        port: 0,
        secure: true,
        authMethod: 'agently-cli OAuth',
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
    // 构造 CLI 参数
    const args = ['message', '+send']

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
    args.push('--body', mail.body.text)
    if (mail.body.html) {
      args.push('--body-format', 'html')
    }

    // 附件：写入当前工作目录下的临时子目录，传相对路径给 CLI
    // agently-cli 要求附件路径必须在 cwd 内（安全限制）
    let tmpDir: string | undefined
    if (mail.attachmentContents && mail.attachmentContents.length > 0) {
      const fs = await import('fs')
      const path = await import('path')
      const crypto = await import('crypto')
      const tmpName = `.mail-agent-att-${crypto.randomBytes(6).toString('hex')}`
      tmpDir = path.join(process.cwd(), tmpName)
      fs.mkdirSync(tmpDir, { mode: 0o700 })
      for (const att of mail.attachmentContents) {
        const filePath = path.join(tmpDir, att.filename)
        fs.writeFileSync(filePath, att.content)
        // 相对路径（在 cwd 下，一定合法）
        args.push('--attachment', path.relative(process.cwd(), filePath))
      }
    }

    try {
      // First call: get confirmation_token
      const firstResult = runCli<AgentlySendResult>(args)

      if (!firstResult.ok) {
        return {
          success: false,
          mailId: '',
          errorCode: (firstResult as any).error?.code || 'E2001',
          errorMessage: (firstResult as any).error?.message || 'Agently CLI send failed',
        }
      }

      const sendData = firstResult.data

      // If two-phase confirmation is needed, automatically carry ctk to complete sending
      if (sendData.confirmation_required && sendData.confirmation_token) {
        const confirmArgs = [...args, '--confirmation-token', sendData.confirmation_token]
        const confirmResult = runCli<AgentlySendResult>(confirmArgs)

        if (!confirmResult.ok) {
          return {
            success: false,
            mailId: '',
            errorCode: (confirmResult as any).error?.code || 'E2001',
            errorMessage: (confirmResult as any).error?.message || 'Agently CLI confirm send failed',
          }
        }

        return {
          success: true,
          mailId: uuidv7(),
          providerId: confirmResult.data.message_id || '',
          confirmToken: sendData.confirmation_token,
          confirmSummary: sendData.summary,
        }
      }

      // No confirmation needed (should not happen, but compatible)
      return {
        success: true,
        mailId: uuidv7(),
        providerId: sendData.message_id || '',
      }
    } finally {
      // 清理临时文件
      if (tmpDir) {
        const fs = await import('fs')
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true })
        } catch {}
      }
    }
  }

  async fetch(criteria: FetchCriteria): Promise<Mail[]> {
    const args = ['message', '+list']

    if (criteria.limit) {
      args.push('--limit', String(criteria.limit))
    }
    if (criteria.folder) {
      const dir = FOLDER_MAP[criteria.folder] || criteria.folder.toLowerCase()
      args.push('--dir', dir)
    }
    if (criteria.unread) {
      args.push('--is-unread')
    }
    if (criteria.since) {
      args.push('--after', criteria.since.toISOString())
    }
    if (criteria.cursor) {
      args.push('--cursor', criteria.cursor)
    }

    const result = runCli<AgentlyListResult>(args)

    if (!result.ok) {
      throw mapResultToError(result)
    }

    return result.data.data.map((msg) => this.toMail(msg))
  }

  async read(mailId: string): Promise<Mail> {
    const result = runCli<AgentlyMessage>(['message', '+read', '--id', mailId])

    if (!result.ok) {
      throw mapResultToError(result)
    }

    return this.toMail(result.data)
  }

  async search(criteria: SearchCriteria): Promise<Mail[]> {
    const args = ['message', '+search']

    if (criteria.query) {
      args.push('--q', criteria.query)
    }
    if (criteria.from) {
      args.push('--from', criteria.from)
    }
    if (criteria.to) {
      args.push('--to', criteria.to)
    }
    if (criteria.limit) {
      args.push('--limit', String(criteria.limit))
    }
    if (criteria.folder) {
      const dir = FOLDER_MAP[criteria.folder] || criteria.folder.toLowerCase()
      args.push('--dir', dir)
    }
    if (criteria.unread) {
      args.push('--is-unread')
    }
    if (criteria.since) {
      args.push('--after', criteria.since.toISOString())
    }

    const result = runCli<AgentlyListResult>(args)

    if (!result.ok) {
      throw mapResultToError(result)
    }

    let mails = result.data.data.map((msg) => this.toMail(msg))

    // hasAttachments client-side filtering (Agently CLI search doesn't support attachment flag)
    if (criteria.hasAttachments) {
      mails = mails.filter((m) => m.attachments.length > 0)
    }

    return mails
  }

  async getThread(threadId: string): Promise<MailThread> {
    throw new Error('Agently Mail does not yet support thread consolidation; will be implemented in a future version')
  }

  async trash(mailId: string): Promise<void> {
    const result = runCli<AgentlySendResult>(['message', '+trash', '--id', mailId])

    if (!result.ok) {
      throw mapResultToError(result)
    }

    // If two-phase confirmation is needed, automatically carry ctk to complete
    if (result.data.confirmation_required && result.data.confirmation_token) {
      const confirmResult = runCli<AgentlySendResult>([
        'message',
        '+trash',
        '--id',
        mailId,
        '--confirmation-token',
        result.data.confirmation_token,
      ])

      if (!confirmResult.ok) {
        throw mapResultToError(confirmResult)
      }
    }
  }

  async reply(mailId: string, body: string, options?: ReplyOptions): Promise<SendResult> {
    const args = ['message', '+reply', '--id', mailId, '--body', body]

    if (options?.replyAll) {
      args.push('--reply-all')
    }
    if (options?.cc) {
      for (const addr of options.cc) {
        args.push('--cc', addr.address)
      }
    }

    const result = runCli<AgentlySendResult>(args)

    if (!result.ok) {
      return {
        success: false,
        mailId: '',
        errorCode: (result as any).error?.code || 'E2001',
        errorMessage: (result as any).error?.message || 'Agently CLI reply failed',
      }
    }

    // Automatically carry ctk to complete confirmation
    if (result.data.confirmation_required && result.data.confirmation_token) {
      const confirmArgs = [...args, '--confirmation-token', result.data.confirmation_token]
      const confirmResult = runCli<AgentlySendResult>(confirmArgs)

      if (!confirmResult.ok) {
        return {
          success: false,
          mailId: '',
          errorCode: (confirmResult as any).error?.code || 'E2001',
          errorMessage: (confirmResult as any).error?.message || 'Agently CLI confirm reply failed',
        }
      }

      return {
        success: true,
        mailId: uuidv7(),
        providerId: confirmResult.data.message_id || '',
      }
    }

    return {
      success: true,
      mailId: uuidv7(),
      providerId: result.data.message_id || '',
    }
  }

  async forward(mailId: string, to: MailAddress[], options?: ForwardOptions): Promise<SendResult> {
    const args = ['message', '+forward', '--id', mailId]

    for (const addr of to) {
      args.push('--to', addr.address)
    }
    if (options?.body) {
      args.push('--body', options.body)
    }
    if (options?.includeAttachments) {
      args.push('--include-attachments')
    }

    const result = runCli<AgentlySendResult>(args)

    if (!result.ok) {
      return {
        success: false,
        mailId: '',
        errorCode: (result as any).error?.code || 'E2001',
        errorMessage: (result as any).error?.message || 'Agently CLI forward failed',
      }
    }

    // Automatically carry ctk to complete confirmation
    if (result.data.confirmation_required && result.data.confirmation_token) {
      const confirmArgs = [...args, '--confirmation-token', result.data.confirmation_token]
      const confirmResult = runCli<AgentlySendResult>(confirmArgs)

      if (!confirmResult.ok) {
        return {
          success: false,
          mailId: '',
          errorCode: (confirmResult as any).error?.code || 'E2001',
          errorMessage: (confirmResult as any).error?.message || 'Agently CLI confirm forward failed',
        }
      }

      return {
        success: true,
        mailId: uuidv7(),
        providerId: confirmResult.data.message_id || '',
      }
    }

    return {
      success: true,
      mailId: uuidv7(),
      providerId: result.data.message_id || '',
    }
  }

  async fetchAttachment(mailId: string, filename: string): Promise<AttachmentContent> {
    // First read the email to get attachment_id
    const msgResult = runCli<AgentlyMessage>(['message', '+read', '--id', mailId])
    if (!msgResult.ok) {
      throw mapResultToError(msgResult)
    }

    const msg = msgResult.data
    const att = (msg.attachments || []).find((a) => a.filename === filename)
    if (!att) {
      const available = (msg.attachments || []).map((a) => a.filename).join(', ')
      throw new Error(`Attachment "${filename}" not found. Available attachments: ${available || 'none'}`)
    }

    // Download to cwd-based temp dir (agently-cli requires --output to be a relative path within cwd)
    const fs = await import('fs')
    const path = await import('path')
    const crypto = await import('crypto')
    const tmpName = `.mail-agent-dl-${crypto.randomBytes(6).toString('hex')}`
    const tmpDir = path.join(process.cwd(), tmpName)
    fs.mkdirSync(tmpDir, { mode: 0o700 })
    const relOutput = path.relative(process.cwd(), tmpDir)

    const dlResult = runCli<{ path: string }>([
      'attachment',
      '+download',
      '--msg',
      mailId,
      '--att',
      att.attachment_id,
      '--output',
      relOutput,
    ])

    if (!dlResult.ok) {
      throw mapResultToError(dlResult)
    }

    // Read downloaded file
    const filePath = `${tmpDir}/${filename}`
    const content = fs.readFileSync(filePath)

    // Clean up temp files
    try {
      fs.unlinkSync(filePath)
      fs.rmdirSync(tmpDir)
    } catch {}

    return {
      filename,
      contentType: att.content_type,
      size: att.size,
      content: Buffer.from(content),
    }
  }

  capabilities(): ProviderCapabilities {
    return {
      realtimePush: false, // SSE push not yet supported
      imapIdle: false, // Not using IMAP
      threadNative: false, // No native Thread API
      aiParsing: false, // No native AI parsing
      attachmentOcr: false,
      maxAttachmentSize: 20 * 1024 * 1024, // 20 MB (from +me)
      sendRateLimit: 10, // 10/min (from +me)
    }
  }

  // ── Internal Methods ──

  /**
   * Convert Agently CLI message format to unified Mail model
   */
  private toMail(msg: AgentlyMessage): Mail {
    return {
      id: msg.message_id,
      providerId: msg.message_id,
      accountId: this._config?.id || '',
      accountAlias: this._config?.alias || '',
      threadId: undefined, // Agently has no native thread API, thread consolidation not yet supported
      from: toMailAddress(msg.from),
      to: msg.to.map(toMailAddress),
      cc: [],
      bcc: [],
      subject: msg.subject || '(No Subject)',
      body: {
        text: stripHtmlTags(msg.body) || msg.snippet || '',
        html: msg.body || undefined,
      },
      attachments: (msg.attachments || []).map(toAttachment),
      labels: msg.dir ? [msg.dir.dir_name] : [],
      date: new Date(msg.created_at),
      read: msg.is_read,
      starred: false,
    }
  }
}

// ── Helper Functions ──

function toMailAddress(addr: { email: string; name: string }): MailAddress {
  return {
    name: addr.name || '',
    address: addr.email,
  }
}

function toAttachment(att: AgentlyAttachment): {
  filename: string
  contentType: string
  size: number
  contentId?: string
  downloadUrl?: string
} {
  return {
    filename: att.filename,
    contentType: att.content_type,
    size: att.size,
  }
}

/**
 * Simple HTML tag stripping — when Agently read returns HTML but no snippet,
 * use this function to extract plain text as body.text fallback
 */
function stripHtmlTags(html: string | undefined): string {
  if (!html) return ''
  return (
    html
      // Remove <style> and <script> blocks
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      // Remove HTML tags
      .replace(/<[^>]+>/g, '')
      // Decode common HTML entities
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      // Collapse whitespace
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 5000)
  ) // Truncate overly long text
}

/**
 * Convert CLI error result to MailError and throw
 */
function mapResultToError(result: any): MailError {
  const err = result.error || {}
  return {
    code: err.code || 'E5001',
    providerCode: String(err.code || 'unknown'),
    message: err.message || 'Agently CLI command execution failed',
    retryable: err.code === '1' || err.code === '7',
  }
}
