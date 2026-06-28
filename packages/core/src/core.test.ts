import { describe, it, expect } from 'vitest'
import type {
  MailAddress,
  MailBody,
  Attachment,
  Mail,
  MailThread,
  OutboundMail,
  SendResult,
  FetchCriteria,
  SearchCriteria,
  HealthStatus,
  MailError,
  CliResult,
  ProviderCapabilities,
  AccountConfig,
  MailProvider,
} from '../src/index.js'
import {
  MailErrorClass,
  formatMailAddress,
  resolveSmtpConfig,
  resolveImapConfig,
  isOAuth2Account,
  isTokenExpired,
  PROVIDER_TEMPLATES,
} from '../src/index.js'

/**
 * @mail-agent/core 单元测试
 * 验证数据模型类型的正确性和接口契约
 */
describe('@mail-agent/core - 数据模型', () => {
  describe('MailAddress', () => {
    it('应该能创建带名称的地址', () => {
      const addr: MailAddress = { name: '张三', address: 'zhangsan@example.com' }
      expect(addr.name).toBe('张三')
      expect(addr.address).toBe('zhangsan@example.com')
    })

    it('应该能创建不带名称的地址', () => {
      const addr: MailAddress = { name: '', address: 'test@test.com' }
      expect(addr.name).toBe('')
      expect(addr.address).toBe('test@test.com')
    })
  })

  describe('MailBody', () => {
    it('应该支持纯文本', () => {
      const body: MailBody = { text: 'hello world' }
      expect(body.text).toBe('hello world')
      expect(body.html).toBeUndefined()
    })

    it('应该支持 HTML 内容', () => {
      const body: MailBody = { text: 'plain', html: '<p>html</p>' }
      expect(body.text).toBe('plain')
      expect(body.html).toBe('<p>html</p>')
    })
  })

  describe('Attachment', () => {
    it('应该包含基本字段', () => {
      const att: Attachment = {
        filename: 'report.pdf',
        contentType: 'application/pdf',
        size: 102400,
      }
      expect(att.filename).toBe('report.pdf')
      expect(att.contentType).toBe('application/pdf')
      expect(att.size).toBe(102400)
    })

    it('应该支持可选字段', () => {
      const att: Attachment = {
        filename: 'img.png',
        contentType: 'image/png',
        size: 5000,
        contentId: 'img001',
        downloadUrl: 'https://example.com/img.png',
      }
      expect(att.contentId).toBe('img001')
      expect(att.downloadUrl).toBe('https://example.com/img.png')
    })
  })

  describe('Mail', () => {
    it('应该包含完整邮件字段', () => {
      const mail: Mail = {
        id: 'msg_001',
        providerId: 'prov_abc',
        accountId: 'acc_1',
        accountAlias: '工作邮箱',
        subject: '项目周报',
        body: { text: '本周完成了...', html: '<p>本周完成了...</p>' },
        from: { name: '李四', address: 'lisi@company.com' },
        to: [{ name: '王五', address: 'wangwu@company.com' }],
        cc: [],
        bcc: [],
        attachments: [],
        labels: ['inbox', 'important'],
        date: new Date('2025-01-15T10:00:00Z'),
        read: false,
        starred: true,
      }
      expect(mail.id).toBe('msg_001')
      expect(mail.read).toBe(false)
      expect(mail.starred).toBe(true)
      expect(mail.attachments).toHaveLength(0)
    })

    it('应该支持线程引用', () => {
      const mail: Mail = {
        id: 'msg_reply',
        providerId: 'prov_x',
        accountId: 'acc_1',
        accountAlias: '测试',
        subject: 'Re: 原始主题',
        body: { text: '收到' },
        from: { name: '', address: 'a@b.com' },
        to: [],
        cc: [],
        bcc: [],
        attachments: [],
        labels: [],
        date: new Date(),
        read: true,
        starred: false,
        threadId: 'thread_ref_001',
      }
      expect(mail.threadId).toBe('thread_ref_001')
    })
  })

  describe('MailThread', () => {
    it('应该包含会话信息', () => {
      const mail1: Mail = {
        id: 'm1',
        providerId: 'p1',
        accountId: 'a1',
        accountAlias: 't',
        subject: '测试',
        body: { text: '' },
        from: { name: '', address: 'a@b.com' },
        to: [],
        cc: [],
        bcc: [],
        attachments: [],
        labels: [],
        date: new Date(),
        read: true,
        starred: false,
      }
      const thread: MailThread = {
        id: 'thread_001',
        mails: [mail1],
        subject: '测试',
        participants: [{ name: '', address: 'a@b.com' }],
        lastMail: mail1,
        mailCount: 1,
      }
      expect(thread.mailCount).toBe(1)
      expect(thread.mails).toHaveLength(1)
    })
  })

  describe('OutboundMail', () => {
    it('应该支持必填字段', () => {
      const mail: OutboundMail = {
        to: [{ name: '', address: 'recipient@example.com' }],
        subject: '测试邮件',
        body: { text: '正文内容' },
      }
      expect(mail.to).toHaveLength(1)
      expect(mail.subject).toBe('测试邮件')
    })

    it('应该支持可选字段 cc/bcc/attachments', () => {
      const mail: OutboundMail = {
        to: [{ name: '', address: 'to@example.com' }],
        subject: '带抄送',
        body: { text: '正文' },
        cc: [{ name: '抄送人', address: 'cc@example.com' }],
        bcc: [{ name: '密送人', address: 'bcc@example.com' }],
        attachments: [{ filename: 'att.txt', contentType: 'text/plain', size: 100 }],
        inReplyTo: '<original-message-id@example.com>',
        accountAlias: '工作邮箱',
      }
      expect(mail.cc).toHaveLength(1)
      expect(mail.bcc).toHaveLength(1)
      expect(mail.attachments).toHaveLength(1)
      expect(mail.inReplyTo).toBeDefined()
    })

    it('应该支持 attachmentContents 字段（转发附件用）', () => {
      const mail: OutboundMail = {
        to: [{ name: '', address: 'to@example.com' }],
        subject: '转发带附件',
        body: { text: '请查收' },
        attachmentContents: [
          {
            filename: 'report.pdf',
            contentType: 'application/pdf',
            size: 1024,
            content: Buffer.from('fake-pdf-content'),
          },
        ],
      }
      expect(mail.attachmentContents).toHaveLength(1)
      expect(mail.attachmentContents![0].filename).toBe('report.pdf')
      expect(mail.attachmentContents![0].content).toBeInstanceOf(Buffer)
    })
  })

  describe('SendResult', () => {
    it('成功结果', () => {
      const result: SendResult = {
        success: true,
        mailId: 'uuid_v7',
        providerId: 'msg_id@example.com',
      }
      expect(result.success).toBe(true)
      expect(result.mailId).toBe('uuid_v7')
    })

    it('失败结果应包含错误码', () => {
      const result: SendResult = {
        success: false,
        mailId: 'uuid_v7',
        errorCode: 'E1002',
        errorMessage: '认证失败',
      }
      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('E1002')
      expect(result.errorMessage).toBe('认证失败')
    })
  })

  describe('FetchCriteria / SearchCriteria', () => {
    it('FetchCriteria 应该支持所有可选过滤', () => {
      const criteria: FetchCriteria = {
        folder: 'INBOX',
        limit: 10,
        unread: true,
        since: new Date('2025-01-01'),
        before: new Date('2025-06-01'),
        cursor: 'page_2',
        accountAlias: '工作邮箱',
      }
      expect(criteria.folder).toBe('INBOX')
      expect(criteria.limit).toBe(10)
    })

    it('SearchCriteria 应该继承 FetchCriteria 并扩展 query', () => {
      const criteria: SearchCriteria = {
        query: '周报',
        folder: 'INBOX',
        limit: 5,
        from: 'boss@company.com',
        to: 'team@company.com',
        hasAttachments: true,
      }
      expect(criteria.query).toBe('周报')
      expect(criteria.from).toBe('boss@company.com')
      expect(criteria.hasAttachments).toBe(true)
    })
  })

  describe('HealthStatus', () => {
    it('应该记录延迟信息', () => {
      const status: HealthStatus = {
        connected: true,
        accountId: 'acc_1',
        alias: '测试邮箱',
        provider: 'smtp-imap',
        latency: 45,
      }
      expect(status.connected).toBe(true)
      expect(status.latency).toBe(45)
    })
  })

  describe('MailError', () => {
    it('应该标记是否可重试', () => {
      const err: MailError = {
        code: 'NETWORK_ERR',
        providerCode: 'ECONNREFUSED',
        message: '连接被拒绝',
        retryable: true,
        retryAfter: 30,
        accountId: 'acc_1',
      }
      expect(err.retryable).toBe(true)
      expect(err.retryAfter).toBe(30)
    })
  })

  describe('MailErrorClass', () => {
    it('应该是 Error 的子类', () => {
      const err = new MailErrorClass({
        code: 'E1001',
        providerCode: 'ECONNREFUSED',
        message: '连接被拒绝',
        retryable: true,
        retryAfter: 5,
      })
      expect(err).toBeInstanceOf(Error)
      expect(err).toBeInstanceOf(MailErrorClass)
      expect(err.name).toBe('MailError')
    })

    it('应该包含所有 MailError 字段', () => {
      const err = new MailErrorClass({
        code: 'E1002',
        providerCode: 'AUTHENTICATIONFAILED',
        message: '认证失败',
        retryable: false,
        accountId: 'acc_1',
      })
      expect(err.code).toBe('E1002')
      expect(err.providerCode).toBe('AUTHENTICATIONFAILED')
      expect(err.message).toBe('认证失败')
      expect(err.retryable).toBe(false)
      expect(err.retryAfter).toBeUndefined()
      expect(err.accountId).toBe('acc_1')
    })

    it('可以被 catch 捕获并用 instanceof 判断', () => {
      const throwIt = () => {
        throw new MailErrorClass({
          code: 'E1001',
          providerCode: 'ETIMEDOUT',
          message: '超时',
          retryable: true,
        })
      }

      try {
        throwIt()
      } catch (err) {
        expect(err).toBeInstanceOf(MailErrorClass)
        expect((err as MailErrorClass).code).toBe('E1001')
        expect((err as MailErrorClass).retryable).toBe(true)
      }
    })

    it('同时满足 MailError interface', () => {
      const err: MailError = new MailErrorClass({
        code: 'E2001',
        providerCode: 'unknown',
        message: '未知错误',
        retryable: false,
      })
      expect(err.code).toBe('E2001')
      expect(err.retryable).toBe(false)
    })
  })

  describe('CliResult', () => {
    it('成功响应', () => {
      const result: CliResult<string> = {
        ok: true,
        data: '测试结果',
      }
      expect(result.ok).toBe(true)
      expect(result.data).toBe('测试结果')
      expect(result.error).toBeUndefined()
    })

    it('失败响应', () => {
      const result: CliResult = {
        ok: false,
        error: '配置文件不存在',
      }
      expect(result.ok).toBe(false)
      expect(result.error).toBe('配置文件不存在')
    })
  })
})

describe('@mail-agent/core - 接口契约', () => {
  describe('ProviderCapabilities', () => {
    it('应该声明适配器能力', () => {
      const caps: ProviderCapabilities = {
        realtimePush: false,
        imapIdle: true,
        threadNative: false,
        aiParsing: false,
        attachmentOcr: false,
        maxAttachmentSize: 25 * 1024 * 1024,
        sendRateLimit: 30,
      }
      expect(caps.imapIdle).toBe(true)
      expect(caps.maxAttachmentSize).toBe(25 * 1024 * 1024)
    })
  })

  describe('AccountConfig', () => {
    it('应该支持 SMTP/IMAP 配置', () => {
      const config: AccountConfig = {
        id: 'acc_smtp_1',
        alias: 'QQ邮箱',
        purpose: 'daily',
        isDefault: true,
        provider: 'qq',
        network: 'public',
        user: '123456@qq.com',
        pass: 'auth_code',
      }
      expect(config.alias).toBe('QQ邮箱')
    })

    it('应该支持私有化邮箱配置', () => {
      const config: AccountConfig = {
        id: 'acc_priv_1',
        alias: '企业邮箱',
        purpose: 'work',
        isDefault: false,
        provider: 'smtp-imap',
        network: 'private',
        user: 'zhangsan@corp.com',
        pass: 'password',
        smtp: {
          host: 'mail.internal.corp',
          port: 465,
          secure: true,
          rejectUnauthorized: false,
        },
        imap: {
          host: 'mail.internal.corp',
          port: 993,
          tls: true,
          rejectUnauthorized: false,
        },
      }
      expect(config.network).toBe('private')
      expect(config.smtp?.rejectUnauthorized).toBe(false)
    })
  })

  describe('MailProvider 接口', () => {
    // 用一个 mock 实现来验证接口契约
    class MockProvider implements MailProvider {
      connected = false
      async connect(_config: AccountConfig): Promise<void> {
        this.connected = true
      }
      async disconnect(): Promise<void> {
        this.connected = false
      }
      async healthCheck(): Promise<HealthStatus> {
        return { connected: this.connected, accountId: 'mock', alias: 'mock', provider: 'mock' }
      }
      async send(_mail: OutboundMail): Promise<SendResult> {
        return { success: true, mailId: 'mock_id' }
      }
      async fetch(_criteria: FetchCriteria): Promise<Mail[]> {
        return []
      }
      async read(_mailId: string): Promise<Mail> {
        throw new Error('Not implemented')
      }
      async search(_criteria: SearchCriteria): Promise<Mail[]> {
        return []
      }
      async getThread(_threadId: string): Promise<MailThread> {
        throw new Error('Not implemented')
      }
      async trash(_mailId: string): Promise<void> {}
      async reply(_mailId: string, _body: string): Promise<SendResult> {
        return { success: true, mailId: 'mock_reply_id' }
      }
      async forward(_mailId: string, _to: import('../src/index.js').MailAddress[]): Promise<SendResult> {
        return { success: true, mailId: 'mock_forward_id' }
      }
      async fetchAttachment(_mailId: string, _filename: string): Promise<import('../src/index.js').AttachmentContent> {
        throw new Error('Not implemented')
      }
      capabilities(): ProviderCapabilities {
        return {
          realtimePush: false,
          imapIdle: false,
          threadNative: false,
          aiParsing: false,
          attachmentOcr: false,
          maxAttachmentSize: 0,
          sendRateLimit: 0,
        }
      }
    }

    it('MockProvider 应该满足 MailProvider 接口', () => {
      const provider = new MockProvider()
      expect(provider).toHaveProperty('connect')
      expect(provider).toHaveProperty('disconnect')
      expect(provider).toHaveProperty('send')
      expect(provider).toHaveProperty('fetch')
      expect(provider).toHaveProperty('read')
      expect(provider).toHaveProperty('search')
      expect(provider).toHaveProperty('getThread')
      expect(provider).toHaveProperty('trash')
      expect(provider).toHaveProperty('reply')
      expect(provider).toHaveProperty('forward')
      expect(provider).toHaveProperty('fetchAttachment')
      expect(provider).toHaveProperty('capabilities')
    })

    it('应该能调用 mock provider 的方法', async () => {
      const provider = new MockProvider()
      await provider.connect({
        id: '1',
        alias: 'test',
        purpose: '',
        isDefault: true,
        provider: 'smtp-imap',
        network: 'public',
      })
      expect(provider.connected).toBe(true)

      const status = await provider.healthCheck()
      expect(status.connected).toBe(true)

      const caps = provider.capabilities()
      expect(caps).toHaveProperty('imapIdle')
    })
  })
})

describe('@mail-agent/core - formatMailAddress', () => {
  it('无名时只返回地址', () => {
    expect(formatMailAddress(undefined, 'bob@example.com')).toBe('bob@example.com')
  })

  it('空字符串名时只返回地址', () => {
    expect(formatMailAddress('', 'bob@example.com')).toBe('bob@example.com')
  })

  it('普通显示名不加引号', () => {
    expect(formatMailAddress('张三', 'zhangsan@example.com')).toBe('张三 <zhangsan@example.com>')
  })

  it('英文显示名不加引号', () => {
    expect(formatMailAddress('Bob', 'bob@example.com')).toBe('Bob <bob@example.com>')
  })

  it('含 RFC 5322 特殊字符时加引号', () => {
    expect(formatMailAddress('Zhang, San', 'zhangsan@example.com')).toBe('"Zhang, San" <zhangsan@example.com>')
  })

  it('含 @ 符号时加引号', () => {
    expect(formatMailAddress('bob@home', 'bob@example.com')).toBe('"bob@home" <bob@example.com>')
  })

  it('含双引号时转义并加引号', () => {
    expect(formatMailAddress('Say "Hi"', 'bob@example.com')).toBe('"Say \\"Hi\\"" <bob@example.com>')
  })

  it('含反斜杠时转义并加引号', () => {
    expect(formatMailAddress('A\\B', 'bob@example.com')).toBe('"A\\\\B" <bob@example.com>')
  })

  it('含点号时加引号', () => {
    // 点号虽在 dot-atom 中合法，但出现在短语中可能引起歧义，保守加引号
    expect(formatMailAddress('Dr. Smith', 'smith@example.com')).toBe('"Dr. Smith" <smith@example.com>')
  })
})

// ── resolveSmtpConfig / resolveImapConfig 测试 ──

describe('@mail-agent/core - resolveSmtpConfig', () => {
  it('smtp-imap 应该使用手动填写的值', () => {
    const config: AccountConfig = {
      id: 'acc_corp',
      alias: '公司邮箱',
      purpose: 'work',
      isDefault: true,
      provider: 'smtp-imap',
      network: 'private',
      user: 'me@company.com',
      pass: 'mypass',
      smtp: { host: 'mail.company.com', port: 465, secure: true },
    }
    const smtp = resolveSmtpConfig(config)
    expect(smtp.host).toBe('mail.company.com')
    expect(smtp.port).toBe(465)
    expect(smtp.secure).toBe(true)
    expect(smtp.user).toBe('me@company.com')
    expect(smtp.pass).toBe('mypass')
  })

  it('smtp-imap 无模板时应该使用合理默认值', () => {
    const config: AccountConfig = {
      id: 'acc_corp',
      alias: '公司',
      purpose: '',
      isDefault: true,
      provider: 'smtp-imap',
      network: 'private',
      user: 'me@company.com',
      pass: 'pass',
      // 不填 smtp 字段
    }
    const smtp = resolveSmtpConfig(config)
    expect(smtp.host).toBe('') // 无模板，无手动值 → 空
    expect(smtp.port).toBe(465) // 默认端口
    expect(smtp.secure).toBe(true) // 默认 SSL
  })

  it('smtp-imap 应该传递 rejectUnauthorized', () => {
    const config: AccountConfig = {
      id: 'acc_corp',
      alias: '公司',
      purpose: '',
      isDefault: true,
      provider: 'smtp-imap',
      network: 'private',
      user: 'me@company.com',
      pass: 'pass',
      smtp: { host: 'mail.corp', port: 465, rejectUnauthorized: false },
    }
    const smtp = resolveSmtpConfig(config)
    expect(smtp.rejectUnauthorized).toBe(false)
  })

  it('qq 应该使用模板自动填充', () => {
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
    const smtp = resolveSmtpConfig(config)
    expect(smtp.host).toBe('smtp.qq.com')
    expect(smtp.port).toBe(465)
    expect(smtp.secure).toBe(true)
  })

  it('163 应该使用模板自动填充', () => {
    const config: AccountConfig = {
      id: 'acc_163',
      alias: '163',
      purpose: '',
      isDefault: true,
      provider: '163',
      network: 'public',
      user: 'user@163.com',
      pass: 'authcode',
    }
    const smtp = resolveSmtpConfig(config)
    expect(smtp.host).toBe('smtp.163.com')
    expect(smtp.port).toBe(465)
    expect(smtp.secure).toBe(true)
  })

  it('outlook 应该使用模板自动填充（587/STARTTLS）', () => {
    const config: AccountConfig = {
      id: 'acc_outlook',
      alias: 'Outlook',
      purpose: '',
      isDefault: true,
      provider: 'outlook',
      network: 'public',
      user: 'user@outlook.com',
      pass: 'pass',
    }
    const smtp = resolveSmtpConfig(config)
    expect(smtp.host).toBe('smtp-mail.outlook.com')
    expect(smtp.port).toBe(587)
    expect(smtp.secure).toBe(false) // STARTTLS
  })

  it('自定义 smtp 字段应该覆盖模板默认值', () => {
    const config: AccountConfig = {
      id: 'acc_qq_custom',
      alias: 'QQ自定义',
      purpose: '',
      isDefault: true,
      provider: 'qq',
      network: 'public',
      user: '123456@qq.com',
      pass: 'authcode',
      smtp: { host: 'custom.smtp.com', port: 587, secure: false },
    }
    const smtp = resolveSmtpConfig(config)
    expect(smtp.host).toBe('custom.smtp.com')
    expect(smtp.port).toBe(587)
    expect(smtp.secure).toBe(false)
  })

  it('部分覆盖应该与模板默认值合并', () => {
    const config: AccountConfig = {
      id: 'acc_qq_port',
      alias: 'QQ改端口',
      purpose: '',
      isDefault: true,
      provider: 'qq',
      network: 'public',
      user: '123456@qq.com',
      pass: 'authcode',
      smtp: { port: 587 }, // 只改端口，host/secure 用模板
    }
    const smtp = resolveSmtpConfig(config)
    expect(smtp.host).toBe('smtp.qq.com') // 模板值
    expect(smtp.port).toBe(587) // 自定义覆盖
    expect(smtp.secure).toBe(true) // 模板值
  })

  it('企业自建邮非标准端口 25（明文）', () => {
    const config: AccountConfig = {
      id: 'acc_corp25',
      alias: '内网25',
      purpose: '',
      isDefault: true,
      provider: 'smtp-imap',
      network: 'private',
      user: 'me@corp.com',
      pass: 'pass',
      smtp: { host: 'mail.corp.com', port: 25, secure: false },
    }
    const smtp = resolveSmtpConfig(config)
    expect(smtp.port).toBe(25)
    expect(smtp.secure).toBe(false)
  })

  it('企业自建邮 STARTTLS 端口 587', () => {
    const config: AccountConfig = {
      id: 'acc_corp587',
      alias: '内网587',
      purpose: '',
      isDefault: true,
      provider: 'smtp-imap',
      network: 'private',
      user: 'me@corp.com',
      pass: 'pass',
      smtp: { host: 'mail.corp.com', port: 587, secure: false },
    }
    const smtp = resolveSmtpConfig(config)
    expect(smtp.port).toBe(587)
    expect(smtp.secure).toBe(false)
  })
})

describe('@mail-agent/core - resolveImapConfig', () => {
  it('smtp-imap 应该使用手动填写的值', () => {
    const config: AccountConfig = {
      id: 'acc_corp',
      alias: '公司邮箱',
      purpose: 'work',
      isDefault: true,
      provider: 'smtp-imap',
      network: 'private',
      user: 'me@company.com',
      pass: 'mypass',
      imap: { host: 'mail.company.com', port: 993, tls: true },
    }
    const imap = resolveImapConfig(config)
    expect(imap.host).toBe('mail.company.com')
    expect(imap.port).toBe(993)
    expect(imap.tls).toBe(true)
    expect(imap.user).toBe('me@company.com')
    expect(imap.pass).toBe('mypass')
  })

  it('smtp-imap 无模板时应该使用合理默认值', () => {
    const config: AccountConfig = {
      id: 'acc_corp',
      alias: '公司',
      purpose: '',
      isDefault: true,
      provider: 'smtp-imap',
      network: 'private',
      user: 'me@company.com',
      pass: 'pass',
    }
    const imap = resolveImapConfig(config)
    expect(imap.host).toBe('')
    expect(imap.port).toBe(993) // 默认 IMAP 端口
    expect(imap.tls).toBe(true) // 默认 TLS
  })

  it('smtp-imap 应该传递 rejectUnauthorized', () => {
    const config: AccountConfig = {
      id: 'acc_corp',
      alias: '公司',
      purpose: '',
      isDefault: true,
      provider: 'smtp-imap',
      network: 'private',
      user: 'me@company.com',
      pass: 'pass',
      imap: { host: 'mail.corp', port: 993, rejectUnauthorized: false },
    }
    const imap = resolveImapConfig(config)
    expect(imap.rejectUnauthorized).toBe(false)
  })

  it('qq 应该使用模板自动填充', () => {
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
    const imap = resolveImapConfig(config)
    expect(imap.host).toBe('imap.qq.com')
    expect(imap.port).toBe(993)
    expect(imap.tls).toBe(true)
  })

  it('outlook 应该使用模板自动填充', () => {
    const config: AccountConfig = {
      id: 'acc_outlook',
      alias: 'Outlook',
      purpose: '',
      isDefault: true,
      provider: 'outlook',
      network: 'public',
      user: 'user@outlook.com',
      pass: 'pass',
    }
    const imap = resolveImapConfig(config)
    expect(imap.host).toBe('outlook.office365.com')
    expect(imap.port).toBe(993)
    expect(imap.tls).toBe(true)
  })

  it('企业自建邮非标准端口 143（明文 IMAP）', () => {
    const config: AccountConfig = {
      id: 'acc_corp143',
      alias: '内网143',
      purpose: '',
      isDefault: true,
      provider: 'smtp-imap',
      network: 'private',
      user: 'me@corp.com',
      pass: 'pass',
      imap: { host: 'mail.corp.com', port: 143, tls: false },
    }
    const imap = resolveImapConfig(config)
    expect(imap.port).toBe(143)
    expect(imap.tls).toBe(false)
  })

  it('自定义 imap 字段应该覆盖模板默认值', () => {
    const config: AccountConfig = {
      id: 'acc_qq_custom',
      alias: 'QQ自定义',
      purpose: '',
      isDefault: true,
      provider: 'qq',
      network: 'public',
      user: '123456@qq.com',
      pass: 'authcode',
      imap: { host: 'custom.imap.com', port: 143, tls: false },
    }
    const imap = resolveImapConfig(config)
    expect(imap.host).toBe('custom.imap.com')
    expect(imap.port).toBe(143)
    expect(imap.tls).toBe(false)
  })
})

// ── isOAuth2Account / isTokenExpired 测试 ──

describe('@mail-agent/core - isOAuth2Account', () => {
  it('gmail 模板应该返回 true', () => {
    const config: AccountConfig = {
      id: 'acc_gmail',
      alias: 'Gmail',
      purpose: '',
      isDefault: true,
      provider: 'gmail',
      network: 'public',
      user: 'user@gmail.com',
    }
    expect(isOAuth2Account(config)).toBe(true)
  })

  it('outlook 模板应该返回 true', () => {
    const config: AccountConfig = {
      id: 'acc_outlook',
      alias: 'Outlook',
      purpose: '',
      isDefault: true,
      provider: 'outlook',
      network: 'public',
      user: 'user@outlook.com',
    }
    expect(isOAuth2Account(config)).toBe(true)
  })

  it('qq 模板应该返回 false', () => {
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
    expect(isOAuth2Account(config)).toBe(false)
  })

  it('smtp-imap 无 oauth2 应该返回 false', () => {
    const config: AccountConfig = {
      id: 'acc_corp',
      alias: '公司',
      purpose: '',
      isDefault: true,
      provider: 'smtp-imap',
      network: 'private',
      user: 'me@corp.com',
      pass: 'pass',
    }
    expect(isOAuth2Account(config)).toBe(false)
  })

  it('smtp-imap 带 oauth2 字段应该返回 true', () => {
    const config: AccountConfig = {
      id: 'acc_corp_oauth',
      alias: '公司OAuth2',
      purpose: '',
      isDefault: true,
      provider: 'smtp-imap',
      network: 'private',
      user: 'me@corp.com',
      oauth2: {
        clientId: 'id',
        clientSecret: 'secret',
        refreshToken: 'refresh',
        accessToken: 'access',
        expires: Date.now() + 3600000,
      },
    }
    expect(isOAuth2Account(config)).toBe(true)
  })
})

describe('@mail-agent/core - isTokenExpired', () => {
  it('无 expires 应该返回 true（视为已过期）', () => {
    expect(isTokenExpired({ clientId: '', clientSecret: '', refreshToken: '' })).toBe(true)
  })

  it('expires 在未来应该返回 false', () => {
    const future = Date.now() + 3600 * 1000 // 1 小时后
    expect(isTokenExpired({ clientId: '', clientSecret: '', refreshToken: '', expires: future })).toBe(false)
  })

  it('expires 已过应该返回 true', () => {
    const past = Date.now() - 1000 // 1 秒前
    expect(isTokenExpired({ clientId: '', clientSecret: '', refreshToken: '', expires: past })).toBe(true)
  })

  it('expires 在 5 分钟内应该返回 true（缓冲期）', () => {
    const soon = Date.now() + 4 * 60 * 1000 // 4 分钟后（在 5 分钟缓冲内）
    expect(isTokenExpired({ clientId: '', clientSecret: '', refreshToken: '', expires: soon })).toBe(true)
  })

  it('expires 刚过 5 分钟缓冲应该返回 false', () => {
    const safe = Date.now() + 6 * 60 * 1000 // 6 分钟后（超过 5 分钟缓冲）
    expect(isTokenExpired({ clientId: '', clientSecret: '', refreshToken: '', expires: safe })).toBe(false)
  })
})

// ── PROVIDER_TEMPLATES 完整性测试 ──

describe('@mail-agent/core - PROVIDER_TEMPLATES', () => {
  it('应该包含所有内置邮箱模板', () => {
    expect(Object.keys(PROVIDER_TEMPLATES)).toContain('gmail')
    expect(Object.keys(PROVIDER_TEMPLATES)).toContain('outlook')
    expect(Object.keys(PROVIDER_TEMPLATES)).toContain('qq')
    expect(Object.keys(PROVIDER_TEMPLATES)).toContain('163')
    expect(Object.keys(PROVIDER_TEMPLATES)).toContain('agently')
  })

  it('每个模板应该包含 smtp 和 imap 配置', () => {
    for (const [name, template] of Object.entries(PROVIDER_TEMPLATES)) {
      expect(template.smtp).toBeDefined()
      expect(template.imap).toBeDefined()
      expect(template.authType).toBeDefined()
    }
  })

  it('smtp-imap 不在模板中（完全自定义）', () => {
    expect(PROVIDER_TEMPLATES['smtp-imap']).toBeUndefined()
  })
})
