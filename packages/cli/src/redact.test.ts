import { describe, it, expect } from 'vitest'
import { redactUrl, redactError, redactCredential } from '../src/redact.js'

describe('redact — 日志脱敏', () => {
  describe('redactUrl', () => {
    it('脱敏 URL 中的 client_id', () => {
      const url = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=123456.apps.googleusercontent.com&scope=email'
      const redacted = redactUrl(url)
      expect(redacted).toContain('client_id=***')
      expect(redacted).not.toContain('123456')
    })

    it('脱敏 login_hint 参数', () => {
      const url = 'https://accounts.google.com/auth?login_hint=user@gmail.com'
      const redacted = redactUrl(url)
      expect(redacted).toContain('login_hint=***')
    })

    it('非 URL 字符串用正则脱敏', () => {
      const text = 'client_id=abc123&client_secret=xyz789'
      const redacted = redactUrl(text)
      expect(redacted).toContain('client_id=***')
      expect(redacted).toContain('client_secret=***')
    })
  })

  describe('redactCredential', () => {
    it('脱敏 pass 字段', () => {
      const result = redactCredential({ id: 'acc_0', pass: 'mypassword123' })
      expect(result.pass).toBe('***')
      expect(result.id).toBe('acc_0')
    })

    it('脱敏 apiKey 字段', () => {
      const result = redactCredential({ id: 'acc_0', apiKey: 'sk-xxx' })
      expect(result.apiKey).toBe('***')
    })

    it('脱敏 oauth2 敏感字段', () => {
      const result = redactCredential({
        id: 'acc_0',
        oauth2: {
          clientId: 'visible',
          clientSecret: 'secret123',
          refreshToken: 'rt-abc',
          accessToken: 'at-xyz',
          expires: 12345,
        },
      })
      expect(result.oauth2.clientId).toBe('visible')
      expect(result.oauth2.clientSecret).toBe('***')
      expect(result.oauth2.refreshToken).toBe('***')
      expect(result.oauth2.accessToken).toBe('***')
      expect(result.oauth2.expires).toBe(12345)
    })

    it('不含敏感字段的对象不变', () => {
      const obj = { id: 'acc_0', alias: 'test' }
      expect(redactCredential(obj)).toEqual(obj)
    })

    it('null 和 undefined 不崩溃', () => {
      expect(redactCredential(null)).toBe(null)
      expect(redactCredential(undefined)).toBe(undefined)
    })
  })

  describe('redactError', () => {
    it('保留错误中的邮箱地址（不脱敏）', () => {
      const msg = 'Authentication failed for user@company.com'
      expect(redactError(msg)).toBe('Authentication failed for user@company.com')
    })

    it('截断过长的错误消息', () => {
      const msg = 'A'.repeat(600)
      const redacted = redactError(msg)
      expect(redacted.length).toBeLessThan(300)
      expect(redacted).toContain('truncated')
    })

    it('脱敏 token 字段值', () => {
      const msg = 'refresh_token=ya29.a0AfH6SMBxxx'
      const redacted = redactError(msg)
      expect(redacted).not.toContain('ya29')
      expect(redacted).toContain('***')
    })
  })
})
