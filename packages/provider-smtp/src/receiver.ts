import { ImapFlow } from 'imapflow'
import { simpleParser, type ParsedMail } from 'mailparser'
import type {
  AccountConfig,
  Mail,
  FetchCriteria,
  SearchCriteria,
  OAuth2Credentials,
  AttachmentContent,
  MailError,
} from '@mail-agent/core'
import { resolveImapConfig, isOAuth2Account, DEFAULT_FETCH_LIMIT } from '@mail-agent/core'
import { v7 as uuidv7 } from 'uuid'
import { refreshAccessToken, isTokenExpired } from './oauth2.js'
import { mapImapError, withRetry } from './errors.js'

/**
 * 规范化 Message-ID — 去掉尖括号，保持格式一致
 *
 * <abc@def.com> → abc@def.com
 * abc@def.com   → abc@def.com
 */
export function normalizeMessageId(messageId: string): string {
  if (!messageId) return messageId
  return messageId.trim().replace(/^</, '').replace(/>$/, '').trim()
}

/**
 * IMAP 接收封装 — 基于 imapflow + mailparser
 * 支持密码认证（QQ/163/企业邮箱）与 OAuth2 认证（Gmail/Outlook）
 *
 * 注意：imapflow 不支持自动刷新 token，
 * OAuth2 模式下需要在连接前手动刷新 accessToken
 */
export class ImapReceiver {
  private client: ImapFlow | null = null
  private config: AccountConfig | null = null

  async connect(config: AccountConfig): Promise<void> {
    const imap = resolveImapConfig(config)
    if (!imap.host) {
      throw new Error(`账号 ${config.alias} 缺少 IMAP 配置`)
    }
    this.config = config

    if (isOAuth2Account(config) && config.oauth2) {
      // OAuth2 模式：先刷新 accessToken，再用 accessToken 连接
      const oauth2 = await this.ensureFreshToken(config.oauth2, config.provider)
      config.oauth2 = oauth2 // 更新 config 中的 token

      this.client = new ImapFlow({
        host: imap.host,
        port: imap.port,
        secure: imap.tls,
        auth: {
          user: imap.user,
          accessToken: oauth2.accessToken,
        },
        tls: imap.rejectUnauthorized === false ? { rejectUnauthorized: false } : undefined,
        logger: false as any,
      })
    } else {
      // 密码/授权码认证
      this.client = new ImapFlow({
        host: imap.host,
        port: imap.port,
        secure: imap.tls,
        auth: {
          user: imap.user,
          pass: imap.pass,
        },
        tls: imap.rejectUnauthorized === false ? { rejectUnauthorized: false } : undefined,
        logger: false as any,
      })
    }

    await this.client.connect()
  }

  /**
   * 确保 OAuth2 accessToken 有效，过期则自动刷新
   */
  private async ensureFreshToken(oauth2: OAuth2Credentials, provider: string): Promise<OAuth2Credentials> {
    if (!isTokenExpired(oauth2) && oauth2.accessToken) {
      return oauth2
    }

    // token 过期或即将过期，刷新
    return await refreshAccessToken(oauth2, provider)
  }

  async fetch(criteria: FetchCriteria): Promise<Mail[]> {
    if (!this.client || !this.config) {
      throw new Error('IMAP 未连接')
    }

    return withRetry(async () => {
      const lock = await this.client!.getMailboxLock(criteria.folder || 'INBOX')
      try {
        const limit = criteria.limit || DEFAULT_FETCH_LIMIT
        const mails: Mail[] = []

        let fetchQuery = criteria.unread ? 'UNSEEN' : 'ALL'
        if (criteria.since) {
          fetchQuery += ` SINCE ${criteria.since.toISOString().slice(0, 10)}`
        }

        for await (const msg of this.client!.fetch(
          { [fetchQuery === 'UNSEEN' ? 'unseen' : 'all']: true },
          { source: true, flags: true, envelope: true },
          { uid: true },
        )) {
          if (mails.length >= limit) break

          const parsed = await simpleParser(msg.source)
          mails.push(this.toMail(parsed, this.config!, String(msg.uid), msg.flags))
        }

        return mails
      } finally {
        lock.release()
      }
    }, 'IMAP fetch')
  }

  async read(mailId: string): Promise<Mail> {
    if (!this.client || !this.config) {
      throw new Error('IMAP 未连接')
    }

    const lock = await this.client.getMailboxLock('INBOX')
    try {
      // 策略1: 尝试作为 IMAP UID 直接获取
      const uid = parseInt(mailId)
      if (uid > 0) {
        for await (const msg of this.client.fetch({ uid }, { source: true, flags: true, envelope: true })) {
          const parsed = await simpleParser(msg.source)
          return this.toMail(parsed, this.config!, String(msg.uid), msg.flags)
        }
      }

      // 策略2: 通过 Message-ID HEADER 搜索（部分 IMAP 服务器支持）
      const messageId = mailId.startsWith('<') ? mailId : `<${mailId}>`
      const uids = await this.client.search({ header: { 'Message-ID': messageId } })
      if (uids && uids.length > 0) {
        for await (const msg of this.client.fetch({ uid: uids[0] }, { source: true, flags: true, envelope: true })) {
          const parsed = await simpleParser(msg.source)
          return this.toMail(parsed, this.config!, String(msg.uid), msg.flags)
        }
      }

      // 策略3: 遍历最近邮件匹配 Message-ID（兼容不支持 HEADER 搜索的服务器如 QQ 邮箱）
      // 只获取 envelope 来匹配，找到后再获取完整 source，限制扫描最近200封
      let scanCount = 0
      const scanLimit = 200
      for await (const msg of this.client.fetch({ all: true }, { envelope: true, flags: true }, { uid: true })) {
        scanCount++
        if (scanCount > scanLimit) break

        // envelope 中的 messageId 可能不含尖括号，做宽松匹配
        const envMsgId = msg.envelope.messageId || ''
        if (
          envMsgId === messageId ||
          envMsgId === mailId ||
          `<${envMsgId}>` === messageId ||
          envMsgId.includes(mailId.replace(/[<>]/g, ''))
        ) {
          // 找到匹配，获取完整 source
          for await (const fullMsg of this.client.fetch(
            { uid: msg.uid },
            { source: true, flags: true, envelope: true },
          )) {
            const parsed = await simpleParser(fullMsg.source)
            return this.toMail(parsed, this.config!, String(fullMsg.uid), fullMsg.flags)
          }
        }
      }

      throw new Error(`邮件 ${mailId} 不存在`)
    } finally {
      lock.release()
    }
  }

  async search(criteria: SearchCriteria): Promise<Mail[]> {
    if (!this.client || !this.config) {
      throw new Error('IMAP 未连接')
    }

    const lock = await this.client.getMailboxLock(criteria.folder || 'INBOX')
    try {
      const limit = criteria.limit || DEFAULT_FETCH_LIMIT
      const mails: Mail[] = []

      const searchCriteria: Record<string, any> = {}
      if (criteria.query) searchCriteria.subject = criteria.query
      if (criteria.from) searchCriteria.from = criteria.from
      if (criteria.to) searchCriteria.to = criteria.to
      if (criteria.unread) searchCriteria.unseen = true
      if (criteria.since) searchCriteria.since = criteria.since
      if (criteria.before) searchCriteria.before = criteria.before

      for await (const msg of this.client.fetch(searchCriteria, { source: true, flags: true, envelope: true })) {
        if (mails.length >= limit) break
        const parsed = await simpleParser(msg.source)
        const mail = this.toMail(parsed, this.config!, String(msg.uid), msg.flags)
        // hasAttachments 由客户端过滤（IMAP 标准搜索不支持附件标志）
        if (criteria.hasAttachments && mail.attachments.length === 0) continue
        mails.push(mail)
      }

      return mails
    } finally {
      lock.release()
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.logout()
      this.client = null
    }
  }

  /**
   * 将邮件移入回收站（IMAP MOVE / COPY+DELETE 回退）
   *
   * 不同邮箱的 Trash 文件夹名不同：
   * - QQ 邮箱：&XfJT0ZAB-（Modified UTF-7 编码的"已删除"）
   * - 163 邮箱：&XfJT0ZAB- 或 Deleted Messages
   * - Outlook：Deleted Items
   * - 通用：Trash / Deleted Messages / 已删除
   *
   * 策略：先尝试 MOVE，不支持则 COPY+DELETE 回退
   */
  async trash(mailId: string): Promise<void> {
    if (!this.client || !this.config) {
      throw new Error('IMAP 未连接')
    }

    const trashFolder = await this.findTrashFolder()
    if (!trashFolder) {
      throw new Error('未找到回收站文件夹，无法删除邮件')
    }

    const uid = parseInt(mailId)
    if (uid <= 0) {
      throw new Error(`无效的邮件 ID: ${mailId}`)
    }

    // 尝试 IMAP MOVE（RFC 6851）
    try {
      const lock = await this.client.getMailboxLock('INBOX')
      try {
        const result = await this.client.messageMove(uid, trashFolder, { uid: true })
        if (result === false) {
          // MOVE 不支持，回退到 COPY + DELETE
          await this.fallbackTrash(uid, trashFolder)
        }
      } finally {
        lock.release()
      }
    } catch {
      // MOVE 失败，回退到 COPY + DELETE
      const lock = await this.client.getMailboxLock('INBOX')
      try {
        await this.fallbackTrash(uid, trashFolder)
      } finally {
        lock.release()
      }
    }
  }

  /**
   * 探测 Trash 文件夹名
   *
   * 先列出所有文件夹，按优先级匹配：
   * 1. 常见 Trash 文件夹名
   * 2. 包含 "trash"/"deleted"/"已删除" 关键词的文件夹
   */
  private async findTrashFolder(): Promise<string | null> {
    if (!this.client) return null

    // 常见 Trash 文件夹名（按优先级排列）
    const knownTrashNames = [
      '&XfJT0ZAB-', // QQ/163 已删除（Modified UTF-7）
      'Trash', // Gmail / 通用
      'Deleted Messages', // Apple Mail
      'Deleted Items', // Outlook
      'Junk', // 部分邮箱
    ]

    try {
      const folders = await this.client.list()
      for (const name of knownTrashNames) {
        const found = folders.find((f) => f.path === name)
        if (found) return found.path
      }
      // 按关键词模糊匹配
      const keywords = ['trash', 'deleted', '已删除', '垃圾']
      for (const f of folders) {
        const lower = f.path.toLowerCase()
        if (keywords.some((kw) => lower.includes(kw))) {
          return f.path
        }
      }
    } catch {
      // list 失败，尝试已知名称直接使用
      for (const name of knownTrashNames) {
        try {
          const lock = await this.client.getMailboxLock(name)
          lock.release()
          return name
        } catch {
          continue
        }
      }
    }
    return null
  }

  /**
   * 下载附件 — 重新 FETCH 邮件源码并提取指定附件内容
   *
   * 不缓存附件内容，每次重新获取（避免内存占用过大）
   */
  async fetchAttachment(mailId: string, filename: string): Promise<AttachmentContent> {
    if (!this.client || !this.config) {
      throw new Error('IMAP 未连接')
    }

    const uid = parseInt(mailId)
    if (uid <= 0) {
      throw new Error(`无效的邮件 ID: ${mailId}`)
    }

    const lock = await this.client.getMailboxLock('INBOX')
    try {
      // 获取邮件源码
      const message = await this.client.fetchOne(uid, { source: true }, { uid: true })
      if (!message.source) {
        throw new Error(`邮件 ${mailId} 源码获取失败`)
      }

      // 解析邮件，提取附件
      const parsed = await simpleParser(message.source)

      const attachment = parsed.attachments.find((att) => att.filename === filename || att.contentId === filename)

      if (!attachment) {
        const available = parsed.attachments.map((a) => a.filename).join(', ')
        throw new Error(`附件 "${filename}" 未找到。可用附件：${available || '无'}`)
      }

      return {
        filename: attachment.filename || filename,
        contentType: attachment.contentType,
        size: attachment.size,
        content: attachment.content,
      }
    } finally {
      lock.release()
    }
  }

  /**
   * COPY + DELETE 回退：将邮件复制到 Trash 后标记原邮件删除
   */
  private async fallbackTrash(uid: number, trashFolder: string): Promise<void> {
    if (!this.client) return

    await this.client.messageCopy(uid, trashFolder, { uid: true })
    await this.client.messageFlagsAdd(uid, ['\\Deleted'], { uid: true })
    await this.client.expunge()
  }

  private toMail(parsed: ParsedMail, config: AccountConfig, imapUid?: string, flags?: Set<string> | string[]): Mail {
    const flagArr = flags instanceof Set ? Array.from(flags) : Array.isArray(flags) ? flags : []
    const isRead = !flagArr.includes('\\Seen')
    const isStarred = flagArr.includes('\\Flagged')
    return {
      id: imapUid || uuidv7(),
      providerId: normalizeMessageId(parsed.messageId || ''),
      accountId: config.id,
      accountAlias: config.alias,
      threadId: this.extractThreadId(parsed),
      from: this.toMailAddress(parsed.from),
      to: this.toMailAddresses(parsed.to),
      cc: this.toMailAddresses(parsed.cc),
      bcc: this.toMailAddresses(parsed.bcc),
      subject: parsed.subject || '(无主题)',
      body: {
        text: parsed.text || '',
        html: parsed.html || undefined,
      },
      attachments: (parsed.attachments || []).map((att) => ({
        filename: att.filename || 'unnamed',
        contentType: att.contentType,
        size: att.size,
        contentId: att.contentId || undefined,
      })),
      labels: this.extractLabels(flagArr),
      date: parsed.date || new Date(),
      read: isRead,
      starred: isStarred,
    }
  }

  /** 从 IMAP flags 提取标签（\\Flagged 等系统标签除外） */
  private extractLabels(flags: string[]): string[] {
    return flags.filter((f) => !f.startsWith('\\'))
  }

  /**
   * 从邮件头提取 threadId
   *
   * 算法（L1 级别）：
   * 1. 如果有 References 头，取 References 数组的第一个（最早的 Message-ID）作为 threadId
   * 2. 如果没有 References 但有 In-Reply-To，用 In-Reply-To 作为 threadId
   * 3. 如果都没有，返回 undefined（新邮件，不属于任何会话）
   *
   * Message-ID 格式规范化：去掉尖括号 <...>，统一为纯字符串
   */
  private extractThreadId(parsed: ParsedMail): string | undefined {
    const refs = parsed.references
    if (refs && Array.isArray(refs) && refs.length > 0) {
      // References 链中第一个是最早的 Message-ID，即会话根
      return normalizeMessageId(refs[0] as string)
    }

    // 没有 References 时，回退到 In-Reply-To
    const inReplyTo = parsed.inReplyTo
    if (inReplyTo && typeof inReplyTo === 'string') {
      return normalizeMessageId(inReplyTo)
    }

    return undefined
  }

  private toMailAddress(addr: any): { name: string; address: string } {
    if (!addr) return { name: '', address: '' }
    if (typeof addr === 'object' && 'value' in addr && Array.isArray((addr as any).value)) {
      const first = (addr as any).value[0]
      return { name: first?.name || '', address: first?.address || '' }
    }
    return { name: (addr as any).name || '', address: (addr as any).address || '' }
  }

  private toMailAddresses(addrs: any): { name: string; address: string }[] {
    if (!addrs) return []
    if (typeof addrs === 'object' && 'value' in addrs && Array.isArray((addrs as any).value)) {
      return (addrs as any).value.map((a: any) => ({
        name: a?.name || '',
        address: a?.address || '',
      }))
    }
    if (Array.isArray(addrs)) {
      return addrs.map((a: any) => ({ name: a?.name || '', address: a?.address || '' }))
    }
    return [this.toMailAddress(addrs)]
  }
}
