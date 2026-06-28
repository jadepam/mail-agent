/**
 * CLI table rendering utility — wrapper around cli-table3
 *
 * Usage:
 *   const t = new Table();
 *   t.header(['#', 'Date', 'Sender', 'Subject', 'Status']);
 *   t.colWidths([4, 12, 30, undefined, 8]);  // undefined = auto-size
 *   t.row(['1', '2026-06-25\n16:00', 'adi@x.com', 'Hello', '🔵 Unread']);
 *   console.log(t.render());
 */

import CliTable3 from 'cli-table3'
import type { Mail } from '@mail-agent/core'

export class Table {
  private _headers: string[] = []
  private _rows: string[][] = []
  private _colWidths: (number | null)[] = []
  private _aligns: ('left' | 'right' | 'center')[] = []

  /** Set headers */
  header(cols: string[], aligns?: ('left' | 'right' | 'center')[]): this {
    this._headers = cols
    this._aligns = aligns || cols.map(() => 'left')
    return this
  }

  /** Set column widths (null = auto-size) */
  colWidths(widths: (number | null)[]): this {
    this._colWidths = widths
    return this
  }

  /** Add a row (cells support \n for line breaks) */
  row(cols: string[]): this {
    this._rows.push(cols)
    return this
  }

  /** Render table string */
  render(): string {
    if (this._headers.length === 0) return ''

    const termWidth = process.stdout.columns || 80
    const colCount = this._headers.length

    // Compute actual column widths
    const widths = this.resolveColWidths(termWidth)

    const table = new CliTable3({
      head: this._headers,
      colWidths: widths,
      colAligns: this._aligns as ('left' | 'right' | 'center')[],
      wordWrap: true,
      wrapOnWordBoundary: true,
      chars: {
        top: '─',
        'top-mid': '┬',
        'top-left': '┌',
        'top-right': '┐',
        bottom: '─',
        'bottom-mid': '┴',
        'bottom-left': '└',
        'bottom-right': '┘',
        left: '│',
        'left-mid': '├',
        mid: '─',
        'mid-mid': '┼',
        right: '│',
        'right-mid': '┤',
        middle: '│',
      },
      style: {
        'padding-left': 1,
        'padding-right': 1,
        compact: false,
        head: [], // no color
        border: [], // no color
      },
    })

    for (const row of this._rows) {
      table.push(row)
    }

    return table.toString()
  }

  /** Compute actual column widths based on terminal size and configuration */
  private resolveColWidths(termWidth: number): number[] {
    // cli-table3 has internal padding (default 1 on each side), plus borders
    // Actual column width = width + 2(padding) + 1(left border) = width + 3
    // Total width = sum(width+3) + 1(right border)
    const borderOverhead = this._headers.length * 3 + 1
    const availWidth = termWidth - borderOverhead

    const widths: number[] = []

    // Fill in fixed widths first
    let fixedTotal = 0
    let flexCount = 0
    for (let i = 0; i < this._headers.length; i++) {
      const w = this._colWidths[i]
      if (w != null && w > 0) {
        widths[i] = w
        fixedTotal += w
      } else {
        widths[i] = 0 // placeholder
        flexCount++
      }
    }

    // Auto-size columns: calculate width from content, but cap at available space
    if (flexCount > 0) {
      const flexAvail = Math.max(20, availWidth - fixedTotal)
      const perFlex = Math.floor(flexAvail / flexCount)

      for (let i = 0; i < this._headers.length; i++) {
        if (widths[i] === 0) {
          // Estimate from content
          const contentWidth = this.estimateColWidth(i)
          widths[i] = Math.min(contentWidth, perFlex)
        }
      }
    }

    return widths
  }

  /** Estimate max content width for a column */
  private estimateColWidth(colIndex: number): number {
    let maxW = stringWidth(this._headers[colIndex] || '')
    for (const row of this._rows) {
      const cell = row[colIndex] || ''
      for (const line of cell.split('\n')) {
        const w = stringWidth(line)
        if (w > maxW) maxW = w
      }
    }
    return maxW
  }
}

/** Calculate display width of a string (reuses cli-table3's internal string-width) */
function stringWidth(str: string): number {
  // cli-table3 depends on string-width for CJK and ANSI handling
  // A simplified version here is fine; cli-table3 recalculates during rendering
  let w = 0
  for (const ch of str) {
    w += charWidth(ch)
  }
  return w
}

function charWidth(ch: string): number {
  const cp = ch.codePointAt(0)!
  if (cp >= 0x1100 && cp <= 0x115f) return 2
  if (cp >= 0x2e80 && cp <= 0x303e) return 2
  if (cp >= 0x3040 && cp <= 0x33ff) return 2
  if (cp >= 0x3400 && cp <= 0x4dbf) return 2
  if (cp >= 0x4e00 && cp <= 0x9fff) return 2
  if (cp >= 0xac00 && cp <= 0xd7a3) return 2
  if (cp >= 0xf900 && cp <= 0xfaff) return 2
  if (cp >= 0xfe30 && cp <= 0xfe6f) return 2
  if (cp >= 0xff01 && cp <= 0xff60) return 2
  if (cp >= 0xffe0 && cp <= 0xffe6) return 2
  if (cp >= 0x20000 && cp <= 0x2fffd) return 2
  if (cp >= 0x30000 && cp <= 0x3fffd) return 2
  if (cp >= 0x1f300) return 2
  return 1
}

/** Format date into two lines: "YYYY-MM-DD\nHH:mm" */
export function formatDate(d: Date): string {
  const y = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${y}-${mm}-${dd}\n${hh}:${mi}`
}

/** Format sender: name and email on separate lines */
export function formatFrom(from: { name: string; address: string }): string {
  if (from.name) return `${from.name}\n<${from.address}>`
  return from.address
}

/** Format email status */
export function formatStatus(read: boolean, starred: boolean, hasAttachments: boolean): string {
  const parts: string[] = []
  if (starred) parts.push('⭐')
  if (hasAttachments) parts.push('📎')
  parts.push(read ? 'Read' : 'Unread')
  return (read ? '' : '🔵 ') + parts.join(' ')
}

/** Render email list table */
export function renderMailTable(mails: Mail[], accountAlias: string): void {
  const unreadCount = mails.filter((m) => !m.read).length
  const t = new Table()
  t.header(['#', 'ID', 'Date', 'From', 'Subject', 'Status'], ['right', 'left', 'left', 'left', 'left', 'left'])
  t.colWidths([3, 44, 12, 22, null, 8])

  mails.forEach((m, i) => {
    const displayId = m.id
    const from = formatFrom(m.from)
    const date = formatDate(m.date)
    const status = formatStatus(m.read, m.starred, m.attachments.length > 0)
    t.row([String(i + 1), displayId, date, from, m.subject, status])
  })

  console.log(`📬 ${accountAlias} Inbox\n`)
  console.log(t.render())
  console.log(`\n${mails.length} email(s) total` + (unreadCount > 0 ? `, ${unreadCount} unread` : '') + '.')
  console.log(`💡 Read an email: ma read <ID> --account "${accountAlias}"`)
}

/** Render email detail */
export function renderMailDetail(mail: Mail, accountAlias: string): void {
  const status = mail.read ? '✅ Read' : '🔵 Unread'
  const star = mail.starred ? ' ⭐' : ''

  console.log(`\n📧 ${mail.subject}`)
  console.log('─'.repeat(50))
  console.log(`  From: ${mail.from.name ? mail.from.name + ' <' + mail.from.address + '>' : mail.from.address}`)
  console.log(`  To: ${mail.to.map((a) => (a.name ? a.name + ' <' + a.address + '>' : a.address)).join(', ')}`)
  if (mail.cc.length > 0) {
    console.log(`  CC: ${mail.cc.map((a) => (a.name ? a.name + ' <' + a.address + '>' : a.address)).join(', ')}`)
  }
  if (mail.threadId) {
    console.log(`  Thread: ${mail.threadId}`)
  }
  console.log(`  Date: ${mail.date.toLocaleString()}`)
  console.log(`  Status: ${status}${star}`)
  if (mail.attachments.length > 0) {
    console.log(`  Attachments: ${mail.attachments.length}`)
  }
  console.log('─'.repeat(50))
  console.log(mail.body.text || '(no body)')
  if (mail.attachments.length > 0) {
    console.log('─'.repeat(50))
    console.log('Attachments:')
    mail.attachments.forEach((a) => {
      const sizeStr =
        a.size > 1024 * 1024
          ? `${(a.size / 1024 / 1024).toFixed(1)}MB`
          : a.size > 1024
            ? `${(a.size / 1024).toFixed(1)}KB`
            : `${a.size}B`
      console.log(`  📎 ${a.filename} (${sizeStr})`)
    })
  }
  console.log('')
  console.log(`💡 Quick actions:`)
  if (mail.threadId) {
    console.log(`   View thread: ma thread ${mail.threadId} --account "${accountAlias}"`)
  }
  console.log(`   Reply: ma reply ${mail.id} -b "reply body" --account "${accountAlias}"`)
  console.log(`   Forward: ma forward ${mail.id} -t <recipient> --account "${accountAlias}"`)
  if (mail.attachments.length > 0) {
    console.log(`   Download attachments: ma download ${mail.id} --all --account "${accountAlias}"`)
  }
  console.log('')
}
