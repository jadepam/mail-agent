/**
 * IMAP 错误映射 — 将 imapflow 原始错误映射为统一 MailError
 *
 * imapflow 抛出的错误特征：
 * - err.code: 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET'
 * - err.authenticationFailed: true（认证失败）
 * - err.response: IMAP 服务器返回的响应文本
 * - err.text: 可读错误描述
 */

import type { MailError } from '@mail-agent/core'
import { MailErrorClass } from '@mail-agent/core'

/**
 * 将 IMAP 错误映射为统一 MailError
 */
export function mapImapError(err: any, defaultCode = 'E2001'): MailError {
  const code = err.code || ''
  const message = err.text || err.message || String(err)

  // 连接类错误（可重试）
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') {
    return new MailErrorClass({
      code: 'E1001',
      providerCode: code,
      message: `IMAP 连接失败：${message}`,
      retryable: true,
      retryAfter: 5,
    })
  }

  // 认证失败（不可重试）
  if (err.authenticationFailed || code === 'EAUTH' || message.includes('AUTHENTICATIONFAILED')) {
    return new MailErrorClass({
      code: 'E1002',
      providerCode: code || 'AUTHENTICATIONFAILED',
      message: `IMAP 认证失败：${message}`,
      retryable: false,
    })
  }

  // TLS/SSL 错误
  if (
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'CERT_HAS_EXPIRED' ||
    message.includes('SSL') ||
    message.includes('TLS')
  ) {
    return new MailErrorClass({
      code: 'E1003',
      providerCode: code || 'SSL_ERROR',
      message: `IMAP SSL/TLS 错误：${message}`,
      retryable: false,
    })
  }

  // 邮箱不存在
  if (message.includes('NONEXISTENT') || message.includes("Mailbox doesn't exist") || message.includes(' Mailbox ')) {
    return new MailErrorClass({
      code: 'E2002',
      providerCode: code || 'MAILBOX_NOT_FOUND',
      message: `IMAP 文件夹不存在：${message}`,
      retryable: false,
    })
  }

  // 邮件不存在
  if (message.includes('not found') || message.includes('不存在') || message.includes("doesn't exist")) {
    return new MailErrorClass({
      code: 'E2001',
      providerCode: code || 'MESSAGE_NOT_FOUND',
      message,
      retryable: false,
    })
  }

  // 限额/配额
  if (message.includes('QUOTA') || message.includes('OVERQUOTA')) {
    return new MailErrorClass({
      code: 'E2003',
      providerCode: code || 'OVERQUOTA',
      message: `邮箱配额已满：${message}`,
      retryable: false,
    })
  }

  return new MailErrorClass({
    code: defaultCode,
    providerCode: code || 'unknown',
    message,
    retryable: false,
  })
}

/**
 * 判断错误是否可重试
 */
export function isRetryableError(err: any): boolean {
  if (err && typeof err === 'object') {
    // 已映射为 MailError
    if (err.retryable === true) return true
    // 网络类错误码
    const code = err.code || err.errorCode || ''
    if (['E1001', 'E3001'].includes(code)) return true
    if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNECTION'].includes(code)) return true
  }
  return false
}

/**
 * 带重试的操作封装
 *
 * 对可重试错误自动重试 1 次，不可重试错误立即抛出
 */
export async function withRetry<T>(fn: () => Promise<T>, label = 'operation'): Promise<T> {
  try {
    return await fn()
  } catch (err: any) {
    if (isRetryableError(err)) {
      // 等待 1 秒后重试
      await new Promise((resolve) => setTimeout(resolve, 1000))
      try {
        return await fn()
      } catch (retryErr: any) {
        // 重试也失败，抛出原始错误
        throw retryErr
      }
    }
    throw err
  }
}
