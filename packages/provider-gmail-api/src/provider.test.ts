import { describe, it, expect } from 'vitest'
import { GmailApiProvider } from '../src/provider.js'
import { decodeBase64Url, stripHtml, decodeMimeHeader, encodeRawEmail } from '../src/convert.js'
import { mapGmailApiError } from '../src/errors.js'

/**
 * @mail-agent/provider-gmail-api 单元测试
 * Mock Gmail API 响应，验证 Provider 逻辑和数据转换
 */

// ── 数据转换测试 ──

describe('decodeBase64Url', () => {
  it('标准 base64url 解码', () => {
    // "Hello, World!" → "SGVsbG8sIFdvcmxkIQ"
    const encoded = 'SGVsbG8sIFdvcmxkIQ'
    const result = decodeBase64Url(encoded)
    expect(result).toBe('Hello, World!')
  })

  it('含 - 和 _ 的 base64url', () => {
    // base64url 用 - 替换 +，用 _ 替换 /
    const encoded = 'SGVsbG8tV29ybGRf'
    const result = decodeBase64Url(encoded)
    expect(result).toContain('Hello')
  })

  it('中文 UTF-8 解码', () => {
    const text = '你好世界'
    const encoded = Buffer.from(text).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const result = decodeBase64Url(encoded)
    expect(result).toBe(text)
  })
})

describe('stripHtml', () => {
  it('移除 HTML 标签', () => {
    expect(stripHtml('<p>Hello</p>')).toBe('Hello')
  })

  it('<br> 转换为换行', () => {
    expect(stripHtml('Line1<br>Line2')).toBe('Line1\nLine2')
  })

  it('</p> 转换为换行', () => {
    expect(stripHtml('<p>Para1</p><p>Para2</p>')).toBe('Para1\nPara2')
  })

  it('解码 HTML 实体', () => {
    expect(stripHtml('&nbsp;Hello&amp;World')).toBe('Hello&World')
  })

  it('移除 <style> 块', () => {
    expect(stripHtml('<style>body{color:red}</style>Hello')).toBe('Hello')
  })

  it('移除 <script> 块', () => {
    expect(stripHtml('<script>alert(1)</script>Hello')).toBe('Hello')
  })

  it('空字符串', () => {
    expect(stripHtml('')).toBe('')
  })
})

describe('decodeMimeHeader', () => {
  it('UTF-8 Base64 编码', () => {
    const encoded = '=?UTF-8?B?5L2g5aW9?=' // "你好"
    const result = decodeMimeHeader(encoded)
    expect(result).toBe('你好')
  })

  it('UTF-8 Quoted-Printable 编码', () => {
    const encoded = '=?UTF-8?Q?Hello_World?=' // "Hello World"
    const result = decodeMimeHeader(encoded)
    expect(result).toBe('Hello World')
  })

  it('纯文本不变', () => {
    expect(decodeMimeHeader('Plain text')).toBe('Plain text')
  })

  it('空字符串不变', () => {
    expect(decodeMimeHeader('')).toBe('')
  })
})

describe('encodeRawEmail', () => {
  it('生成 RFC 2822 格式邮件', () => {
    const raw = encodeRawEmail({
      from: '"Test" <test@example.com>',
      to: ['recipient@example.com'],
      subject: 'Test Subject',
      text: 'Hello World',
    })
    expect(raw).toBeDefined()
    expect(typeof raw).toBe('string')
    expect(raw.length).toBeGreaterThan(0)
  })

  it('带 CC 字段', () => {
    const raw = encodeRawEmail({
      from: '"Test" <test@example.com>',
      to: ['to@example.com'],
      subject: 'With CC',
      text: 'Body',
      cc: ['cc@example.com'],
    })
    expect(raw).toBeDefined()
  })

  it('带 In-Reply-To', () => {
    const raw = encodeRawEmail({
      from: '"Test" <test@example.com>',
      to: ['to@example.com'],
      subject: 'Re: Test',
      text: 'Reply',
      inReplyTo: '<original-msg@example.com>',
    })
    expect(raw).toBeDefined()
  })

  it('HTML 正文生成 multipart', () => {
    const raw = encodeRawEmail({
      from: '"Test" <test@example.com>',
      to: ['to@example.com'],
      subject: 'HTML Email',
      text: 'Plain text',
      html: '<p>HTML content</p>',
    })
    expect(raw).toBeDefined()
    // multipart/alternative 应该有 boundary
  })

  it('带附件生成 multipart/mixed', () => {
    const raw = encodeRawEmail({
      from: '"Test" <test@example.com>',
      to: ['to@example.com'],
      subject: 'With Attachment',
      text: 'See attachment',
      attachments: [
        {
          filename: 'test.txt',
          contentType: 'text/plain',
          size: 5,
          content: Buffer.from('hello'),
        },
      ],
    })
    expect(raw).toBeDefined()
    // 解码后应包含 multipart/mixed 和附件
    const decoded = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()
    expect(decoded).toContain('multipart/mixed')
    expect(decoded).toContain('attachment')
    expect(decoded).toContain('test.txt')
  })

  it('带附件和 HTML 正文生成嵌套 multipart', () => {
    const raw = encodeRawEmail({
      from: '"Test" <test@example.com>',
      to: ['to@example.com'],
      subject: 'Complex Email',
      text: 'Plain text',
      html: '<p>HTML content</p>',
      attachments: [
        {
          filename: 'doc.pdf',
          contentType: 'application/pdf',
          size: 100,
          content: Buffer.alloc(100),
        },
      ],
    })
    expect(raw).toBeDefined()
    const decoded = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()
    expect(decoded).toContain('multipart/mixed')
    expect(decoded).toContain('multipart/alternative')
    expect(decoded).toContain('doc.pdf')
  })
})

// ── Gmail API 错误码映射 ──

describe('mapGmailApiError', () => {
  it('ECONNECTION → E1001 (retryable)', () => {
    const err = mapGmailApiError({ code: 'ECONNECTION', message: 'Connection failed' })
    expect(err.code).toBe('E1001')
    expect(err.retryable).toBe(true)
    expect(err.retryAfter).toBe(5)
  })

  it('ETIMEDOUT → E1001 (retryable)', () => {
    const err = mapGmailApiError({ code: 'ETIMEDOUT', message: 'Timeout' })
    expect(err.code).toBe('E1001')
    expect(err.retryable).toBe(true)
  })

  it('ECONNRESET → E1001 (retryable)', () => {
    const err = mapGmailApiError({ code: 'ECONNRESET', message: 'Reset' })
    expect(err.code).toBe('E1001')
    expect(err.retryable).toBe(true)
  })

  it('401 → E1002 (not retryable)', () => {
    const err = mapGmailApiError({ code: 401, message: 'Invalid credentials' })
    expect(err.code).toBe('E1002')
    expect(err.retryable).toBe(false)
  })

  it('UNAUTHENTICATED → E1002', () => {
    const err = mapGmailApiError({ code: 'UNAUTHENTICATED', message: 'Auth failed' })
    expect(err.code).toBe('E1002')
    expect(err.retryable).toBe(false)
  })

  it('403 with "quota" → E2003', () => {
    const err = mapGmailApiError({ code: 403, message: 'Storage quota exceeded' })
    expect(err.code).toBe('E2003')
    expect(err.retryable).toBe(false)
  })

  it('403 with "storage" → E2003', () => {
    const err = mapGmailApiError({ code: 403, message: 'Storage limit reached' })
    expect(err.code).toBe('E2003')
    expect(err.retryable).toBe(false)
  })

  it('403 with "account disabled" → E3002', () => {
    const err = mapGmailApiError({ code: 403, message: 'Account disabled by admin' })
    expect(err.code).toBe('E3002')
    expect(err.retryable).toBe(false)
  })

  it('403 with "account suspended" → E3002', () => {
    const err = mapGmailApiError({ code: 403, message: 'Account has been suspended' })
    expect(err.code).toBe('E3002')
    expect(err.retryable).toBe(false)
  })

  it('403 with "forbidden" → E3002', () => {
    const err = mapGmailApiError({ code: 403, message: 'Forbidden access' })
    expect(err.code).toBe('E3002')
    expect(err.retryable).toBe(false)
  })

  it('403 generic → E4003', () => {
    const err = mapGmailApiError({ code: 403, message: 'Access denied to resource' })
    expect(err.code).toBe('E4003')
    expect(err.retryable).toBe(false)
  })

  it('PERMISSION_DENIED → E4003', () => {
    const err = mapGmailApiError({ code: 'PERMISSION_DENIED', message: 'Insufficient permissions' })
    expect(err.code).toBe('E4003')
    expect(err.retryable).toBe(false)
  })

  it('404 → E2001', () => {
    const err = mapGmailApiError({ code: 404, message: 'Message not found' })
    expect(err.code).toBe('E2001')
    expect(err.retryable).toBe(false)
  })

  it('NOT_FOUND → E2001', () => {
    const err = mapGmailApiError({ code: 'NOT_FOUND', message: 'Resource not found' })
    expect(err.code).toBe('E2001')
    expect(err.retryable).toBe(false)
  })

  it('400 → E4001', () => {
    const err = mapGmailApiError({ code: 400, message: 'Invalid request' })
    expect(err.code).toBe('E4001')
    expect(err.retryable).toBe(false)
  })

  it('INVALID_ARGUMENT → E4001', () => {
    const err = mapGmailApiError({ code: 'INVALID_ARGUMENT', message: 'Bad argument' })
    expect(err.code).toBe('E4001')
    expect(err.retryable).toBe(false)
  })

  it('429 → E3001 (retryable with retryAfter)', () => {
    const err = mapGmailApiError({ code: 429, message: 'Rate limit exceeded', headers: { 'retry-after': '60' } })
    expect(err.code).toBe('E3001')
    expect(err.retryable).toBe(true)
    expect(err.retryAfter).toBe(60)
  })

  it('429 without retry-after header defaults to 30s', () => {
    const err = mapGmailApiError({ code: 429, message: 'Rate limit exceeded' })
    expect(err.code).toBe('E3001')
    expect(err.retryAfter).toBe(30)
  })

  it('RESOURCE_EXHAUSTED → E3001', () => {
    const err = mapGmailApiError({ code: 'RESOURCE_EXHAUSTED', message: 'Too many requests' })
    expect(err.code).toBe('E3001')
    expect(err.retryable).toBe(true)
  })

  it('429 with "quota" → E2003', () => {
    const err = mapGmailApiError({ code: 429, message: 'Quota limit exceeded for today' })
    expect(err.code).toBe('E2003')
    expect(err.retryable).toBe(false)
  })

  it('429 with "sending limit exceeded" → E2003', () => {
    const err = mapGmailApiError({ code: 429, message: 'Daily sending limit exceeded' })
    expect(err.code).toBe('E2003')
    expect(err.retryable).toBe(false)
  })

  it('500 → E1001 (retryable)', () => {
    const err = mapGmailApiError({ code: 500, message: 'Internal server error' })
    expect(err.code).toBe('E1001')
    expect(err.retryable).toBe(true)
    expect(err.retryAfter).toBe(5)
  })

  it('502 → E1001 (retryable)', () => {
    const err = mapGmailApiError({ code: 502, message: 'Bad gateway' })
    expect(err.code).toBe('E1001')
    expect(err.retryable).toBe(true)
  })

  it('503 → E1001 (retryable)', () => {
    const err = mapGmailApiError({ code: 503, message: 'Service unavailable' })
    expect(err.code).toBe('E1001')
    expect(err.retryable).toBe(true)
  })

  it('unknown code → E2001 (not retryable)', () => {
    const err = mapGmailApiError({ code: 418, message: 'I am a teapot' })
    expect(err.code).toBe('E2001')
    expect(err.retryable).toBe(false)
  })

  it('returns MailErrorClass instance with providerCode', () => {
    const err = mapGmailApiError({ code: 401, message: 'Auth failed' })
    expect(err.providerCode).toBe('401')
    expect(err).toBeInstanceOf(Error)
  })
})

// ── GmailApiProvider 构造与能力声明 ──

describe('GmailApiProvider', () => {
  it('应该能创建实例', () => {
    const provider = new GmailApiProvider()
    expect(provider).toBeDefined()
  })

  it('capabilities() 返回 Gmail 特征', () => {
    const provider = new GmailApiProvider()
    const caps = provider.capabilities()
    expect(caps.threadNative).toBe(true) // Gmail 原生线程
    expect(caps.imapIdle).toBe(false) // 不走 IMAP
    expect(caps.realtimePush).toBe(false) // 暂未实现 push
    expect(caps.maxAttachmentSize).toBe(35 * 1024 * 1024) // Gmail 35MB
    expect(caps.sendRateLimit).toBe(30)
  })

  it('未连接时 send 返回 E1001', async () => {
    const provider = new GmailApiProvider()
    const result = await provider.send({
      to: [{ name: '', address: 'test@test.com' }],
      subject: 'Test',
      body: { text: 'Hello' },
    })
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('E1001')
  })

  it('未连接时 fetch 抛出错误', async () => {
    const provider = new GmailApiProvider()
    await expect(provider.fetch({})).rejects.toThrow('Gmail API not connected')
  })

  it('未连接时 read 抛出错误', async () => {
    const provider = new GmailApiProvider()
    await expect(provider.read('msg_123')).rejects.toThrow('Gmail API not connected')
  })

  it('未连接时 search 抛出错误', async () => {
    const provider = new GmailApiProvider()
    await expect(provider.search({ query: 'test' })).rejects.toThrow('Gmail API not connected')
  })

  it('未连接时 trash 抛出错误', async () => {
    const provider = new GmailApiProvider()
    await expect(provider.trash('msg_123')).rejects.toThrow('Gmail API not connected')
  })

  it('未连接时 getThread 抛出错误', async () => {
    const provider = new GmailApiProvider()
    await expect(provider.getThread('thread_123')).rejects.toThrow('Gmail API not connected')
  })

  it('未连接时 reply 返回 E1001', async () => {
    const provider = new GmailApiProvider()
    const result = await provider.reply('msg_123', 'reply body')
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('E1001')
  })

  it('未连接时 forward 返回 E1001', async () => {
    const provider = new GmailApiProvider()
    const result = await provider.forward('msg_123', [{ name: '', address: 'a@b.com' }])
    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('E1001')
  })

  it('未连接时 fetchAttachment 抛出错误', async () => {
    const provider = new GmailApiProvider()
    await expect(provider.fetchAttachment('msg_123', 'file.pdf')).rejects.toThrow('Gmail API not connected')
  })

  it('未连接时 healthCheck 返回 connected=false', async () => {
    const provider = new GmailApiProvider()
    const status = await provider.healthCheck()
    expect(status.connected).toBe(false)
  })
})
