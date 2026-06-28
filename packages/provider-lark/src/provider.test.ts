/**
 * LarkProvider 单元测试
 *
 * Mock runCli 函数，测试各方法对 CLI 输出的正确映射
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LarkProvider } from './provider.js'
import type { AccountConfig, OutboundMail } from '@mail-agent/core'

// ── Mock cli.ts ──

vi.mock('./cli.js', () => ({
  runCli: vi.fn(),
  ensureAuth: vi.fn(),
  setCliPath: vi.fn(),
  resetCliPath: vi.fn(),
  getCliPath: vi.fn(() => 'lark-cli'),
}))

vi.mock('./errors.js', () => ({
  mapLarkCliError: vi.fn((error, defaultCode) => ({
    code: defaultCode,
    providerCode: error.code,
    message: error.message,
    retryable: false,
  })),
}))

import { runCli, ensureAuth } from './cli.js'
import { mapLarkCliError } from './errors.js'

const mockRunCli = vi.mocked(runCli)
const mockEnsureAuth = vi.mocked(ensureAuth)
const mockMapLarkCliError = vi.mocked(mapLarkCliError)

// ── 测试数据 ──

const testAccountConfig: AccountConfig = {
  id: 'acc_lark_001',
  alias: 'Lark邮箱',
  purpose: '飞书企业邮箱',
  isDefault: true,
  provider: 'lark',
  network: 'public',
  user: 'test@company.com',
}

const sampleLarkMessage = {
  message_id: 'msg_lark_abc123',
  thread_id: 'thread_lark_456',
  smtp_message_id: '<msg123@company.com>',
  subject: 'Test Subject',
  head_from: { mail_address: 'sender@example.com', name: 'Sender' },
  to: [{ mail_address: 'test@company.com', name: 'Test User' }],
  cc: [] as Array<{ mail_address: string; name: string }>,
  bcc: [] as Array<{ mail_address: string; name: string }>,
  date: 'Fri, 21 Mar 2026 11:40:00 +0800',
  internal_date: '2026-03-21T11:40:00+08:00',
  folder_id: 'INBOX',
  label_ids: ['INBOX'],
  message_state: 1,
  message_state_text: 'received',
  body_plain_text: 'This is the plain text body',
  body_preview: 'This is the plain text body',
  body_html: '<p>This is the plain text body</p>',
  attachments: [] as Array<{
    id: string
    filename: string
    content_type: string
    attachment_type: number
    is_inline: boolean
    cid?: string
    size?: number
  }>,
  security_level: { is_risk: false },
}

const sampleLarkTriageResult = {
  messages: [
    {
      message_id: 'msg_lark_abc123',
      mailbox_id: 'me',
      date: 'Fri, 21 Mar 2026 11:40:00 +0800',
      from: 'Sender <sender@example.com>',
      subject: 'Test Subject',
      labels: 'INBOX',
    },
  ],
  mailbox_id: 'me',
  count: 1,
  has_more: false,
  page_token: '',
}

const sampleLarkSendResult = {
  message_id: 'msg_lark_new123',
  thread_id: 'thread_lark_new456',
}

const sampleLarkThreadResult = {
  thread_id: 'thread_lark_456',
  message_count: 2,
  messages: [
    sampleLarkMessage,
    {
      ...sampleLarkMessage,
      message_id: 'msg_lark_reply789',
      body_plain_text: 'Reply body',
      body_html: '<p>Reply body</p>',
      head_from: { mail_address: 'test@company.com', name: 'Test User' },
      to: [{ mail_address: 'sender@example.com', name: 'Sender' }],
      message_state: 2,
      message_state_text: 'sent',
      label_ids: ['SENT'],
    },
  ],
}

// ── 测试 ──

describe('LarkProvider', () => {
  let provider: LarkProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new LarkProvider()
  })

  describe('connect()', () => {
    it('should check auth status on connect', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)
      expect(mockEnsureAuth).toHaveBeenCalledOnce()
    })

    it('should throw if auth check fails', async () => {
      mockEnsureAuth.mockImplementation(() => {
        throw { code: 'E1002', message: 'Lark Mail 未登录', providerCode: 'auth_not_logged_in', retryable: false }
      })
      await expect(provider.connect(testAccountConfig)).rejects.toEqual(expect.objectContaining({ code: 'E1002' }))
    })
  })

  describe('disconnect()', () => {
    it('should clear config', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)
      await provider.disconnect()
      // No error = success
    })
  })

  describe('healthCheck()', () => {
    it('should return connected when auth is valid', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      const status = await provider.healthCheck()
      expect(status.connected).toBe(true)
      expect(status.provider).toBe('lark')
    })

    it('should return not connected when auth fails', async () => {
      mockEnsureAuth.mockImplementation(() => {
        throw new Error('Not logged in')
      })
      const status = await provider.healthCheck()
      expect(status.connected).toBe(false)
    })
  })

  describe('send()', () => {
    it('should send with --confirm-send and return SendResult', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)

      mockRunCli.mockReturnValueOnce({ ok: true, data: sampleLarkSendResult })

      const mail: OutboundMail = {
        to: [{ name: '', address: 'recipient@example.com' }],
        subject: 'Hello',
        body: { text: 'Hi there' },
      }

      const result = await provider.send(mail)

      expect(result.success).toBe(true)
      expect(result.providerId).toBe('msg_lark_new123')

      const args = mockRunCli.mock.calls[0][0] as string[]
      expect(args).toContain('mail')
      expect(args).toContain('+send')
      expect(args).toContain('--confirm-send')
      expect(args).toContain('--to')
      expect(args).toContain('recipient@example.com')
      expect(args).toContain('--subject')
      expect(args).toContain('Hello')
    })

    it('should use --plain-text when no HTML body', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)

      mockRunCli.mockReturnValueOnce({ ok: true, data: sampleLarkSendResult })

      const mail: OutboundMail = {
        to: [{ name: '', address: 'recipient@example.com' }],
        subject: 'Hello',
        body: { text: 'Hi there' },
      }

      await provider.send(mail)

      const args = mockRunCli.mock.calls[0][0] as string[]
      expect(args).toContain('--plain-text')
    })

    it('should not use --plain-text when HTML body is present', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)

      mockRunCli.mockReturnValueOnce({ ok: true, data: sampleLarkSendResult })

      const mail: OutboundMail = {
        to: [{ name: '', address: 'recipient@example.com' }],
        subject: 'Hello',
        body: { text: 'Hi there', html: '<p>Hi there</p>' },
      }

      await provider.send(mail)

      const args = mockRunCli.mock.calls[0][0] as string[]
      expect(args).not.toContain('--plain-text')
    })

    it('should map CC and BCC to CLI flags', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)

      mockRunCli.mockReturnValueOnce({ ok: true, data: sampleLarkSendResult })

      const mail: OutboundMail = {
        to: [{ name: '', address: 'to@example.com' }],
        cc: [{ name: '', address: 'cc@example.com' }],
        bcc: [{ name: '', address: 'bcc@example.com' }],
        subject: 'Hello',
        body: { text: 'Hi' },
      }

      await provider.send(mail)

      const args = mockRunCli.mock.calls[0][0] as string[]
      expect(args).toContain('--cc')
      expect(args).toContain('cc@example.com')
      expect(args).toContain('--bcc')
      expect(args).toContain('bcc@example.com')
    })

    it('should return error on CLI failure', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)

      mockRunCli.mockReturnValueOnce({
        ok: false,
        error: { code: '3', message: 'Authorization expired' },
      })

      const mail: OutboundMail = {
        to: [{ name: '', address: 'recipient@example.com' }],
        subject: 'Hello',
        body: { text: 'Hi there' },
      }

      const result = await provider.send(mail)
      expect(result.success).toBe(false)
      expect(result.errorCode).toBeDefined()
    })
  })

  describe('fetch()', () => {
    it('should map FetchCriteria to +triage flags and return Mail[]', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)

      mockRunCli.mockReturnValueOnce({ ok: true, data: sampleLarkTriageResult })

      const mails = await provider.fetch({ folder: 'INBOX', limit: 10, unread: true })

      expect(mails).toHaveLength(1)
      expect(mails[0].providerId).toBe('msg_lark_abc123')
      expect(mails[0].from.address).toBe('sender@example.com')
      expect(mails[0].subject).toBe('Test Subject')
      expect(mails[0].read).toBe(true)

      const args = mockRunCli.mock.calls[0][0] as string[]
      expect(args).toContain('mail')
      expect(args).toContain('+triage')
      expect(args).toContain('--format')
      expect(args).toContain('json')
      expect(args).toContain('--max')
      expect(args).toContain('10')
      // Should have --filter with folder and unread
      const filterIndex = args.indexOf('--filter')
      expect(filterIndex).toBeGreaterThan(-1)
      const filterJson = args[filterIndex + 1]
      const filter = JSON.parse(filterJson)
      expect(filter.folder).toBe('INBOX')
      expect(filter.is_unread).toBe(true)
    })

    it('should pass cursor as --page-token', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)

      mockRunCli.mockReturnValueOnce({ ok: true, data: sampleLarkTriageResult })

      await provider.fetch({ cursor: 'list:abc123' })

      const args = mockRunCli.mock.calls[0][0] as string[]
      expect(args).toContain('--page-token')
      expect(args).toContain('list:abc123')
    })

    it('should throw on CLI error', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)

      mockRunCli.mockReturnValueOnce({
        ok: false,
        error: { code: '1', message: 'Network error' },
      })

      await expect(provider.fetch({})).rejects.toThrow()
    })
  })

  describe('read()', () => {
    it('should read a message by ID using +message', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)

      mockRunCli.mockReturnValueOnce({ ok: true, data: sampleLarkMessage })

      const mail = await provider.read('msg_lark_abc123')

      expect(mail.providerId).toBe('msg_lark_abc123')
      expect(mail.threadId).toBe('thread_lark_456')
      expect(mail.body.html).toBe('<p>This is the plain text body</p>')
      expect(mail.body.text).toBe('This is the plain text body')
      expect(mail.from.address).toBe('sender@example.com')
      expect(mail.from.name).toBe('Sender')
      expect(mail.read).toBe(true)

      const args = mockRunCli.mock.calls[0][0] as string[]
      expect(args).toContain('mail')
      expect(args).toContain('+message')
      expect(args).toContain('--message-id')
      expect(args).toContain('msg_lark_abc123')
    })
  })

  describe('search()', () => {
    it('should map SearchCriteria to +triage --query', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)

      mockRunCli.mockReturnValueOnce({ ok: true, data: sampleLarkTriageResult })

      const mails = await provider.search({ query: 'report', from: 'alice@example.com', limit: 5 })

      expect(mails).toHaveLength(1)

      const args = mockRunCli.mock.calls[0][0] as string[]
      expect(args).toContain('mail')
      expect(args).toContain('+triage')
      expect(args).toContain('--query')
      expect(args).toContain('report')
      expect(args).toContain('--max')
      expect(args).toContain('5')
      // --filter should include from
      const filterIndex = args.indexOf('--filter')
      expect(filterIndex).toBeGreaterThan(-1)
      const filter = JSON.parse(args[filterIndex + 1])
      expect(filter.from).toContain('alice@example.com')
    })
  })

  describe('getThread()', () => {
    it('should read a thread using +thread', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)

      mockRunCli.mockReturnValueOnce({ ok: true, data: sampleLarkThreadResult })

      const thread = await provider.getThread('thread_lark_456')

      expect(thread.threadId).toBe('thread_lark_456')
      expect(thread.mails).toHaveLength(2)
      expect(thread.subject).toBe('Test Subject')
      expect(thread.mails[0].providerId).toBe('msg_lark_abc123')
      expect(thread.mails[1].providerId).toBe('msg_lark_reply789')
      expect(thread.participants.length).toBeGreaterThanOrEqual(2)

      const args = mockRunCli.mock.calls[0][0] as string[]
      expect(args).toContain('mail')
      expect(args).toContain('+thread')
      expect(args).toContain('--thread-id')
      expect(args).toContain('thread_lark_456')
    })
  })

  describe('trash()', () => {
    it('should use raw API to trash a message', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)

      mockRunCli.mockReturnValueOnce({ ok: true, data: { message_id: 'msg_lark_abc123' } })

      await provider.trash('msg_lark_abc123')

      const args = mockRunCli.mock.calls[0][0] as string[]
      expect(args).toContain('user_mailbox.messages')
      expect(args).toContain('trash')
      expect(args).toContain('--yes')

      const paramsIndex = args.indexOf('--params')
      expect(paramsIndex).toBeGreaterThan(-1)
      const params = JSON.parse(args[paramsIndex + 1])
      expect(params.user_mailbox_id).toBe('me')
      expect(params.message_id).toBe('msg_lark_abc123')
    })
  })

  describe('reply()', () => {
    it('should use +reply with --confirm-send', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)

      mockRunCli.mockReturnValueOnce({ ok: true, data: sampleLarkSendResult })

      const result = await provider.reply('msg_lark_abc123', 'Thanks!', { quoteOriginal: true })

      expect(result.success).toBe(true)
      expect(result.providerId).toBe('msg_lark_new123')

      const args = mockRunCli.mock.calls[0][0] as string[]
      expect(args).toContain('mail')
      expect(args).toContain('+reply')
      expect(args).toContain('--message-id')
      expect(args).toContain('msg_lark_abc123')
      expect(args).toContain('--body')
      expect(args).toContain('--confirm-send')
    })

    it('should use +reply-all when replyAll is set', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)

      mockRunCli.mockReturnValueOnce({ ok: true, data: sampleLarkSendResult })

      await provider.reply('msg_lark_abc123', 'Thanks all!', { replyAll: true })

      const args = mockRunCli.mock.calls[0][0] as string[]
      expect(args).toContain('+reply-all')
    })

    it('should map CC to --cc flag', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)

      mockRunCli.mockReturnValueOnce({ ok: true, data: sampleLarkSendResult })

      await provider.reply('msg_lark_abc123', 'Thanks!', {
        cc: [{ name: '', address: 'extra@example.com' }],
      })

      const args = mockRunCli.mock.calls[0][0] as string[]
      expect(args).toContain('--cc')
      expect(args).toContain('extra@example.com')
    })
  })

  describe('forward()', () => {
    it('should use +forward with --confirm-send', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)

      mockRunCli.mockReturnValueOnce({ ok: true, data: sampleLarkSendResult })

      const result = await provider.forward('msg_lark_abc123', [{ name: '', address: 'forward@example.com' }], {
        body: 'FYI',
      })

      expect(result.success).toBe(true)

      const args = mockRunCli.mock.calls[0][0] as string[]
      expect(args).toContain('mail')
      expect(args).toContain('+forward')
      expect(args).toContain('--message-id')
      expect(args).toContain('msg_lark_abc123')
      expect(args).toContain('--to')
      expect(args).toContain('forward@example.com')
      expect(args).toContain('--body')
      expect(args).toContain('--confirm-send')
    })
  })

  describe('capabilities()', () => {
    it('should return correct capabilities for Lark', () => {
      const caps = provider.capabilities()
      expect(caps.realtimePush).toBe(false)
      expect(caps.imapIdle).toBe(false)
      expect(caps.threadNative).toBe(true) // Lark has native thread support
      expect(caps.sendRateLimit).toBe(50)
      expect(caps.maxAttachmentSize).toBe(30 * 1024 * 1024)
    })
  })

  describe('toMail() mapping', () => {
    it('should correctly map Lark message with attachments to Mail model', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)

      const msgWithAttachments = {
        ...sampleLarkMessage,
        attachments: [
          {
            id: 'att_001',
            filename: 'report.pdf',
            content_type: 'application/pdf',
            attachment_type: 1,
            is_inline: false,
            size: 12345,
          },
        ],
      }

      mockRunCli.mockReturnValueOnce({ ok: true, data: msgWithAttachments })

      const mail = await provider.read('msg_lark_abc123')

      expect(mail.attachments).toHaveLength(1)
      expect(mail.attachments[0].filename).toBe('report.pdf')
      expect(mail.attachments[0].size).toBe(12345)
      expect(mail.threadId).toBe('thread_lark_456') // Lark has native thread support
    })

    it('should filter out inline attachments', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)

      const msgWithInline = {
        ...sampleLarkMessage,
        attachments: [
          {
            id: 'att_001',
            filename: 'image001.png',
            content_type: 'image/png',
            attachment_type: 1,
            is_inline: true,
            cid: 'cid:image001',
            size: 5000,
          },
          {
            id: 'att_002',
            filename: 'report.pdf',
            content_type: 'application/pdf',
            attachment_type: 1,
            is_inline: false,
            size: 12345,
          },
        ],
      }

      mockRunCli.mockReturnValueOnce({ ok: true, data: msgWithInline })

      const mail = await provider.read('msg_lark_abc123')

      // Inline images should be filtered out
      expect(mail.attachments).toHaveLength(1)
      expect(mail.attachments[0].filename).toBe('report.pdf')
    })

    it('should detect unread from label_ids', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)

      const unreadMsg = {
        ...sampleLarkMessage,
        label_ids: ['INBOX', 'UNREAD'],
      }

      mockRunCli.mockReturnValueOnce({ ok: true, data: unreadMsg })

      const mail = await provider.read('msg_lark_abc123')
      expect(mail.read).toBe(false)
    })

    it('should detect starred from label_ids', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)

      const starredMsg = {
        ...sampleLarkMessage,
        label_ids: ['INBOX', 'STARRED'],
      }

      mockRunCli.mockReturnValueOnce({ ok: true, data: starredMsg })

      const mail = await provider.read('msg_lark_abc123')
      expect(mail.starred).toBe(true)
    })

    it('should handle missing optional fields', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)

      const minimalMsg = {
        message_id: 'msg_min',
        head_from: { mail_address: 'a@b.com', name: '' },
        to: [{ mail_address: 'c@d.com', name: '' }],
        cc: [],
        bcc: [],
        subject: '',
        date: '2026-06-25T10:00:00Z',
        attachments: [],
      }

      mockRunCli.mockReturnValueOnce({ ok: true, data: minimalMsg })

      const mail = await provider.read('msg_min')

      expect(mail.subject).toBe('(No Subject)')
      expect(mail.body.text).toBe('')
      expect(mail.attachments).toHaveLength(0)
      expect(mail.threadId).toBeUndefined()
    })
  })

  describe('triageToMail() mapping', () => {
    it('should parse formatted from address', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)

      const triageWithFormatted = {
        ...sampleLarkTriageResult,
        messages: [
          {
            message_id: 'msg_lark_abc123',
            mailbox_id: 'me',
            date: 'Fri, 21 Mar 2026 11:40:00 +0800',
            from: '"Alice Zhang" <alice@company.com>',
            subject: 'Meeting',
            labels: 'INBOX,UNREAD',
          },
        ],
      }

      mockRunCli.mockReturnValueOnce({ ok: true, data: triageWithFormatted })

      const mails = await provider.fetch({})

      expect(mails[0].from.name).toBe('Alice Zhang')
      expect(mails[0].from.address).toBe('alice@company.com')
      expect(mails[0].read).toBe(false)
    })
  })
})
