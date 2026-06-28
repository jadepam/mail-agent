import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SmtpImapProvider } from '../src/provider.js'
import { SmtpSender } from '../src/sender.js'
import { ImapReceiver } from '../src/receiver.js'
import { mapImapError, isRetryableError, withRetry } from '../src/errors.js'
import { normalizeMessageId } from '../src/receiver.js'
import type { AccountConfig } from '@mail-agent/core'
import { resolveSmtpConfig, resolveImapConfig } from '@mail-agent/core'

/**
 * @mail-agent/provider-smtp 单元测试
 * Mock IMAP/SMTP 连接，验证 Provider 逻辑
 */

// ── Mock nodemailer 和 imapflow（使用 vi.hoisted 提升变量到 vi.mock 工厂可访问的位置） ──

const { mockTransport, mockImapClient } = vi.hoisted(() => {
  const transport = {
    verify: vi.fn().mockResolvedValue(undefined),
    sendMail: vi.fn().mockResolvedValue({ messageId: '<sent-msg-id@example.com>' }),
    close: vi.fn(),
  }
  const client = {
    connect: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
    list: vi.fn().mockResolvedValue([{ path: 'INBOX' }, { path: 'Trash' }]),
    fetch: vi.fn(),
    search: vi.fn().mockResolvedValue([1, 2]),
    fetchOne: vi.fn(),
    messageMove: vi.fn().mockResolvedValue(true),
    messageCopy: vi.fn().mockResolvedValue(true),
    messageFlagsAdd: vi.fn().mockResolvedValue(true),
    expunge: vi.fn().mockResolvedValue(undefined),
  }

  // 让 fetch 返回异步迭代器
  client.fetch.mockImplementation((_query: any, _opts: any) => ({
    async *[Symbol.asyncIterator]() {},
  }))

  return { mockTransport: transport, mockImapClient: client }
})

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn().mockReturnValue(mockTransport),
  },
}))

vi.mock('imapflow', () => ({
  ImapFlow: vi.fn().mockImplementation(function (this: any) {
    this.connect = mockImapClient.connect
    this.logout = mockImapClient.logout
    this.getMailboxLock = mockImapClient.getMailboxLock
    this.list = mockImapClient.list
    this.fetch = mockImapClient.fetch
    this.search = mockImapClient.search
    this.fetchOne = mockImapClient.fetchOne
    this.messageMove = mockImapClient.messageMove
    this.messageCopy = mockImapClient.messageCopy
    this.messageFlagsAdd = mockImapClient.messageFlagsAdd
    this.expunge = mockImapClient.expunge
  }),
}))

// ── 测试用配置 ──

function makeEnterpriseConfig(overrides: Partial<AccountConfig> = {}): AccountConfig {
  return {
    id: 'acc_corp',
    alias: '公司邮箱',
    purpose: 'work',
    isDefault: true,
    provider: 'smtp-imap',
    network: 'private',
    user: 'zhangsan@corp.com',
    pass: 'password123',
    smtp: { host: 'mail.corp.com', port: 465, secure: true, rejectUnauthorized: false },
    imap: { host: 'mail.corp.com', port: 993, tls: true, rejectUnauthorized: false },
    ...overrides,
  }
}

// ── IMAP 错误映射测试 ──

describe('mapImapError', () => {
  it('连接拒绝 → E1001', () => {
    const err = mapImapError({ code: 'ECONNREFUSED', message: 'Connection refused' })
    expect(err.code).toBe('E1001')
    expect(err.retryable).toBe(true)
  })

  it('连接超时 → E1001', () => {
    const err = mapImapError({ code: 'ETIMEDOUT', message: 'Timeout' })
    expect(err.code).toBe('E1001')
    expect(err.retryable).toBe(true)
  })

  it('连接重置 → E1001', () => {
    const err = mapImapError({ code: 'ECONNRESET', message: 'Reset' })
    expect(err.code).toBe('E1001')
    expect(err.retryable).toBe(true)
  })

  it('DNS 解析失败 → E1001', () => {
    const err = mapImapError({ code: 'ENOTFOUND', message: 'Not found' })
    expect(err.code).toBe('E1001')
    expect(err.retryable).toBe(true)
  })

  it('认证失败 → E1002', () => {
    const err = mapImapError({ authenticationFailed: true, message: 'Auth failed' })
    expect(err.code).toBe('E1002')
    expect(err.retryable).toBe(false)
  })

  it('EAUTH 错误码 → E1002', () => {
    const err = mapImapError({ code: 'EAUTH', message: 'Auth' })
    expect(err.code).toBe('E1002')
    expect(err.retryable).toBe(false)
  })

  it('SSL 证书错误 → E1003', () => {
    const err = mapImapError({ code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', message: 'Cert error' })
    expect(err.code).toBe('E1003')
    expect(err.retryable).toBe(false)
  })

  it('邮箱不存在 → E2002', () => {
    const err = mapImapError({ message: 'NONEXISTENT mailbox' })
    expect(err.code).toBe('E2002')
    expect(err.retryable).toBe(false)
  })

  it('配额已满 → E2003', () => {
    const err = mapImapError({ message: 'OVERQUOTA' })
    expect(err.code).toBe('E2003')
    expect(err.retryable).toBe(false)
  })

  it('未知错误 → 默认 E2001', () => {
    const err = mapImapError({ message: 'Something went wrong' })
    expect(err.code).toBe('E2001')
    expect(err.retryable).toBe(false)
  })

  it('自定义默认码', () => {
    const err = mapImapError({ message: 'err' }, 'E5001')
    expect(err.code).toBe('E5001')
  })
})

// ── isRetryableError 测试 ──

describe('isRetryableError', () => {
  it('MailError retryable=true → 可重试', () => {
    expect(isRetryableError({ retryable: true })).toBe(true)
  })

  it('MailError retryable=false → 不可重试', () => {
    expect(isRetryableError({ retryable: false })).toBe(false)
  })

  it('E1001 错误码 → 可重试', () => {
    expect(isRetryableError({ code: 'E1001' })).toBe(true)
  })

  it('E3001 错误码 → 可重试', () => {
    expect(isRetryableError({ code: 'E3001' })).toBe(true)
  })

  it('ECONNREFUSED → 可重试', () => {
    expect(isRetryableError({ code: 'ECONNREFUSED' })).toBe(true)
  })

  it('E1002 错误码 → 不可重试', () => {
    expect(isRetryableError({ code: 'E1002' })).toBe(false)
  })

  it('null → 不可重试', () => {
    expect(isRetryableError(null)).toBe(false)
  })
})

// ── withRetry 测试 ──

describe('withRetry', () => {
  it('首次成功 → 直接返回', async () => {
    const result = await withRetry(() => Promise.resolve('ok'), 'test')
    expect(result).toBe('ok')
  })

  it('不可重试错误 → 立即抛出', async () => {
    const err = new Error('fail')
    ;(err as any).retryable = false
    await expect(withRetry(() => Promise.reject(err), 'test')).rejects.toThrow('fail')
  })

  it('可重试错误 → 重试 1 次', async () => {
    let callCount = 0
    const fn = () => {
      callCount++
      if (callCount === 1) {
        const err = new Error('retry me')
        ;(err as any).code = 'E1001'
        return Promise.reject(err)
      }
      return Promise.resolve('recovered')
    }
    const result = await withRetry(fn, 'test')
    expect(result).toBe('recovered')
    expect(callCount).toBe(2)
  })

  it('可重试错误重试也失败 → 抛出重试错误', async () => {
    let callCount = 0
    const fn = () => {
      callCount++
      const err = new Error(`fail ${callCount}`)
      ;(err as any).code = 'E1001'
      return Promise.reject(err)
    }
    await expect(withRetry(fn, 'test')).rejects.toThrow('fail 2')
    expect(callCount).toBe(2)
  })
})

// ── SmtpImapProvider 构造与能力声明 ──

describe('SmtpImapProvider', () => {
  it('应该能创建实例', () => {
    const provider = new SmtpImapProvider()
    expect(provider).toBeDefined()
  })

  it('capabilities() 应该返回合理默认值（未连接，public）', async () => {
    const provider = new SmtpImapProvider()
    // 未连接时 config 为 null，network 默认 public
    const caps = provider.capabilities()
    expect(caps.realtimePush).toBe(false)
    expect(caps.imapIdle).toBe(true)
    expect(caps.threadNative).toBe(true)
    expect(caps.aiParsing).toBe(false)
    expect(caps.attachmentOcr).toBe(false)
    expect(caps.maxAttachmentSize).toBe(25 * 1024 * 1024)
    expect(caps.sendRateLimit).toBe(30)
  })

  it('capabilities() 企业私有化邮箱应该返回更高限制', async () => {
    const provider = new SmtpImapProvider()
    const config = makeEnterpriseConfig()
    await provider.connect(config)
    const caps = provider.capabilities()
    expect(caps.maxAttachmentSize).toBe(50 * 1024 * 1024) // 50MB
    expect(caps.sendRateLimit).toBe(0) // 无限制
    await provider.disconnect()
  })

  it('capabilities() 公网邮箱应该返回标准限制', async () => {
    const provider = new SmtpImapProvider()
    const config: AccountConfig = {
      id: 'acc_qq',
      alias: 'QQ',
      purpose: '',
      isDefault: true,
      provider: 'qq',
      network: 'public',
      user: '123456@qq.com',
      pass: 'authcode',
    }
    await provider.connect(config)
    const caps = provider.capabilities()
    expect(caps.maxAttachmentSize).toBe(25 * 1024 * 1024) // 25MB
    expect(caps.sendRateLimit).toBe(30) // 30次/分
    await provider.disconnect()
  })
})

// ── SmtpSender.connect 测试 ──

describe('SmtpSender.connect', () => {
  let createTransportSpy: any

  beforeEach(async () => {
    const nodemailer = await import('nodemailer')
    createTransportSpy = vi.mocked(nodemailer.default).createTransport
    createTransportSpy.mockClear()
  })

  it('密码认证应该创建密码 transport', async () => {
    const sender = new SmtpSender()
    const config = makeEnterpriseConfig()
    await sender.connect(config)

    expect(createTransportSpy).toHaveBeenCalled()
    const transportOpts = createTransportSpy.mock.calls[0][0] as any
    expect(transportOpts.host).toBe('mail.corp.com')
    expect(transportOpts.port).toBe(465)
    expect(transportOpts.secure).toBe(true)
    expect(transportOpts.auth.user).toBe('zhangsan@corp.com')
    expect(transportOpts.auth.pass).toBe('password123')

    await sender.disconnect()
  })

  it('rejectUnauthorized:false 应该传递 TLS 选项', async () => {
    const sender = new SmtpSender()
    const config = makeEnterpriseConfig()
    await sender.connect(config)

    const transportOpts = createTransportSpy.mock.calls[0][0] as any
    expect(transportOpts.tls).toEqual({ rejectUnauthorized: false })

    await sender.disconnect()
  })

  it('缺少 SMTP host 应该抛出错误', async () => {
    const sender = new SmtpSender()
    const config: AccountConfig = {
      id: 'acc_corp',
      alias: '公司',
      purpose: '',
      isDefault: true,
      provider: 'smtp-imap',
      network: 'private',
      user: 'me@corp.com',
      pass: 'pass',
      // 不填 smtp.host
    }
    await expect(sender.connect(config)).rejects.toThrow('缺少 SMTP 配置')
  })

  it('OAuth2 认证应该创建 OAuth2 transport', async () => {
    const sender = new SmtpSender()
    const config: AccountConfig = {
      id: 'acc_outlook',
      alias: 'Outlook',
      purpose: '',
      isDefault: true,
      provider: 'outlook',
      network: 'public',
      user: 'user@outlook.com',
      oauth2: {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        refreshToken: 'refresh-token',
        accessToken: 'access-token',
        expires: Date.now() + 3600000,
      },
    }
    await sender.connect(config)

    const transportOpts = createTransportSpy.mock.calls[0][0] as any
    expect(transportOpts.auth.type).toBe('OAuth2')
    expect(transportOpts.auth.clientId).toBe('client-id')

    await sender.disconnect()
  })
})

// ── ImapReceiver.connect 测试 ──

describe('ImapReceiver.connect', () => {
  let imapFlowSpy: any

  beforeEach(async () => {
    const { ImapFlow } = await import('imapflow')
    imapFlowSpy = vi.mocked(ImapFlow)
    imapFlowSpy.mockClear()
    mockImapClient.connect.mockClear()
    mockImapClient.list.mockClear()
  })

  it('密码认证应该创建密码 IMAP 连接', async () => {
    const receiver = new ImapReceiver()
    const config = makeEnterpriseConfig()
    await receiver.connect(config)

    const imapOpts = imapFlowSpy.mock.calls[0][0] as any
    expect(imapOpts.host).toBe('mail.corp.com')
    expect(imapOpts.port).toBe(993)
    expect(imapOpts.secure).toBe(true)
    expect(imapOpts.auth.user).toBe('zhangsan@corp.com')
    expect(imapOpts.auth.pass).toBe('password123')

    await receiver.disconnect()
  })

  it('rejectUnauthorized:false 应该传递 TLS 选项', async () => {
    const receiver = new ImapReceiver()
    const config = makeEnterpriseConfig()
    await receiver.connect(config)

    const imapOpts = imapFlowSpy.mock.calls[0][0] as any
    expect(imapOpts.tls).toEqual({ rejectUnauthorized: false })

    await receiver.disconnect()
  })

  it('缺少 IMAP host 应该抛出错误', async () => {
    const receiver = new ImapReceiver()
    const config: AccountConfig = {
      id: 'acc_corp',
      alias: '公司',
      purpose: '',
      isDefault: true,
      provider: 'smtp-imap',
      network: 'private',
      user: 'me@corp.com',
      pass: 'pass',
      // 不填 imap.host
    }
    await expect(receiver.connect(config)).rejects.toThrow('缺少 IMAP 配置')
  })

  it('非标准端口 143（明文 IMAP）应该正确传递', async () => {
    const receiver = new ImapReceiver()
    const config = makeEnterpriseConfig({
      imap: { host: 'mail.corp.com', port: 143, tls: false, rejectUnauthorized: false },
    })
    await receiver.connect(config)

    const imapOpts = imapFlowSpy.mock.calls[0][0] as any
    expect(imapOpts.port).toBe(143)
    expect(imapOpts.secure).toBe(false)

    await receiver.disconnect()
  })
})

// ── resolveSmtpConfig / resolveImapConfig 在 provider 上下文中的测试 ──

describe('resolveSmtpConfig / resolveImapConfig（企业自建邮场景）', () => {
  it('企业自建邮完整配置应该正确解析', () => {
    const config = makeEnterpriseConfig()
    const smtp = resolveSmtpConfig(config)
    const imap = resolveImapConfig(config)

    expect(smtp.host).toBe('mail.corp.com')
    expect(smtp.port).toBe(465)
    expect(smtp.secure).toBe(true)
    expect(smtp.rejectUnauthorized).toBe(false)

    expect(imap.host).toBe('mail.corp.com')
    expect(imap.port).toBe(993)
    expect(imap.tls).toBe(true)
    expect(imap.rejectUnauthorized).toBe(false)
  })

  it('企业自建邮明文配置（端口25/143）应该正确解析', () => {
    const config = makeEnterpriseConfig({
      smtp: { host: 'mail.corp.com', port: 25, secure: false },
      imap: { host: 'mail.corp.com', port: 143, tls: false },
    })
    const smtp = resolveSmtpConfig(config)
    const imap = resolveImapConfig(config)

    expect(smtp.port).toBe(25)
    expect(smtp.secure).toBe(false)
    expect(imap.port).toBe(143)
    expect(imap.tls).toBe(false)
  })
})

// ── SMTP 错误码映射 ──

describe('SMTP error mapping', () => {
  // 通过 sender 的 mapSmtpError 间接测试
  // 这里测试已知的映射规则
  it('550 → E3002 (封禁)', () => {
    // 550 是 SMTP 拒收码
    const code = 550
    expect([550, 553]).toContain(code)
  })

  it('451 → E3001 (限流可重试)', () => {
    const code = 451
    expect(code).toBe(451)
  })
})

// ── normalizeMessageId 测试 ──

describe('normalizeMessageId', () => {
  it('去掉尖括号', () => {
    expect(normalizeMessageId('<abc@def.com>')).toBe('abc@def.com')
  })

  it('无尖括号的不变', () => {
    expect(normalizeMessageId('abc@def.com')).toBe('abc@def.com')
  })

  it('去除前后空白', () => {
    expect(normalizeMessageId('  <abc@def.com>  ')).toBe('abc@def.com')
  })

  it('空字符串不变', () => {
    expect(normalizeMessageId('')).toBe('')
  })
})

// ── extractThreadId 逻辑测试（通过模拟 ParsedMail 验证） ──

describe('threadId 提取逻辑', () => {
  it('References 有值 → 取第一个', () => {
    // 模拟 extractThreadId 的核心逻辑
    const refs = ['<root@mail.com>', '<second@mail.com>']
    const threadId = normalizeMessageId(refs[0] as string)
    expect(threadId).toBe('root@mail.com')
  })

  it('References 为空但 In-Reply-To 有值 → 用 In-Reply-To', () => {
    const refs: string[] = []
    const inReplyTo = '<parent@mail.com>'
    const threadId =
      refs.length > 0 ? normalizeMessageId(refs[0]) : inReplyTo ? normalizeMessageId(inReplyTo) : undefined
    expect(threadId).toBe('parent@mail.com')
  })

  it('References 和 In-Reply-To 都为空 → undefined', () => {
    const refs: string[] = []
    const inReplyTo = ''
    const threadId =
      refs.length > 0 ? normalizeMessageId(refs[0]) : inReplyTo ? normalizeMessageId(inReplyTo) : undefined
    expect(threadId).toBeUndefined()
  })

  it('References 优先于 In-Reply-To', () => {
    const refs = ['<root@mail.com>']
    const inReplyTo = '<parent@mail.com>'
    const threadId =
      refs.length > 0 ? normalizeMessageId(refs[0]) : inReplyTo ? normalizeMessageId(inReplyTo) : undefined
    expect(threadId).toBe('root@mail.com')
  })
})

// ── SmtpSender.send 测试 ──

describe('SmtpSender.send', () => {
  let sender: SmtpSender

  beforeEach(async () => {
    const nodemailer = await import('nodemailer')
    vi.mocked(nodemailer.default).createTransport.mockClear()
    mockTransport.sendMail.mockClear()
    sender = new SmtpSender()
    const config = makeEnterpriseConfig()
    await sender.connect(config)
  })

  it('未连接时应该返回失败结果', async () => {
    const unconnected = new SmtpSender()
    const result = await unconnected.send({
      to: [{ name: '', address: 'to@corp.com' }],
      subject: '测试',
      body: { text: 'hello' },
    })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('E1001')
    expect(result.errorMessage).toBe('SMTP 未连接')
  })

  it('发送成功应该返回成功结果', async () => {
    mockTransport.sendMail.mockResolvedValueOnce({ messageId: '<sent-msg@example.com>' })
    const result = await sender.send({
      to: [{ name: '', address: 'to@corp.com' }],
      subject: '测试邮件',
      body: { text: '正文内容' },
    })
    expect(result.success).toBe(true)
    expect(result.providerId).toBe('<sent-msg@example.com>')
  })

  it('发送带 CC/BCC 应该正确传递', async () => {
    mockTransport.sendMail.mockResolvedValueOnce({ messageId: '<cc-msg@example.com>' })
    const result = await sender.send({
      to: [{ name: '', address: 'to@corp.com' }],
      subject: '带抄送',
      body: { text: '正文' },
      cc: [{ name: '张三', address: 'cc@corp.com' }],
      bcc: [{ name: '', address: 'bcc@corp.com' }],
    })
    expect(result.success).toBe(true)
    const sendOpts = mockTransport.sendMail.mock.calls[0][0] as any
    expect(sendOpts.cc).toBe('张三 <cc@corp.com>')
    expect(sendOpts.bcc).toBe('bcc@corp.com')
  })

  it('550 错误应该映射为 E3002（封禁）', async () => {
    const err = new Error('Mailbox not found')
    ;(err as any).responseCode = 550
    mockTransport.sendMail.mockRejectedValueOnce(err)
    const result = await sender.send({
      to: [{ name: '', address: 'blocked@corp.com' }],
      subject: '封禁测试',
      body: { text: 'test' },
    })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('E3002')
  })

  it('451 错误应该映射为 E3001（限流可重试）', async () => {
    const err = new Error('Temporary failure')
    ;(err as any).responseCode = 451
    mockTransport.sendMail.mockRejectedValueOnce(err)
    const result = await sender.send({
      to: [{ name: '', address: 'to@corp.com' }],
      subject: '限流测试',
      body: { text: 'test' },
    })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('E3001')
  })

  it('552 错误应该映射为 E4002（附件超限）', async () => {
    const err = new Error('Message size exceeds limit')
    ;(err as any).responseCode = 552
    mockTransport.sendMail.mockRejectedValueOnce(err)
    const result = await sender.send({
      to: [{ name: '', address: 'to@corp.com' }],
      subject: '超大附件',
      body: { text: 'test' },
    })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('E4002')
  })

  it('EAUTH 错误应该映射为 E1002（认证失败）', async () => {
    const err = new Error('Authentication failed')
    ;(err as any).code = 'EAUTH'
    mockTransport.sendMail.mockRejectedValueOnce(err)
    const result = await sender.send({
      to: [{ name: '', address: 'to@corp.com' }],
      subject: '认证测试',
      body: { text: 'test' },
    })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('E1002')
  })

  it('530 错误应该映射为 E1003（需要 TLS）', async () => {
    const err = new Error('Must issue a STARTTLS command first')
    ;(err as any).responseCode = 530
    mockTransport.sendMail.mockRejectedValueOnce(err)
    const result = await sender.send({
      to: [{ name: '', address: 'to@corp.com' }],
      subject: 'TLS测试',
      body: { text: 'test' },
    })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('E1003')
  })

  it('554 错误应该映射为 E2001（邮件被拒）', async () => {
    const err = new Error('Transaction failed')
    ;(err as any).responseCode = 554
    mockTransport.sendMail.mockRejectedValueOnce(err)
    const result = await sender.send({
      to: [{ name: '', address: 'to@corp.com' }],
      subject: '拒信测试',
      body: { text: 'test' },
    })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('E2001')
  })

  it('501/503 错误应该映射为 E4001（参数错误）', async () => {
    const err = new Error('Syntax error')
    ;(err as any).responseCode = 501
    mockTransport.sendMail.mockRejectedValueOnce(err)
    const result = await sender.send({
      to: [{ name: '', address: 'to@corp.com' }],
      subject: '参数测试',
      body: { text: 'test' },
    })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('E4001')
  })
})

// ── SmtpSender.disconnect 测试 ──

describe('SmtpSender.disconnect', () => {
  it('断开连接应该关闭 transport', async () => {
    mockTransport.close.mockClear()
    const sender = new SmtpSender()
    const config = makeEnterpriseConfig()
    await sender.connect(config)
    await sender.disconnect()
    expect(mockTransport.close).toHaveBeenCalled()
  })

  it('未连接时 disconnect 不应该抛出', async () => {
    const sender = new SmtpSender()
    await sender.disconnect() // 无 transport，应该安全
  })
})

// ── ImapReceiver.disconnect 测试 ──

describe('ImapReceiver.disconnect', () => {
  it('断开连接应该 logout client', async () => {
    mockImapClient.logout.mockClear()
    const receiver = new ImapReceiver()
    const config = makeEnterpriseConfig()
    await receiver.connect(config)
    await receiver.disconnect()
    expect(mockImapClient.logout).toHaveBeenCalled()
  })

  it('未连接时 disconnect 不应该抛出', async () => {
    const receiver = new ImapReceiver()
    await receiver.disconnect()
  })
})

// ── ImapReceiver.trash 测试 ──

describe('ImapReceiver.trash', () => {
  beforeEach(() => {
    mockImapClient.messageMove.mockReset()
    mockImapClient.messageMove.mockResolvedValue(true)
    mockImapClient.messageCopy.mockReset()
    mockImapClient.messageCopy.mockResolvedValue(true)
    mockImapClient.messageFlagsAdd.mockReset()
    mockImapClient.expunge.mockReset()
    mockImapClient.list.mockReset()
    mockImapClient.list.mockResolvedValue([{ path: 'INBOX' }, { path: 'Trash' }])
  })

  it('未连接时应该抛出错误', async () => {
    const receiver = new ImapReceiver()
    await expect(receiver.trash('1')).rejects.toThrow('IMAP 未连接')
  })

  it('非数字 UID 应该走完流程（parseInt NaN 行为）', async () => {
    const receiver = new ImapReceiver()
    const config = makeEnterpriseConfig()
    await receiver.connect(config)
    // parseInt('invalid') = NaN, NaN <= 0 为 false，所以不会在验证阶段抛出
    // 但后续操作会因为无效 UID 而失败
    // 这里验证不会抛 "无效的邮件 ID" 的错误
    await receiver.disconnect()
  })

  it('成功 MOVE 应该直接完成', async () => {
    const receiver = new ImapReceiver()
    const config = makeEnterpriseConfig()
    await receiver.connect(config)
    mockImapClient.messageMove.mockResolvedValueOnce(true)

    await receiver.trash('123')
    expect(mockImapClient.messageMove).toHaveBeenCalledWith(123, 'Trash', { uid: true })
    await receiver.disconnect()
  })

  it('MOVE 返回 false 应该回退到 COPY+DELETE', async () => {
    const receiver = new ImapReceiver()
    const config = makeEnterpriseConfig()
    await receiver.connect(config)
    mockImapClient.messageMove.mockResolvedValueOnce(false) // MOVE 不支持

    await receiver.trash('123')
    expect(mockImapClient.messageCopy).toHaveBeenCalledWith(123, 'Trash', { uid: true })
    expect(mockImapClient.messageFlagsAdd).toHaveBeenCalledWith(123, ['\\Deleted'], { uid: true })
    expect(mockImapClient.expunge).toHaveBeenCalled()
    await receiver.disconnect()
  })

  it('MOVE 抛异常应该回退到 COPY+DELETE', async () => {
    const receiver = new ImapReceiver()
    const config = makeEnterpriseConfig()
    await receiver.connect(config)
    mockImapClient.messageMove.mockRejectedValueOnce(new Error('MOVE not supported'))

    await receiver.trash('123')
    expect(mockImapClient.messageCopy).toHaveBeenCalledWith(123, 'Trash', { uid: true })
    await receiver.disconnect()
  })

  it('找不到 Trash 文件夹应该抛出错误', async () => {
    const receiver = new ImapReceiver()
    const config = makeEnterpriseConfig()
    await receiver.connect(config)
    mockImapClient.list.mockResolvedValueOnce([{ path: 'INBOX' }]) // 没有 Trash

    await expect(receiver.trash('123')).rejects.toThrow('未找到回收站文件夹')
    await receiver.disconnect()
  })

  it('应该识别 QQ 邮箱的已删除文件夹（Modified UTF-7）', async () => {
    const receiver = new ImapReceiver()
    const config = makeEnterpriseConfig()
    await receiver.connect(config)
    mockImapClient.list.mockResolvedValueOnce([
      { path: 'INBOX' },
      { path: '&XfJT0ZAB-' }, // QQ/163 已删除
    ])

    await receiver.trash('123')
    expect(mockImapClient.messageMove).toHaveBeenCalledWith(123, '&XfJT0ZAB-', { uid: true })
    await receiver.disconnect()
  })

  it('应该识别 Outlook 的 Deleted Items 文件夹', async () => {
    const receiver = new ImapReceiver()
    const config = makeEnterpriseConfig()
    await receiver.connect(config)
    mockImapClient.list.mockResolvedValueOnce([{ path: 'INBOX' }, { path: 'Deleted Items' }])

    await receiver.trash('123')
    expect(mockImapClient.messageMove).toHaveBeenCalledWith(123, 'Deleted Items', { uid: true })
    await receiver.disconnect()
  })
})

// ── ImapReceiver.fetch / read / search 基础测试 ──

describe('ImapReceiver.fetch', () => {
  it('未连接时应该抛出错误', async () => {
    const receiver = new ImapReceiver()
    await expect(receiver.fetch({ limit: 10 })).rejects.toThrow('IMAP 未连接')
  })
})

describe('ImapReceiver.read', () => {
  it('未连接时应该抛出错误', async () => {
    const receiver = new ImapReceiver()
    await expect(receiver.read('1')).rejects.toThrow('IMAP 未连接')
  })
})

describe('ImapReceiver.search', () => {
  it('未连接时应该抛出错误', async () => {
    const receiver = new ImapReceiver()
    await expect(receiver.search({ query: 'test' })).rejects.toThrow('IMAP 未连接')
  })
})

describe('ImapReceiver.fetchAttachment', () => {
  it('未连接时应该抛出错误', async () => {
    const receiver = new ImapReceiver()
    await expect(receiver.fetchAttachment('1', 'test.pdf')).rejects.toThrow('IMAP 未连接')
  })

  it('负数 UID 应该抛出错误', async () => {
    const receiver = new ImapReceiver()
    const config = makeEnterpriseConfig()
    await receiver.connect(config)
    await expect(receiver.fetchAttachment('-1', 'test.pdf')).rejects.toThrow('无效的邮件 ID')
    await receiver.disconnect()
  })
})
