/**
 * AgentlyProvider 单元测试
 *
 * Mock runCli 函数，测试各方法对 CLI 输出的正确映射
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentlyProvider } from './provider.js'
import { setCliPath, resetCliPath } from './cli.js'
import type { AccountConfig, OutboundMail } from '@mail-agent/core'

// ── Mock cli.ts ──

vi.mock('./cli.js', () => ({
  runCli: vi.fn(),
  ensureAuth: vi.fn(),
  setCliPath: vi.fn(),
  resetCliPath: vi.fn(),
  getCliPath: vi.fn(() => 'agently-cli'),
  mapExitCodeToError: vi.fn((code, msg) => ({
    code: `E${code}`,
    providerCode: String(code),
    message: msg,
    retryable: false,
  })),
}))

import { runCli, ensureAuth } from './cli.js'

const mockRunCli = vi.mocked(runCli)
const mockEnsureAuth = vi.mocked(ensureAuth)

// ── 测试数据 ──

const testAccountConfig: AccountConfig = {
  id: 'acc_agently_001',
  alias: 'Agent邮箱',
  purpose: '自动化通知',
  isDefault: true,
  provider: 'agently',
  network: 'public',
  user: 'test@agent.qq.com',
}

const sampleAgentlyMessage = {
  message_id: 'msg_abc123',
  from: { email: 'sender@example.com', name: 'Sender' },
  to: [{ email: 'test@agent.qq.com', name: 'Test' }],
  subject: 'Test Subject',
  snippet: 'This is a snippet...',
  body: '<p>This is a snippet...</p>',
  body_format: 'HTML',
  created_at: '2026-06-25T10:00:00Z',
  is_read: true,
  has_attachments: false,
  dir: { dir_id: 1, dir_name: 'inbox' },
  attachments: [],
  rfc_message_id: '<msg123@example.com>',
}

const sampleAgentlyListResult = {
  data: [sampleAgentlyMessage],
  pagination: { has_more: false, next_cursor: '' },
}

const sampleSendResult = {
  confirmation_required: true,
  confirmation_token: 'ctk_test123',
  summary: 'Send to recipient@example.com: Hello',
  message_id: 'msg_new123',
}

// ── 测试 ──

describe('AgentlyProvider', () => {
  let provider: AgentlyProvider

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new AgentlyProvider()
  })

  describe('connect()', () => {
    it('should check auth status on connect', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)
      expect(mockEnsureAuth).toHaveBeenCalledOnce()
    })

    it('should throw if auth check fails', async () => {
      mockEnsureAuth.mockImplementation(() => {
        throw { code: 'E1002', message: 'Agently Mail 未登录', providerCode: 'auth_not_logged_in', retryable: false }
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
      expect(status.provider).toBe('agently')
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
    it('should handle two-phase confirmation automatically', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)

      // 第一次调用返回 confirmation_required
      mockRunCli
        .mockReturnValueOnce({ ok: true, data: sampleSendResult })
        // 第二次调用（携带 ctk）返回成功
        .mockReturnValueOnce({ ok: true, data: { confirmation_required: false, message_id: 'msg_new123' } })

      const mail: OutboundMail = {
        to: [{ name: '', address: 'recipient@example.com' }],
        subject: 'Hello',
        body: { text: 'Hi there' },
      }

      const result = await provider.send(mail)

      expect(result.success).toBe(true)
      expect(result.providerId).toBe('msg_new123')
      expect(mockRunCli).toHaveBeenCalledTimes(2)

      // 第二次调用应该包含 --confirmation-token
      const secondCallArgs = mockRunCli.mock.calls[1][0] as string[]
      expect(secondCallArgs).toContain('--confirmation-token')
      expect(secondCallArgs).toContain('ctk_test123')
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

    it('should map CC and BCC to CLI flags', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)

      mockRunCli
        .mockReturnValueOnce({ ok: true, data: sampleSendResult })
        .mockReturnValueOnce({ ok: true, data: { confirmation_required: false, message_id: 'msg_new123' } })

      const mail: OutboundMail = {
        to: [{ name: '', address: 'to@example.com' }],
        cc: [{ name: '', address: 'cc@example.com' }],
        bcc: [{ name: '', address: 'bcc@example.com' }],
        subject: 'Hello',
        body: { text: 'Hi' },
      }

      await provider.send(mail)

      const firstCallArgs = mockRunCli.mock.calls[0][0] as string[]
      expect(firstCallArgs).toContain('--to')
      expect(firstCallArgs).toContain('to@example.com')
      expect(firstCallArgs).toContain('--cc')
      expect(firstCallArgs).toContain('cc@example.com')
      expect(firstCallArgs).toContain('--bcc')
      expect(firstCallArgs).toContain('bcc@example.com')
    })

    it('should pass attachment files to CLI via --attachment flag', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)

      mockRunCli
        .mockReturnValueOnce({ ok: true, data: sampleSendResult })
        .mockReturnValueOnce({ ok: true, data: { confirmation_required: false, message_id: 'msg_new123' } })

      const mail: OutboundMail = {
        to: [{ name: '', address: 'to@example.com' }],
        subject: 'Report',
        body: { text: 'See attachment' },
        attachmentContents: [
          {
            filename: 'report.pdf',
            contentType: 'application/pdf',
            size: 12345,
            content: Buffer.from('fake-pdf-content'),
          },
        ],
      }

      const result = await provider.send(mail)

      expect(result.success).toBe(true)
      const firstCallArgs = mockRunCli.mock.calls[0][0] as string[]
      expect(firstCallArgs).toContain('--attachment')
      // The attachment path should contain the filename
      const attIndex = firstCallArgs.indexOf('--attachment')
      const attPath = firstCallArgs[attIndex + 1]
      expect(attPath).toContain('report.pdf')
    })
  })

  describe('fetch()', () => {
    it('should map FetchCriteria to CLI flags and return Mail[]', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)

      mockRunCli.mockReturnValueOnce({ ok: true, data: sampleAgentlyListResult })

      const mails = await provider.fetch({ folder: 'INBOX', limit: 10, unread: true })

      expect(mails).toHaveLength(1)
      expect(mails[0].providerId).toBe('msg_abc123')
      expect(mails[0].from.address).toBe('sender@example.com')
      expect(mails[0].subject).toBe('Test Subject')
      expect(mails[0].read).toBe(true)
      expect(mails[0].labels).toContain('inbox')

      const args = mockRunCli.mock.calls[0][0] as string[]
      expect(args).toContain('--limit')
      expect(args).toContain('10')
      expect(args).toContain('--dir')
      expect(args).toContain('inbox')
      expect(args).toContain('--is-unread')
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
    it('should read a message by ID', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)

      mockRunCli.mockReturnValueOnce({ ok: true, data: sampleAgentlyMessage })

      const mail = await provider.read('msg_abc123')

      expect(mail.providerId).toBe('msg_abc123')
      expect(mail.body.html).toBe('<p>This is a snippet...</p>')
      expect(mail.body.text).toBe('This is a snippet...')

      const args = mockRunCli.mock.calls[0][0] as string[]
      expect(args).toContain('--id')
      expect(args).toContain('msg_abc123')
    })
  })

  describe('search()', () => {
    it('should map SearchCriteria to CLI flags', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)

      mockRunCli.mockReturnValueOnce({ ok: true, data: sampleAgentlyListResult })

      const mails = await provider.search({ query: 'report', from: 'alice@example.com', limit: 5 })

      expect(mails).toHaveLength(1)

      const args = mockRunCli.mock.calls[0][0] as string[]
      expect(args).toContain('--q')
      expect(args).toContain('report')
      expect(args).toContain('--from')
      expect(args).toContain('alice@example.com')
      expect(args).toContain('--limit')
      expect(args).toContain('5')
    })
  })

  describe('getThread()', () => {
    it('should throw (not implemented)', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)

      await expect(provider.getThread('thread_123')).rejects.toThrow('does not yet support thread consolidation')
    })
  })

  describe('capabilities()', () => {
    it('should return correct capabilities for Agently', () => {
      const caps = provider.capabilities()
      expect(caps.realtimePush).toBe(false)
      expect(caps.imapIdle).toBe(false)
      expect(caps.threadNative).toBe(false)
      expect(caps.sendRateLimit).toBe(10)
      expect(caps.maxAttachmentSize).toBe(20 * 1024 * 1024)
    })
  })

  describe('toMail() mapping', () => {
    it('should correctly map Agently message to Mail model', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)

      const msgWithAttachments = {
        ...sampleAgentlyMessage,
        attachments: [
          {
            attachment_id: 'att_001',
            filename: 'report.pdf',
            content_type: 'application/pdf',
            size: 12345,
          },
        ],
        has_attachments: true,
      }

      mockRunCli.mockReturnValueOnce({ ok: true, data: msgWithAttachments })

      const mail = await provider.read('msg_abc123')

      expect(mail.attachments).toHaveLength(1)
      expect(mail.attachments[0].filename).toBe('report.pdf')
      expect(mail.attachments[0].size).toBe(12345)
      // threadId is undefined because Agently has no native thread API
      expect(mail.threadId).toBeUndefined()
    })

    it('should handle missing optional fields', async () => {
      mockEnsureAuth.mockReturnValue(undefined)
      await provider.connect(testAccountConfig)

      const minimalMsg = {
        message_id: 'msg_min',
        from: { email: 'a@b.com', name: '' },
        to: [{ email: 'c@d.com', name: '' }],
        subject: '',
        snippet: '',
        created_at: '2026-06-25T10:00:00Z',
        is_read: false,
        has_attachments: false,
      }

      mockRunCli.mockReturnValueOnce({ ok: true, data: minimalMsg })

      const mail = await provider.read('msg_min')

      expect(mail.subject).toBe('(No Subject)')
      expect(mail.body.text).toBe('')
      expect(mail.attachments).toHaveLength(0)
      expect(mail.labels).toHaveLength(0)
    })
  })
})
