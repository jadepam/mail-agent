/**
 * Lark message format → unified Mail model conversion
 *
 * Converts lark-cli +message / +triage output to the Mail Agent Mail interface.
 * Lark has native thread support, so threadId is always populated when available.
 */

import type { Mail, MailAddress, MailThread, Attachment } from '@mail-agent/core'
import type { LarkMessage, LarkAddress, LarkTriageMessage, LarkAttachment, LarkThreadResult } from './cli.js'

/** Folder name mapping: Mail Agent standard → Lark folder_id */
export const FOLDER_MAP: Record<string, string> = {
  INBOX: 'INBOX',
  SENT: 'SENT',
  TRASH: 'TRASH',
  DRAFT: 'DRAFT',
  SPAM: 'SPAM',
  ARCHIVED: 'ARCHIVED',
  STRANGER: 'STRANGER',
}

/** Reverse mapping: Lark folder_id → Mail Agent folder name */
const FOLDER_REVERSE_MAP: Record<string, string> = {
  INBOX: 'INBOX',
  SENT: 'SENT',
  TRASH: 'TRASH',
  DRAFT: 'DRAFT',
  SPAM: 'SPAM',
  ARCHIVED: 'ARCHIVED',
  STRANGER: 'STRANGER',
}

/**
 * Convert a full LarkMessage (from +message) to Mail model
 */
export function toMail(msg: LarkMessage, accountId: string, accountAlias: string): Mail {
  return {
    id: msg.message_id,
    providerId: msg.message_id,
    accountId,
    accountAlias,
    threadId: msg.thread_id || undefined,
    from: toMailAddress(msg.head_from),
    to: msg.to.map(toMailAddress),
    cc: msg.cc.map(toMailAddress),
    bcc: msg.bcc.map(toMailAddress),
    subject: msg.subject || '(No Subject)',
    body: {
      text: msg.body_plain_text || stripHtmlTags(msg.body_html) || msg.body_preview || '',
      html: msg.body_html || undefined,
    },
    attachments: (msg.attachments || []).filter((a) => !a.is_inline).map(toAttachment),
    labels: [...(msg.folder_id ? [FOLDER_REVERSE_MAP[msg.folder_id] || msg.folder_id] : []), ...(msg.label_ids || [])],
    date: parseLarkDate(msg.internal_date || msg.date),
    read: !(msg.label_ids || []).some((l) => l === 'UNREAD'),
    starred: (msg.label_ids || []).some((l) => l === 'STARRED'),
  }
}

/**
 * Convert a LarkTriageMessage (from +triage summary) to Mail model
 *
 * +triage returns lighter summaries — body and attachments are not included.
 */
export function triageToMail(msg: LarkTriageMessage, accountId: string, accountAlias: string): Mail {
  const labels = msg.labels ? msg.labels.split(',').map((l) => l.trim()) : []
  return {
    id: msg.message_id,
    providerId: msg.message_id,
    accountId,
    accountAlias,
    threadId: undefined, // +triage doesn't return thread_id
    from: parseFormattedAddress(msg.from),
    to: [],
    cc: [],
    bcc: [],
    subject: msg.subject || '(No Subject)',
    body: {
      text: '', // +triage doesn't include body
    },
    attachments: [],
    labels,
    date: parseLarkDate(msg.date),
    read: !labels.some((l) => l === 'UNREAD'),
    starred: labels.some((l) => l === 'STARRED'),
  }
}

/**
 * Convert a LarkThreadResult to MailThread model
 */
export function toThread(result: LarkThreadResult, accountId: string, accountAlias: string): MailThread {
  return {
    threadId: result.thread_id,
    mails: result.messages.map((msg) => toMail(msg, accountId, accountAlias)),
    participants: extractParticipants(result.messages),
    subject: result.messages[0]?.subject || '(No Subject)',
  }
}

// ── Helper Functions ──

/**
 * Convert LarkAddress to MailAddress
 */
function toMailAddress(addr: LarkAddress): MailAddress {
  return {
    name: addr.name || '',
    address: addr.mail_address,
  }
}

/**
 * Convert LarkAttachment to Attachment
 */
function toAttachment(att: LarkAttachment): Attachment {
  return {
    filename: att.filename,
    contentType: att.content_type,
    size: att.size || 0,
    contentId: att.cid,
  }
}

/**
 * Parse formatted address string like "Alice <alice@example.com>"
 * Used for +triage output where from is a string, not a structured address
 */
function parseFormattedAddress(formatted: string): MailAddress {
  const match = formatted.match(/^(.+?)\s*<(.+?)>$/)
  if (match) {
    return {
      name: match[1].trim().replace(/^"|"$/g, ''),
      address: match[2].trim(),
    }
  }
  // No angle brackets — treat entire string as email
  return {
    name: '',
    address: formatted.trim(),
  }
}

/**
 * Extract unique participants from thread messages
 */
function extractParticipants(messages: LarkMessage[]): MailAddress[] {
  const seen = new Set<string>()
  const participants: MailAddress[] = []

  for (const msg of messages) {
    const allAddrs = [msg.head_from, ...msg.to, ...msg.cc]
    for (const addr of allAddrs) {
      const key = addr.mail_address.toLowerCase()
      if (!seen.has(key)) {
        seen.add(key)
        participants.push(toMailAddress(addr))
      }
    }
  }

  return participants
}

/**
 * Parse Lark date string to Date object
 *
 * Lark dates can be:
 * - RFC 2822: "Fri, 21 Mar 2026 11:40:00 +0800"
 * - ISO 8601: "2026-03-21T11:40:00+08:00"
 * - Unix timestamp string
 */
function parseLarkDate(dateStr: string): Date {
  if (!dateStr) return new Date()

  // Try parsing directly
  const d = new Date(dateStr)
  if (!isNaN(d.getTime())) return d

  // Fallback: might be a unix timestamp
  const ts = Number(dateStr)
  if (!isNaN(ts) && ts > 0) {
    return new Date(ts * 1000)
  }

  return new Date()
}

/**
 * Simple HTML tag stripping — when Lark returns HTML but no plain text,
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
 * Build --filter JSON for +triage from FetchCriteria fields
 */
export function buildFilterJson(options: {
  folder?: string
  unread?: boolean
  from?: string
  hasAttachment?: boolean
  startTime?: string
  endTime?: string
}): string {
  const filter: Record<string, unknown> = {}

  if (options.folder) {
    filter.folder = FOLDER_MAP[options.folder] || options.folder
  }
  if (options.unread) {
    filter.is_unread = true
  }
  if (options.from) {
    filter.from = [options.from]
  }
  if (options.hasAttachment) {
    filter.has_attachment = true
  }
  if (options.startTime || options.endTime) {
    const timeRange: Record<string, string> = {}
    if (options.startTime) timeRange.start_time = options.startTime
    if (options.endTime) timeRange.end_time = options.endTime
    filter.time_range = timeRange
  }

  return JSON.stringify(filter)
}
