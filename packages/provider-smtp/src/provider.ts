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
  ProtocolDiagnostic,
  OAuth2Diagnostic,
  ReplyOptions,
  ForwardOptions,
  MailAddress,
  AttachmentContent,
} from '@mail-agent/core'
import { resolveSmtpConfig, resolveImapConfig, isOAuth2Account, isTokenExpired } from '@mail-agent/core'
import { SmtpSender } from './sender.js'
import { ImapReceiver } from './receiver.js'

/**
 * SMTP/IMAP 适配器 — 兼容公网邮箱（QQ/163/Gmail）与企业私有化邮箱
 */
export class SmtpImapProvider implements MailProvider {
  private sender: SmtpSender
  private receiver: ImapReceiver
  private _config: AccountConfig | null = null

  constructor() {
    this.sender = new SmtpSender()
    this.receiver = new ImapReceiver()
  }

  async connect(config: AccountConfig): Promise<void> {
    this._config = config
    await this.sender.connect(config)
    await this.receiver.connect(config)
  }

  async disconnect(): Promise<void> {
    await this.sender.disconnect()
    await this.receiver.disconnect()
  }

  async healthCheck(): Promise<HealthStatus> {
    const accountId = this._config?.id || ''
    const alias = this._config?.alias || ''
    const provider = this._config?.provider || 'smtp-imap'

    if (!this._config) {
      return { connected: false, accountId, alias, provider }
    }

    const diagnostics: ConnectionDiagnostics = {}
    let smtpOk = false
    let imapOk = false

    // 测试 SMTP 连接
    try {
      const start = Date.now()
      const testSender = new SmtpSender()
      await testSender.connect(this._config)
      await testSender.disconnect()
      const latencyMs = Date.now() - start

      const smtp = resolveSmtpConfig(this._config)
      diagnostics.smtp = {
        connected: true,
        host: smtp.host || '',
        port: smtp.port || 0,
        secure: smtp.secure ?? false,
        authMethod: isOAuth2Account(this._config) ? 'OAuth2' : 'password',
        latencyMs,
      }
      smtpOk = true
    } catch (err: any) {
      const smtp = resolveSmtpConfig(this._config)
      diagnostics.smtp = {
        connected: false,
        host: smtp.host || '',
        port: smtp.port || 0,
        secure: smtp.secure ?? false,
        authMethod: isOAuth2Account(this._config) ? 'OAuth2' : 'password',
        latencyMs: 0,
        error: err.message,
      }
    }

    // 测试 IMAP 连接
    try {
      const start = Date.now()
      const testReceiver = new ImapReceiver()
      await testReceiver.connect(this._config)
      await testReceiver.disconnect()
      const latencyMs = Date.now() - start

      const imap = resolveImapConfig(this._config)
      diagnostics.imap = {
        connected: true,
        host: imap.host || '',
        port: imap.port || 0,
        secure: imap.tls ?? false,
        authMethod: isOAuth2Account(this._config) ? 'OAuth2' : 'password',
        latencyMs,
      }
      imapOk = true
    } catch (err: any) {
      const imap = resolveImapConfig(this._config)
      diagnostics.imap = {
        connected: false,
        host: imap.host || '',
        port: imap.port || 0,
        secure: imap.tls ?? false,
        authMethod: isOAuth2Account(this._config) ? 'OAuth2' : 'password',
        latencyMs: 0,
        error: err.message,
      }
    }

    // OAuth2 诊断
    if (this._config.oauth2) {
      diagnostics.oauth2 = {
        tokenExpiry: this._config.oauth2.expires ? new Date(this._config.oauth2.expires).toISOString() : undefined,
        isExpired: isTokenExpired(this._config.oauth2),
      }
    }

    return {
      connected: smtpOk && imapOk,
      accountId,
      alias,
      provider,
      diagnostics,
    }
  }

  async send(mail: OutboundMail): Promise<SendResult> {
    return this.sender.send(mail)
  }

  async fetch(criteria: FetchCriteria): Promise<Mail[]> {
    return this.receiver.fetch(criteria)
  }

  async read(mailId: string): Promise<Mail> {
    return this.receiver.read(mailId)
  }

  async search(criteria: SearchCriteria): Promise<Mail[]> {
    return this.receiver.search(criteria)
  }

  async getThread(threadId: string): Promise<MailThread> {
    // L1 会话归并：搜索 INBOX 中 threadId 匹配的邮件
    const mails = await this.receiver.fetch({ limit: 200, folder: 'INBOX' })

    // 筛选同一会话的邮件（threadId 匹配）
    const threadMails = mails.filter((m) => m.threadId === threadId)

    if (threadMails.length === 0) {
      throw new Error(`会话 ${threadId} 不存在或 INBOX 中无匹配邮件`)
    }

    // 按日期升序排列（最早的在前）
    threadMails.sort((a, b) => a.date.getTime() - b.date.getTime())

    // 收集所有参与者
    const participantMap = new Map<string, { name: string; address: string }>()
    for (const m of threadMails) {
      participantMap.set(m.from.address, m.from)
      for (const t of m.to) participantMap.set(t.address, t)
      for (const c of m.cc) participantMap.set(c.address, c)
    }

    const lastMail = threadMails[threadMails.length - 1]

    return {
      id: threadId,
      mails: threadMails,
      subject: lastMail.subject,
      participants: Array.from(participantMap.values()),
      lastMail,
      mailCount: threadMails.length,
    }
  }

  async trash(mailId: string): Promise<void> {
    return this.receiver.trash(mailId)
  }

  async reply(mailId: string, body: string, options?: ReplyOptions): Promise<SendResult> {
    const original = await this.receiver.read(mailId)

    // 构造回复收件人
    let replyTo: MailAddress[]
    let replyCc: MailAddress[] | undefined

    if (options?.replyAll) {
      // 回复全部：原 from + 原 to（排除自己）+ 原 cc（排除自己）+ 追加 cc
      const myEmail = this._config?.user?.toLowerCase() || ''
      replyTo = [original.from, ...original.to].filter((a) => a.address.toLowerCase() !== myEmail)
      replyCc = [...original.cc].filter((a) => a.address.toLowerCase() !== myEmail)
      if (options.cc) replyCc = [...(replyCc || []), ...options.cc]
    } else {
      // 仅回复发件人
      replyTo = [original.from]
      if (options?.cc) replyCc = options.cc
    }

    // 构造引用正文
    let textBody = body
    const quoteOriginal = options?.quoteOriginal !== false // 默认引用
    if (quoteOriginal && original.body.text) {
      const quoted = original.body.text
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
      const dateStr = original.date.toLocaleString('zh-CN')
      const fromStr = original.from.name || original.from.address
      textBody = `${body}\n\n${dateStr}，${fromStr} 写道：\n${quoted}`
    }

    // 构造回复主题
    const subject = original.subject.startsWith('Re:') ? original.subject : `Re: ${original.subject}`

    return this.sender.send({
      to: replyTo,
      subject,
      body: { text: textBody },
      cc: replyCc,
      inReplyTo: original.providerId,
    })
  }

  async forward(mailId: string, to: MailAddress[], options?: ForwardOptions): Promise<SendResult> {
    const original = await this.receiver.read(mailId)

    // 构造转发正文
    let textBody = options?.body || ''
    const divider = '\n\n---------- 转发的邮件 ----------\n'
    const header = [
      `发件人: ${original.from.name ? original.from.name + ' <' + original.from.address + '>' : original.from.address}`,
      `日期: ${original.date.toLocaleString('zh-CN')}`,
      `主题: ${original.subject}`,
      `收件人: ${original.to.map((a) => a.address).join(', ')}`,
    ].join('\n')
    const originalBody = original.body.text || '(无正文)'

    textBody = textBody ? `${textBody}${divider}${header}\n\n${originalBody}` : `${divider}${header}\n\n${originalBody}`

    // 构造转发主题
    const subject = original.subject.startsWith('Fwd:') ? original.subject : `Fwd: ${original.subject}`

    // 附件转发：逐个获取附件内容
    let attachmentContents
    if (options?.includeAttachments && original.attachments.length > 0) {
      attachmentContents = []
      for (const att of original.attachments) {
        const content = await this.receiver.fetchAttachment(mailId, att.filename)
        attachmentContents.push(content)
      }
    }

    return this.sender.send({
      to,
      subject,
      body: { text: textBody },
      attachmentContents,
    })
  }

  async fetchAttachment(mailId: string, filename: string): Promise<AttachmentContent> {
    return this.receiver.fetchAttachment(mailId, filename)
  }

  capabilities(): ProviderCapabilities {
    const isPrivate = this._config?.network === 'private'
    return {
      realtimePush: false,
      imapIdle: true,
      threadNative: true, // L1: 基于 References/In-Reply-To 的本地归并
      aiParsing: false,
      attachmentOcr: false,
      maxAttachmentSize: isPrivate ? 50 * 1024 * 1024 : 25 * 1024 * 1024,
      sendRateLimit: isPrivate ? 0 : 30,
    }
  }
}
