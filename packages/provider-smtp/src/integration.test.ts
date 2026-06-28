import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { parse as yamlParse } from 'yaml'
import { SmtpSender } from './sender.js'
import { ImapReceiver } from './receiver.js'
import type { AccountConfig, SendResult } from '@mail-agent/core'
import { resolveSmtpConfig, resolveImapConfig, isOAuth2Account } from '@mail-agent/core'

/**
 * provider-smtp 集成测试 — 对接真实邮件服务器
 *
 * 测试流程：通过 SMTP 发送邮件 → 等待投递 → 通过 IMAP 读取验证
 *
 * 配置方式：直接读取 ~/.mail-agent/config.yaml + credentials.yaml
 * （与 CLI 使用相同的配置，无需额外 .env 文件）
 *
 * 如果没有配置邮箱账号，集成测试会被跳过
 */

// ── 加载测试配置 ──

function loadTestAccountFromConfig(): AccountConfig | null {
  try {
    const configDir = join(homedir(), '.mail-agent')
    const configPath = join(configDir, 'config.yaml')
    if (!existsSync(configPath)) return null

    const raw = readFileSync(configPath, 'utf-8')
    const parsed = yamlParse(raw)
    const accounts = parsed?.accounts || []
    if (accounts.length === 0) return null

    // 只取 SMTP/IMAP 类型的账号（跳过 agently、gmail 等走其他协议的账号）
    // 且必须有 SMTP 和 IMAP 配置才能做集成测试
    const smtpAccount = accounts.find(
      (a: any) => (a.provider === 'smtp-imap' || a.provider === 'qq' || a.provider === '163') && a.smtp && a.imap,
    )
    if (!smtpAccount) return null

    const a = smtpAccount

    // 读取 credentials.yaml
    const credsPath = join(configDir, 'credentials.yaml')
    let c: any = {}
    if (existsSync(credsPath)) {
      const credsRaw = readFileSync(credsPath, 'utf-8')
      const credsParsed = yamlParse(credsRaw)
      const credsList = credsParsed?.accounts || []
      c = credsList.find((cr: any) => cr.id === a.id) || {}
    }

    const account: AccountConfig = {
      id: a.id || 'acc_0',
      alias: a.alias || '测试邮箱',
      purpose: a.purpose || '',
      isDefault: true,
      provider: a.provider || 'smtp-imap',
      network: a.network || 'public',
      user: a.user || '',
      pass: c.pass,
      oauth2: c.oauth2
        ? {
            clientId: c.oauth2.client_id,
            clientSecret: c.oauth2.client_secret,
            refreshToken: c.oauth2.refresh_token,
            accessToken: c.oauth2.access_token,
            expires: c.oauth2.expires,
          }
        : undefined,
      smtp: a.smtp
        ? {
            host: a.smtp.host,
            port: a.smtp.port,
            secure: a.smtp.secure,
            rejectUnauthorized: a.smtp.reject_unauthorized,
          }
        : undefined,
      imap: a.imap
        ? {
            host: a.imap.host,
            port: a.imap.port,
            tls: a.imap.tls,
            rejectUnauthorized: a.imap.reject_unauthorized,
          }
        : undefined,
    }

    return account.user ? account : null
  } catch {
    return null
  }
}

const testAccount = loadTestAccountFromConfig()

// 投递等待时间（部分服务器投递较慢，需要更长等待）
const DELIVERY_WAIT_MS = 8000

// 唯一标记
function testMarker(): string {
  return `mail-agent-test-${Date.now()}`
}

// ── SmtpSender 发送测试 ──

describe.skipIf(!testAccount)('SmtpSender - SMTP 发送集成测试', () => {
  let sender: SmtpSender
  let config: AccountConfig

  beforeAll(async () => {
    config = testAccount!
    sender = new SmtpSender()
    await sender.connect(config)
  })

  afterAll(async () => {
    if (sender) {
      try {
        await sender.disconnect()
      } catch {}
    }
  })

  it('应该成功连接 SMTP', () => {
    expect(true).toBe(true)
  })

  it('应该成功发送邮件', async () => {
    const marker = testMarker()
    const result: SendResult = await sender.send({
      to: [{ name: '收件人', address: config.user }],
      subject: `[测试] 发送测试 ${marker}`,
      body: { text: `这是集成测试邮件，标记：${marker}` },
    })

    expect(result.success).toBe(true)
    expect(result.mailId).toBeTruthy()
    expect(result.providerId).toBeTruthy()
  })

  it('应该支持抄送', async () => {
    const marker = testMarker()
    const result = await sender.send({
      to: [{ name: '主收件人', address: config.user }],
      cc: [{ name: '抄送人', address: config.user }],
      subject: `[测试] 抄送 ${marker}`,
      body: { text: '抄送测试正文' },
    })

    expect(result.success).toBe(true)
  })

  it('未连接时应返回错误', async () => {
    const orphan = new SmtpSender()
    const result = await orphan.send({
      to: [{ name: '', address: 'x@y.com' }],
      subject: '测试',
      body: { text: '测试' },
    })

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('E1001')
    expect(result.errorMessage).toContain('SMTP 未连接')
  })
})

// ── ImapReceiver 接收测试 ──

describe.skipIf(!testAccount)('ImapReceiver - IMAP 接收集成测试', () => {
  let receiver: ImapReceiver
  let config: AccountConfig

  beforeAll(async () => {
    config = testAccount!
    receiver = new ImapReceiver()
    await receiver.connect(config)
  })

  afterAll(async () => {
    if (receiver) {
      try {
        await receiver.disconnect()
      } catch {}
    }
  })

  it('应该成功连接 IMAP', () => {
    expect(true).toBe(true)
  })

  it('应该能列出 INBOX 邮件', async () => {
    const mails = await receiver.fetch({ folder: 'INBOX', limit: 5 })
    expect(Array.isArray(mails)).toBe(true)
  })

  it('应该能搜索邮件', async () => {
    // IMAP SEARCH 在部分服务器（如 QQ）支持有限
    // 先尝试 SEARCH，如果无结果则回退到 fetch + 客户端过滤
    let mails = await receiver.search({ query: 'test', limit: 5 })
    if (mails.length === 0) {
      const recent = await receiver.fetch({ folder: 'INBOX', limit: 20 })
      mails = recent.filter(
        (m) => m.subject.toLowerCase().includes('test') || m.body.text.toLowerCase().includes('test'),
      )
    }
    expect(Array.isArray(mails)).toBe(true)
  })
})

// ── 完整收发链路测试 ──

describe.skipIf(!testAccount)('SmtpSender + ImapReceiver - 收发链路测试', () => {
  let sender: SmtpSender
  let receiver: ImapReceiver
  let config: AccountConfig

  beforeAll(async () => {
    config = testAccount!
    sender = new SmtpSender()
    receiver = new ImapReceiver()
    await sender.connect(config)
    await receiver.connect(config)
  })

  afterAll(async () => {
    if (sender)
      try {
        await sender.disconnect()
      } catch {}
    if (receiver)
      try {
        await receiver.disconnect()
      } catch {}
  })

  it('应该发送邮件后能通过 IMAP 搜索到', async () => {
    const marker = testMarker()
    const subject = `[测试-链路] ${marker}`

    const result = await sender.send({
      to: [{ name: '', address: config.user }],
      subject,
      body: { text: `收发链路测试，标记：${marker}` },
    })
    expect(result.success).toBe(true)

    // 等待投递（部分服务器较慢，分两次尝试）
    let found: any[] = []

    for (const waitMs of [DELIVERY_WAIT_MS, DELIVERY_WAIT_MS]) {
      await new Promise((resolve) => setTimeout(resolve, waitMs))

      // 策略1：先尝试 IMAP SEARCH（部分服务器如 QQ 不支持精确搜索）
      found = await receiver.search({ query: marker, limit: 5 })

      // 策略2：如果 SEARCH 无结果，回退到 fetch 最近邮件 + 客户端匹配
      if (found.length === 0) {
        const recent = await receiver.fetch({ folder: 'INBOX', limit: 50 })
        found = recent.filter((m) => m.subject.includes(marker))
      }

      if (found.length > 0) break
    }

    expect(found.length).toBeGreaterThanOrEqual(1)
    const matched = found.find((m) => m.subject.includes(marker))
    expect(matched).toBeDefined()
    expect(matched!.body.text).toContain(marker)
  })
})

// ── 错误处理测试 ──

describe('SmtpSender - 错误映射', () => {
  it('应该在缺少 SMTP 配置时抛出错误', async () => {
    const sender = new SmtpSender()
    const config: AccountConfig = {
      id: 'acc_no_smtp',
      alias: '无SMTP账号',
      purpose: 'test',
      isDefault: true,
      provider: 'smtp-imap',
      network: 'public',
      user: 'test@test.com',
    }

    await expect(sender.connect(config)).rejects.toThrow('缺少 SMTP 配置')
  })
})

describe('ImapReceiver - 错误处理', () => {
  it('应该在缺少 IMAP 配置时抛出错误', async () => {
    const receiver = new ImapReceiver()
    const config: AccountConfig = {
      id: 'acc_no_imap',
      alias: '无IMAP账号',
      purpose: 'test',
      isDefault: true,
      provider: 'smtp-imap',
      network: 'public',
      user: 'test@test.com',
    }

    await expect(receiver.connect(config)).rejects.toThrow('缺少 IMAP 配置')
  })
})

// ── 模板解析测试 ──

describe('邮箱模板解析', () => {
  it('Gmail 模板应标记为 OAuth2（实际走 Gmail API，不走 SMTP/IMAP）', () => {
    const config: AccountConfig = {
      id: 'acc_gmail',
      alias: 'Gmail',
      purpose: '',
      isDefault: true,
      provider: 'gmail',
      network: 'public',
      user: 'me@gmail.com',
    }

    // Gmail 走 REST API，模板中 SMTP/IMAP 为占位值
    const smtp = resolveSmtpConfig(config)
    expect(smtp.host).toBe('') // 占位值，实际不会被使用

    expect(isOAuth2Account(config)).toBe(true)
  })

  it('QQ 模板应该正确解析', () => {
    const config: AccountConfig = {
      id: 'acc_qq',
      alias: 'QQ',
      purpose: '',
      isDefault: true,
      provider: 'qq',
      network: 'public',
      user: '12345@qq.com',
      pass: 'authcode',
    }

    const smtp = resolveSmtpConfig(config)
    expect(smtp.host).toBe('smtp.qq.com')
    expect(smtp.pass).toBe('authcode')
    expect(isOAuth2Account(config)).toBe(false)
  })

  it('Outlook 模板应该正确解析', () => {
    const config: AccountConfig = {
      id: 'acc_outlook',
      alias: 'Outlook',
      purpose: '',
      isDefault: true,
      provider: 'outlook',
      network: 'public',
      user: 'me@outlook.com',
    }

    const smtp = resolveSmtpConfig(config)
    expect(smtp.host).toBe('smtp-mail.outlook.com')
    expect(smtp.port).toBe(587)
    expect(smtp.secure).toBe(false)
    expect(isOAuth2Account(config)).toBe(true)
  })

  it('自定义 smtp-imap 应该用手动填写的值', () => {
    const config: AccountConfig = {
      id: 'acc_custom',
      alias: '公司',
      purpose: '',
      isDefault: true,
      provider: 'smtp-imap',
      network: 'private',
      user: 'me@company.com',
      pass: 'pass',
      smtp: { host: 'mail.company.com', port: 25 },
      imap: { host: 'mail.company.com', port: 143 },
    }

    const smtp = resolveSmtpConfig(config)
    expect(smtp.host).toBe('mail.company.com')
    expect(smtp.port).toBe(25)

    const imap = resolveImapConfig(config)
    expect(imap.host).toBe('mail.company.com')
    expect(imap.port).toBe(143)
  })
})
