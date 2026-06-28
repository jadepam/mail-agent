/**
 * Gmail API Provider — Send and receive emails via Gmail REST API
 *
 * Solves the problem of SMTP/IMAP ports being blocked by proxies in regions with restricted internet.
 * Gmail API uses HTTPS, which proxies like Clash can forward normally.
 *
 * Advantages:
 * - Proxy-friendly: HTTPS traffic can be forwarded normally by proxies
 * - Native thread support: Gmail API provides threads endpoints natively
 * - Label management: Supports Gmail label system
 * - No SMTP/IMAP ports needed
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
  OAuth2Diagnostic,
  ReplyOptions,
  ForwardOptions,
  MailAddress,
  AttachmentContent,
} from '@mail-agent/core'
import { isTokenExpired, formatMailAddress, DEFAULT_FETCH_LIMIT, MailErrorClass } from '@mail-agent/core'
import { createAuthenticatedClient } from './api.js'
import { gmailMessageToMail, gmailThreadToMailThread, encodeRawEmail } from './convert.js'
import { mapGmailApiError } from './errors.js'
import type { GmailMessage, GmailThread } from './convert.js'
import { v7 as uuidv7 } from 'uuid'

/** Folder name mapping: IMAP standard name -> Gmail search syntax */
const FOLDER_MAP: Record<string, string> = {
  INBOX: 'in:inbox',
  Sent: 'in:sent',
  Trash: 'in:trash',
  Draft: 'in:drafts',
  Spam: 'in:spam',
}

export class GmailApiProvider implements MailProvider {
  private _config: AccountConfig | null = null

  async connect(config: AccountConfig): Promise<void> {
    this._config = config

    if (!config.oauth2) {
      throw new MailErrorClass({
        code: 'E1002',
        providerCode: 'MISSING_OAUTH2',
        message: 'Gmail API mode requires OAuth2 credentials. Please run `ma account add` again.',
        retryable: false,
      })
    }

    // Validate connection: fetch user profile
    const { client } = await createAuthenticatedClient(config.oauth2)
    try {
      await client.users.getProfile({ userId: 'me' })
    } catch (err: any) {
      throw mapGmailApiError(err)
    }
  }

  async disconnect(): Promise<void> {
    // API mode has no connections to close
    this._config = null
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!this._config?.oauth2) {
      return {
        connected: false,
        accountId: this._config?.id || '',
        alias: this._config?.alias || '',
        provider: 'gmail-api',
      }
    }

    const diagnostics: ConnectionDiagnostics = {}

    try {
      const { client, oauth2 } = await createAuthenticatedClient(this._config.oauth2)
      // Update token in config
      this._config.oauth2 = oauth2

      const start = Date.now()
      const profile = await client.users.getProfile({ userId: 'me' })
      const latency = Date.now() - start

      diagnostics.api = {
        connected: true,
        host: 'gmail.googleapis.com',
        port: 443,
        secure: true,
        authMethod: 'OAuth2',
        latencyMs: latency,
      }

      diagnostics.oauth2 = {
        tokenExpiry: oauth2.expires ? new Date(oauth2.expires).toISOString() : undefined,
        isExpired: isTokenExpired(oauth2),
      }

      return {
        connected: true,
        accountId: this._config.id,
        alias: this._config.alias,
        provider: 'gmail-api',
        latency,
        diagnostics,
      }
    } catch (err: any) {
      diagnostics.api = {
        connected: false,
        host: 'gmail.googleapis.com',
        port: 443,
        secure: true,
        authMethod: 'OAuth2',
        latencyMs: 0,
        error: err.message,
      }

      if (this._config.oauth2) {
        diagnostics.oauth2 = {
          tokenExpiry: this._config.oauth2.expires ? new Date(this._config.oauth2.expires).toISOString() : undefined,
          isExpired: isTokenExpired(this._config.oauth2),
        }
      }

      return {
        connected: false,
        accountId: this._config.id,
        alias: this._config.alias,
        provider: 'gmail-api',
        diagnostics,
      }
    }
  }

  async send(mail: OutboundMail): Promise<SendResult> {
    if (!this._config?.oauth2) {
      return {
        success: false,
        mailId: '',
        errorCode: 'E1001',
        errorMessage: 'Gmail API not connected',
      }
    }

    try {
      const { client, oauth2 } = await createAuthenticatedClient(this._config.oauth2)
      this._config.oauth2 = oauth2

      // Construct RFC 2822 email and base64url encode
      const raw = encodeRawEmail({
        from: formatMailAddress(this._config.alias, this._config.user),
        to: mail.to.map((a) => formatMailAddress(a.name, a.address)),
        subject: mail.subject,
        text: mail.body.text,
        html: mail.body.html,
        cc: mail.cc?.map((a) => formatMailAddress(a.name, a.address)),
        inReplyTo: mail.inReplyTo,
        attachments: mail.attachmentContents,
      })

      const result = await client.users.messages.send({
        userId: 'me',
        requestBody: { raw },
      })

      return {
        success: true,
        mailId: result.data.id || uuidv7(),
        providerId: result.data.id || undefined,
      }
    } catch (err: any) {
      const mapped = mapGmailApiError(err)
      return {
        success: false,
        mailId: '',
        errorCode: mapped.code,
        errorMessage: mapped.message,
      }
    }
  }

  async fetch(criteria: FetchCriteria): Promise<Mail[]> {
    if (!this._config?.oauth2) {
      throw new Error('Gmail API not connected')
    }

    const { client, oauth2 } = await createAuthenticatedClient(this._config.oauth2)
    this._config.oauth2 = oauth2

    // Build Gmail query
    const q = this.buildFetchQuery(criteria)

    // List email IDs
    const listResult = await client.users.messages.list({
      userId: 'me',
      maxResults: criteria.limit || DEFAULT_FETCH_LIMIT,
      q: q || undefined,
      pageToken: criteria.cursor || undefined,
    })

    const messageIds = listResult.data.messages || []
    if (messageIds.length === 0) return []

    // Batch fetch email details
    const mails: Mail[] = []
    for (const msg of messageIds) {
      if (!msg.id) continue
      try {
        const detail = await client.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'full',
        })
        mails.push(gmailMessageToMail(detail.data as unknown as GmailMessage, this._config.id, this._config.alias))
      } catch {
        // Single email fetch failure does not affect others
        continue
      }
    }

    return mails
  }

  async read(mailId: string): Promise<Mail> {
    if (!this._config?.oauth2) {
      throw new Error('Gmail API not connected')
    }

    const { client, oauth2 } = await createAuthenticatedClient(this._config.oauth2)
    this._config.oauth2 = oauth2

    // If mailId is truncated (shorter than full Gmail message id), search for match first
    let fullId = mailId
    if (mailId.length < 16) {
      // List recent emails, find full id with matching prefix
      const listResult = await client.users.messages.list({
        userId: 'me',
        maxResults: 100,
      })
      const messages = listResult.data.messages || []
      const match = messages.find((m) => m.id?.startsWith(mailId))
      if (!match?.id) {
        throw new Error(`Email ${mailId} does not exist or cannot be accessed`)
      }
      fullId = match.id
    }

    const detail = await client.users.messages.get({
      userId: 'me',
      id: fullId,
      format: 'full',
    })

    const msg = detail.data as unknown as GmailMessage

    // If format: 'full' didn't return parts (Gmail API sometimes collapses
    // multipart messages into a single text/plain payload), try format: 'raw'
    // which always returns the complete MIME structure
    if (!msg.payload?.parts) {
      const rawDetail = await client.users.messages.get({
        userId: 'me',
        id: fullId,
        format: 'raw',
      })
      // Decode raw MIME and parse to find attachments
      const rawBase64 = rawDetail.data.raw
      if (rawBase64) {
        const rawDecoded = Buffer.from(rawBase64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
        const attachments = parseAttachmentsFromRawMime(rawDecoded)
        if (attachments.length > 0) {
          // Merge attachment metadata into the message
          msg.payload = msg.payload || {}
          msg.payload.parts = attachments.map((att) => ({
            filename: att.filename,
            mimeType: att.contentType,
            body: { attachmentId: att.attachmentId || '', size: att.size },
            headers: [{ name: 'Content-Disposition', value: `attachment; filename="${att.filename}"` }],
          }))
        }
      }
    }

    return gmailMessageToMail(msg, this._config.id, this._config.alias)
  }

  async search(criteria: SearchCriteria): Promise<Mail[]> {
    if (!this._config?.oauth2) {
      throw new Error('Gmail API not connected')
    }

    const { client, oauth2 } = await createAuthenticatedClient(this._config.oauth2)
    this._config.oauth2 = oauth2

    // Build Gmail search query
    const parts: string[] = []
    if (criteria.query) parts.push(criteria.query)
    if (criteria.from) parts.push(`from:${criteria.from}`)
    if (criteria.to) parts.push(`to:${criteria.to}`)
    if (criteria.unread) parts.push('is:unread')
    if (criteria.hasAttachments) parts.push('has:attachment')
    if (criteria.since) parts.push(`after:${criteria.since.toISOString().slice(0, 10)}`)
    if (criteria.before) parts.push(`before:${criteria.before.toISOString().slice(0, 10)}`)

    const q = parts.join(' ')

    const listResult = await client.users.messages.list({
      userId: 'me',
      maxResults: criteria.limit || DEFAULT_FETCH_LIMIT,
      q,
    })

    const messageIds = listResult.data.messages || []
    if (messageIds.length === 0) return []

    const mails: Mail[] = []
    for (const msg of messageIds) {
      if (!msg.id) continue
      try {
        const detail = await client.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'full',
        })
        mails.push(gmailMessageToMail(detail.data as unknown as GmailMessage, this._config.id, this._config.alias))
      } catch {
        continue
      }
    }

    return mails
  }

  async getThread(threadId: string): Promise<MailThread> {
    if (!this._config?.oauth2) {
      throw new Error('Gmail API not connected')
    }

    const { client, oauth2 } = await createAuthenticatedClient(this._config.oauth2)
    this._config.oauth2 = oauth2

    const result = await client.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full',
    })

    return gmailThreadToMailThread(result.data as unknown as GmailThread, this._config.id, this._config.alias)
  }

  async trash(mailId: string): Promise<void> {
    if (!this._config?.oauth2) {
      throw new Error('Gmail API not connected')
    }

    const { client, oauth2 } = await createAuthenticatedClient(this._config.oauth2)
    this._config.oauth2 = oauth2

    await client.users.messages.trash({
      userId: 'me',
      id: mailId,
    })
  }

  async reply(mailId: string, body: string, options?: ReplyOptions): Promise<SendResult> {
    if (!this._config?.oauth2) {
      return { success: false, mailId: '', errorCode: 'E1001', errorMessage: 'Gmail API not connected' }
    }

    const { client, oauth2 } = await createAuthenticatedClient(this._config.oauth2)
    this._config.oauth2 = oauth2

    // Fetch original email
    const detail = await client.users.messages.get({
      userId: 'me',
      id: mailId,
      format: 'full',
    })
    const original = gmailMessageToMail(detail.data as unknown as GmailMessage, this._config.id, this._config.alias)

    let replyTo: MailAddress[]
    let replyCc: string[] | undefined

    if (options?.replyAll) {
      const myEmail = this._config.user?.toLowerCase() || ''
      replyTo = [original.from, ...original.to].filter((a) => a.address.toLowerCase() !== myEmail)
      const ccList = original.cc.filter((a) => a.address.toLowerCase() !== myEmail)
      if (options.cc) ccList.push(...options.cc)
      if (ccList.length) replyCc = ccList.map((a) => a.address)
    } else {
      replyTo = [original.from]
      if (options?.cc) replyCc = options.cc.map((a) => a.address)
    }

    // Construct quoted body
    let textBody = body
    const quoteOriginal = options?.quoteOriginal !== false
    if (quoteOriginal && original.body.text) {
      const quoted = original.body.text
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
      const dateStr = original.date.toLocaleString('en-US')
      const fromStr = original.from.name || original.from.address
      textBody = `${body}\n\n${dateStr}, ${fromStr} wrote:\n${quoted}`
    }

    const subject = original.subject.startsWith('Re:') ? original.subject : `Re: ${original.subject}`

    // Construct RFC 2822 email
    const raw = encodeRawEmail({
      from: formatMailAddress(this._config.alias, this._config.user),
      to: replyTo.map((a) => a.address),
      subject,
      text: textBody,
      cc: replyCc,
      inReplyTo: original.providerId ? `<${original.providerId.replace(/^<|>$/g, '')}>` : undefined,
    })

    try {
      const result = await client.users.messages.send({
        userId: 'me',
        requestBody: { raw },
      })
      return { success: true, mailId: result.data.id || '', providerId: result.data.id || undefined }
    } catch (err: any) {
      const mapped = mapGmailApiError(err)
      return { success: false, mailId: '', errorCode: mapped.code, errorMessage: mapped.message }
    }
  }

  async forward(mailId: string, to: MailAddress[], options?: ForwardOptions): Promise<SendResult> {
    if (!this._config?.oauth2) {
      return { success: false, mailId: '', errorCode: 'E1001', errorMessage: 'Gmail API not connected' }
    }

    const { client, oauth2 } = await createAuthenticatedClient(this._config.oauth2)
    this._config.oauth2 = oauth2

    // Fetch original email
    const detail = await client.users.messages.get({
      userId: 'me',
      id: mailId,
      format: 'full',
    })
    const original = gmailMessageToMail(detail.data as unknown as GmailMessage, this._config.id, this._config.alias)

    // Construct forward body
    let textBody = options?.body || ''
    const divider = '\n\n---------- Forwarded message ----------\n'
    const header = [
      `From: ${original.from.name ? original.from.name + ' <' + original.from.address + '>' : original.from.address}`,
      `Date: ${original.date.toLocaleString('en-US')}`,
      `Subject: ${original.subject}`,
      `To: ${original.to.map((a) => a.address).join(', ')}`,
    ].join('\n')
    const originalBody = original.body.text || '(No body)'

    textBody = textBody ? `${textBody}${divider}${header}\n\n${originalBody}` : `${divider}${header}\n\n${originalBody}`

    const subject = original.subject.startsWith('Fwd:') ? original.subject : `Fwd: ${original.subject}`

    // Forward attachments: fetch each attachment's content
    let attachments
    if (options?.includeAttachments && original.attachments.length > 0) {
      attachments = []
      for (const att of original.attachments) {
        const content = await this.fetchAttachment(mailId, att.filename)
        attachments.push(content)
      }
    }

    const raw = encodeRawEmail({
      from: formatMailAddress(this._config.alias, this._config.user),
      to: to.map((a) => a.address),
      subject,
      text: textBody,
      attachments,
    })

    try {
      const result = await client.users.messages.send({
        userId: 'me',
        requestBody: { raw },
      })
      return { success: true, mailId: result.data.id || '', providerId: result.data.id || undefined }
    } catch (err: any) {
      const mapped = mapGmailApiError(err)
      return { success: false, mailId: '', errorCode: mapped.code, errorMessage: mapped.message }
    }
  }

  async fetchAttachment(mailId: string, filename: string): Promise<AttachmentContent> {
    if (!this._config?.oauth2) {
      throw new Error('Gmail API not connected')
    }

    const { client, oauth2 } = await createAuthenticatedClient(this._config.oauth2)
    this._config.oauth2 = oauth2

    // Get email details (need attachmentId)
    const detail = await client.users.messages.get({
      userId: 'me',
      id: mailId,
      format: 'full',
    })

    const msg = detail.data as unknown as GmailMessage
    const parts = msg.payload?.parts || (msg.payload?.body?.attachmentId ? [msg.payload] : [])

    // Recursively search for attachment
    const attachmentPart = this.findAttachmentPart(parts, filename)
    if (!attachmentPart?.body?.attachmentId) {
      throw new Error(`Attachment "${filename}" not found`)
    }

    // Download attachment
    const attResult = await client.users.messages.attachments.get({
      userId: 'me',
      messageId: mailId,
      id: attachmentPart.body.attachmentId,
    })

    if (!attResult.data.data) {
      throw new Error(`Attachment "${filename}" download failed`)
    }

    // base64url decode
    let base64 = (attResult.data.data as string).replace(/-/g, '+').replace(/_/g, '/')
    while (base64.length % 4 !== 0) base64 += '='
    const content = Buffer.from(base64, 'base64')

    return {
      filename: attachmentPart.filename || filename,
      contentType: attachmentPart.mimeType || 'application/octet-stream',
      size: attResult.data.size || content.length,
      content,
    }
  }

  capabilities(): ProviderCapabilities {
    return {
      realtimePush: false, // Gmail API supports push notifications, can enable later
      imapIdle: false, // API mode does not use IMAP
      threadNative: true, // Gmail API natively supports threads
      aiParsing: false,
      attachmentOcr: false,
      maxAttachmentSize: 35 * 1024 * 1024, // Gmail API limit is 35MB
      sendRateLimit: 30,
    }
  }

  // ── Helper methods ──

  private buildFetchQuery(criteria: FetchCriteria): string {
    const parts: string[] = []

    // Map folder to Gmail label
    if (criteria.folder) {
      const gmailQuery = FOLDER_MAP[criteria.folder]
      if (gmailQuery) parts.push(gmailQuery)
    }

    if (criteria.unread) parts.push('is:unread')
    if (criteria.since) parts.push(`after:${criteria.since.toISOString().slice(0, 10)}`)
    if (criteria.before) parts.push(`before:${criteria.before.toISOString().slice(0, 10)}`)

    return parts.join(' ')
  }

  /**
   * Recursively find attachment part
   */
  private findAttachmentPart(parts: GmailMessagePart[], filename: string): GmailMessagePart | null {
    for (const part of parts) {
      // Nested multipart, recurse
      if (part.mimeType?.startsWith('multipart/') && part.parts) {
        const found = this.findAttachmentPart(part.parts, filename)
        if (found) return found
      }
      // Match attachment filename
      if (part.filename === filename) return part
    }
    return null
  }
}

/**
 * Parse attachment metadata from raw MIME content.
 * Used when Gmail API's format: 'full' collapses a multipart message
 * into a single text/plain payload without parts info.
 * Scans for Content-Type headers with name= parameter to find attachments.
 */
function parseAttachmentsFromRawMime(raw: string): Array<{
  filename: string
  contentType: string
  size: number
}> {
  const results: Array<{ filename: string; contentType: string; size: number }> = []
  const lines = raw.split('\r\n').join('\n').split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Check for Content-Type with name= parameter (indicates attachment)
    const ctMatch = line.match(/^Content-Type:\s*([^;]+);\s*name="([^"]+)"/i)
    if (ctMatch) {
      const contentType = ctMatch[1].trim()
      const filename = ctMatch[2]
      // Estimate size from base64 content
      let size = 0
      let j = i + 1
      while (j < lines.length && lines[j].trim() !== '') j++ // skip headers
      j++ // skip blank line
      let base64Len = 0
      while (j < lines.length && !lines[j].startsWith('--')) {
        base64Len += lines[j].trim().length
        j++
      }
      size = Math.floor((base64Len * 3) / 4)
      results.push({ filename, contentType, size })
    }

    i++
  }

  return results
}
