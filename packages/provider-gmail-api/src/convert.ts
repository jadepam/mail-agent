/**
 * Gmail API 响应 → 统一数据模型转换
 *
 * Gmail API 返回的 Message / Thread 资源转为项目统一的 Mail / MailThread 模型。
 * Gmail API 使用 base64url 编码，需解码后解析邮件头和正文。
 */

import type { Mail, MailAddress, MailBody, Attachment, MailThread, AttachmentContent } from '@mail-agent/core'
import { v7 as uuidv7 } from 'uuid'

// ── Gmail Label 映射 ──

const GMAIL_LABELS: Record<string, string> = {
  INBOX: '收件箱',
  SENT: '已发送',
  TRASH: '已删除',
  DRAFT: '草稿',
  SPAM: '垃圾邮件',
  IMPORTANT: '重要',
  STARRED: '星标',
  UNREAD: '未读',
  CATEGORY_PERSONAL: '个人',
  CATEGORY_SOCIAL: '社交',
  CATEGORY_PROMOTIONS: '促销',
  CATEGORY_UPDATES: '更新',
  CATEGORY_FORUMS: '论坛',
}

// ── Gmail Message → Mail ──

export interface GmailMessage {
  id: string
  threadId?: string
  labelIds?: string[]
  snippet?: string
  payload?: {
    headers?: Array<{ name: string; value: string }>
    mimeType?: string
    body?: { data?: string; size?: number; attachmentId?: string }
    parts?: GmailMessagePart[]
  }
  internalDate?: string
  sizeEstimate?: number
}

export interface GmailMessagePart {
  partId?: string
  mimeType?: string
  filename?: string
  headers?: Array<{ name: string; value: string }>
  body?: { data?: string; size?: number; attachmentId?: string }
  parts?: GmailMessagePart[]
}

export interface GmailThread {
  id: string
  messages?: GmailMessage[]
  snippet?: string
}

/**
 * 将 Gmail Message 资源转为 Mail 模型
 */
export function gmailMessageToMail(msg: GmailMessage, accountId: string, accountAlias: string): Mail {
  const headers = parseHeaders(msg.payload?.headers)
  const labelIds = msg.labelIds || []

  // 解析正文和附件
  const { body, attachments } = parseBodyAndAttachments(msg.payload)

  return {
    id: msg.id,
    providerId: headers.messageId || msg.id,
    accountId,
    accountAlias,
    threadId: msg.threadId || undefined,
    from: parseAddress(headers.from),
    to: parseAddresses(headers.to),
    cc: parseAddresses(headers.cc),
    bcc: parseAddresses(headers.bcc),
    subject: decodeMimeHeader(headers.subject) || '(无主题)',
    body,
    attachments,
    labels: labelIds.map((l) => GMAIL_LABELS[l] || l),
    date: headers.date ? new Date(headers.date) : msg.internalDate ? new Date(parseInt(msg.internalDate)) : new Date(),
    read: !labelIds.includes('UNREAD'),
    starred: labelIds.includes('STARRED'),
  }
}

/**
 * 将 Gmail Thread 资源转为 MailThread 模型
 */
export function gmailThreadToMailThread(thread: GmailThread, accountId: string, accountAlias: string): MailThread {
  const messages = (thread.messages || []).map((m) => gmailMessageToMail(m, accountId, accountAlias))
  const lastMail = messages[messages.length - 1]

  // 收集所有参与者
  const participantMap = new Map<string, MailAddress>()
  for (const m of messages) {
    participantMap.set(m.from.address, m.from)
    for (const t of m.to) participantMap.set(t.address, t)
    for (const c of m.cc) participantMap.set(c.address, c)
  }

  return {
    id: thread.id,
    mails: messages,
    subject: lastMail?.subject || '(无主题)',
    participants: Array.from(participantMap.values()),
    lastMail,
    mailCount: messages.length,
  }
}

// ── 辅助函数 ──

interface ParsedHeaders {
  from: string
  to: string
  cc: string
  bcc: string
  subject: string
  date: string
  messageId: string
  inReplyTo: string
  references: string
  contentType: string
}

function parseHeaders(headers?: Array<{ name: string; value: string }>): ParsedHeaders {
  const result: ParsedHeaders = {
    from: '',
    to: '',
    cc: '',
    bcc: '',
    subject: '',
    date: '',
    messageId: '',
    inReplyTo: '',
    references: '',
    contentType: '',
  }
  if (!headers) return result
  for (const h of headers) {
    const key = h.name.toLowerCase()
    switch (key) {
      case 'from':
        result.from = h.value
        break
      case 'to':
        result.to = h.value
        break
      case 'cc':
        result.cc = h.value
        break
      case 'bcc':
        result.bcc = h.value
        break
      case 'subject':
        result.subject = h.value
        break
      case 'date':
        result.date = h.value
        break
      case 'message-id':
        result.messageId = h.value
        break
      case 'in-reply-to':
        result.inReplyTo = h.value
        break
      case 'references':
        result.references = h.value
        break
      case 'content-type':
        result.contentType = h.value
        break
    }
  }
  return result
}

function parseAddress(raw: string): MailAddress {
  if (!raw) return { name: '', address: '' }
  const addrs = parseAddressList(raw)
  return addrs[0] || { name: '', address: '' }
}

function parseAddresses(raw: string): MailAddress[] {
  if (!raw) return []
  return parseAddressList(raw)
}

/**
 * 解析邮件地址列表
 * 支持: "Name <email>" / "email" / 多个逗号分隔
 */
function parseAddressList(raw: string): MailAddress[] {
  const results: MailAddress[] = []
  if (!raw) return results

  // Simple and robust approach: split by comma, then parse each segment
  // Handle "Name <addr>, Name2 <addr2>" and plain "addr1, addr2"
  // The tricky part is that commas inside <...> shouldn't split (but in practice they don't appear)

  const segments: string[] = []
  let current = ''
  let inAngleBracket = false

  for (const ch of raw) {
    if (ch === '<') inAngleBracket = true
    else if (ch === '>') inAngleBracket = false

    if (ch === ',' && !inAngleBracket) {
      segments.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) segments.push(current.trim())

  for (const seg of segments) {
    if (!seg) continue
    const match = seg.match(/^(.+?)\s*<(.+?)>$/)
    if (match) {
      results.push({ name: decodeMimeHeader(match[1].trim()), address: match[2].trim() })
    } else {
      // 纯邮箱地址
      const email = seg.trim().replace(/[<>"]/g, '')
      if (email.includes('@')) {
        results.push({ name: '', address: email })
      }
    }
  }
  return results
}

/**
 * 解析邮件正文和附件
 *
 * Gmail API 的 payload 结构：
 * - 简单邮件：payload.body.data 包含正文
 * - multipart 邮件：payload.parts 包含各部分
 */
function parseBodyAndAttachments(payload?: GmailMessage['payload']): {
  body: MailBody
  attachments: Attachment[]
} {
  const body: MailBody = { text: '' }
  const attachments: Attachment[] = []

  if (!payload) return { body, attachments }

  if (payload.mimeType?.startsWith('multipart/')) {
    // multipart 邮件：遍历 parts
    parseParts(payload.parts || [], body, attachments)
  } else {
    // 简单邮件：正文在 payload.body
    if (payload.body?.data) {
      const decoded = decodeBase64Url(payload.body.data)
      if (payload.mimeType === 'text/html') {
        body.html = decoded
        body.text = stripHtml(decoded)
      } else {
        body.text = decoded
      }
    }
  }

  return { body, attachments }
}

function parseParts(parts: GmailMessagePart[], body: MailBody, attachments: Attachment[]): void {
  for (const part of parts) {
    if (part.mimeType?.startsWith('multipart/')) {
      // 嵌套 multipart，递归解析
      parseParts(part.parts || [], body, attachments)
      continue
    }

    const isAttachment =
      !!part.filename ||
      part.mimeType?.startsWith('application/') ||
      part.mimeType?.startsWith('image/') ||
      part.mimeType?.startsWith('audio/') ||
      part.mimeType?.startsWith('video/') ||
      !!part.body?.attachmentId ||
      // Also detect parts with Content-Disposition: attachment
      part.headers?.some(
        (h) => h.name.toLowerCase() === 'content-disposition' && h.value.toLowerCase().startsWith('attachment'),
      )

    if (isAttachment) {
      attachments.push({
        filename: part.filename || 'unnamed',
        contentType: part.mimeType || 'application/octet-stream',
        size: part.body?.size || 0,
        contentId: part.headers?.find((h) => h.name.toLowerCase() === 'content-id')?.value?.replace(/[<>]/g, ''),
      })
    } else if (part.mimeType === 'text/plain' && part.body?.data) {
      body.text = decodeBase64Url(part.body.data)
    } else if (part.mimeType === 'text/html' && part.body?.data) {
      body.html = decodeBase64Url(part.body.data)
    }
  }

  // 如果只有 HTML 没有纯文本，从 HTML 提取
  if (!body.text && body.html) {
    body.text = stripHtml(body.html)
  }
}

/**
 * base64url 解码（Gmail API 使用 base64url 而非标准 base64）
 */
export function decodeBase64Url(data: string): string {
  // base64url → base64: 替换 - 为 +, _ 为 /, 补齐 padding
  let base64 = data.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4 !== 0) base64 += '='
  return Buffer.from(base64, 'base64').toString('utf-8')
}

/**
 * 简易 HTML → 纯文本（去除标签）
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

/**
 * 解码 MIME 编码的邮件头（=?UTF-8?B?...?= 或 =?UTF-8?Q?...?=）
 */
export function decodeMimeHeader(raw: string): string {
  if (!raw) return raw

  // 匹配 =?charset?encoding?content?= 格式
  return raw.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (_match, _charset: string, encoding: string, content: string) => {
      try {
        if (encoding.toUpperCase() === 'B') {
          return Buffer.from(content, 'base64').toString('utf-8')
        } else {
          // Quoted-Printable
          return content
            .replace(/_/g, ' ')
            .replace(/=([0-9A-Fa-f]{2})/g, (_m: string, hex: string) => String.fromCharCode(parseInt(hex, 16)))
        }
      } catch {
        return content
      }
    },
  )
}

/**
 * 编码邮件为 RFC 2822 格式并 base64url 编码（用于 Gmail API 发送）
 */
export function encodeRawEmail(mail: {
  from: string
  to: string[]
  subject: string
  text: string
  html?: string
  cc?: string[]
  inReplyTo?: string
  attachments?: AttachmentContent[]
}): string {
  const lines: string[] = []

  // 邮件头（非 ASCII 显示名需 MIME 编码，否则接收方显示乱码）
  lines.push(`From: ${encodeMailHeader(mail.from)}`)
  lines.push(`To: ${mail.to.map(encodeMailHeader).join(', ')}`)
  if (mail.cc?.length) {
    lines.push(`Cc: ${mail.cc.map(encodeMailHeader).join(', ')}`)
  }
  lines.push(`Subject: =?UTF-8?B?${Buffer.from(mail.subject).toString('base64')}?=`)
  lines.push(`Date: ${new Date().toUTCString()}`)
  lines.push('MIME-Version: 1.0')

  if (mail.inReplyTo) {
    lines.push(`In-Reply-To: ${mail.inReplyTo}`)
    lines.push(`References: ${mail.inReplyTo}`)
  }

  const hasAttachments = mail.attachments && mail.attachments.length > 0

  if (hasAttachments) {
    // multipart/mixed: 附件 + 正文
    const mixedBoundary = `mail-agent-mixed-${Date.now()}-${Math.random().toString(36).slice(2)}`
    lines.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`)
    lines.push('')

    // 正文部分
    lines.push(`--${mixedBoundary}`)
    if (mail.html) {
      // multipart/alternative: 纯文本 + HTML
      const altBoundary = `mail-agent-alt-${Date.now()}-${Math.random().toString(36).slice(2)}`
      lines.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`)
      lines.push('')
      lines.push(`--${altBoundary}`)
      lines.push('Content-Type: text/plain; charset=UTF-8')
      lines.push('Content-Transfer-Encoding: base64')
      lines.push('')
      lines.push(Buffer.from(mail.text).toString('base64'))
      lines.push('')
      lines.push(`--${altBoundary}`)
      lines.push('Content-Type: text/html; charset=UTF-8')
      lines.push('Content-Transfer-Encoding: base64')
      lines.push('')
      lines.push(Buffer.from(mail.html).toString('base64'))
      lines.push('')
      lines.push(`--${altBoundary}--`)
    } else {
      lines.push('Content-Type: text/plain; charset=UTF-8')
      lines.push('Content-Transfer-Encoding: base64')
      lines.push('')
      lines.push(Buffer.from(mail.text).toString('base64'))
    }
    lines.push('')

    // 附件部分
    for (const att of mail.attachments!) {
      lines.push(`--${mixedBoundary}`)
      lines.push(`Content-Type: ${att.contentType}; name="${att.filename}"`)
      lines.push('Content-Transfer-Encoding: base64')
      lines.push(`Content-Disposition: attachment; filename="${att.filename}"`)
      lines.push('')
      // base64 编码附件内容，每行 76 字符
      const attBase64 = att.content.toString('base64')
      for (let i = 0; i < attBase64.length; i += 76) {
        lines.push(attBase64.slice(i, i + 76))
      }
      lines.push('')
    }

    lines.push(`--${mixedBoundary}--`)
  } else if (mail.html) {
    // multipart/alternative: 同时包含纯文本和 HTML
    const boundary = `mail-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`)
    lines.push('')
    lines.push(`--${boundary}`)
    lines.push('Content-Type: text/plain; charset=UTF-8')
    lines.push('Content-Transfer-Encoding: base64')
    lines.push('')
    lines.push(Buffer.from(mail.text).toString('base64'))
    lines.push('')
    lines.push(`--${boundary}`)
    lines.push('Content-Type: text/html; charset=UTF-8')
    lines.push('Content-Transfer-Encoding: base64')
    lines.push('')
    lines.push(Buffer.from(mail.html).toString('base64'))
    lines.push('')
    lines.push(`--${boundary}--`)
  } else {
    lines.push('Content-Type: text/plain; charset=UTF-8')
    lines.push('Content-Transfer-Encoding: base64')
    lines.push('')
    lines.push(Buffer.from(mail.text).toString('base64'))
  }

  const raw = lines.join('\r\n')
  // base64url 编码
  return Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * 编码邮件头中的非 ASCII 显示名
 *
 * "谷歌邮箱 <xxx@gmail.com>" → "=?UTF-8?B?6K6i5L+W6YKu566x?= <xxx@gmail.com>"
 * "bob@x.com" → "bob@x.com"（纯 ASCII 不变）
 */
function encodeMailHeader(header: string): string {
  // 已经是 MIME 编码的，不重复编码
  if (header.includes('=?')) return header

  const match = header.match(/^(.+?)\s*<(.+?)>$/)
  if (match) {
    const [, name, email] = match
    // 显示名包含非 ASCII 字符时，做 MIME 编码
    if (/[^\x00-\x7F]/.test(name)) {
      const encoded = `=?UTF-8?B?${Buffer.from(name.trim()).toString('base64')}?=`
      return `${encoded} <${email}>`
    }
    return header
  }
  // 纯邮箱地址或纯 ASCII，不编码
  return header
}
