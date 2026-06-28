/**
 * Gmail API error mapping — map HTTP/Google API errors to unified MailError
 *
 * Gmail API error characteristics:
 * - err.code: HTTP status code (number) or Node.js error code (string like 'ECONNECTION')
 * - err.status: Google API status string (e.g. 'UNAUTHENTICATED', 'PERMISSION_DENIED')
 * - err.message: Human-readable error description
 * - err.headers: HTTP response headers (may include 'retry-after')
 */

import { MailErrorClass } from '@mail-agent/core'
import type { MailError } from '@mail-agent/core'

/**
 * Map Gmail API / HTTP errors to unified MailError
 */
export function mapGmailApiError(err: any): MailError {
  const code = err.code || err.status
  const message = err.message || String(err)

  // Connection errors (retryable)
  if (code === 'ECONNECTION' || code === 'ETIMEDOUT' || code === 'ECONNRESET') {
    return new MailErrorClass({
      code: 'E1001',
      providerCode: String(code),
      message: `Gmail API connection failed: ${message}`,
      retryable: true,
      retryAfter: 5,
    })
  }

  // Authentication errors
  if (code === 401 || code === 'UNAUTHENTICATED') {
    return new MailErrorClass({
      code: 'E1002',
      providerCode: String(code),
      message: `Gmail API authentication failed: ${message}`,
      retryable: false,
    })
  }

  // 403 Forbidden — distinguish between quota, account disabled, and permission denied
  if (code === 403 || code === 'PERMISSION_DENIED') {
    const msg = message.toLowerCase()
    // Quota exceeded (E2003) — highest priority within 403
    if (msg.includes('quota') || msg.includes('storage') || msg.includes('storage quota')) {
      return new MailErrorClass({
        code: 'E2003',
        providerCode: String(code),
        message: `Gmail quota exceeded: ${message}`,
        retryable: false,
      })
    }
    // Account disabled/suspended (E3002)
    if (
      msg.includes('account disabled') ||
      msg.includes('account suspended') ||
      msg.includes('account has been disabled') ||
      msg.includes('account has been suspended') ||
      msg.includes('forbidden')
    ) {
      return new MailErrorClass({
        code: 'E3002',
        providerCode: String(code),
        message: `Gmail account disabled: ${message}`,
        retryable: false,
      })
    }
    // Default 403 = permission denied for specific resource (E4003)
    return new MailErrorClass({
      code: 'E4003',
      providerCode: String(code),
      message: `Gmail API permission denied: ${message}`,
      retryable: false,
    })
  }

  // Not found
  if (code === 404 || code === 'NOT_FOUND') {
    return new MailErrorClass({
      code: 'E2001',
      providerCode: String(code),
      message: `Gmail API resource not found: ${message}`,
      retryable: false,
    })
  }

  // Bad request
  if (code === 400 || code === 'INVALID_ARGUMENT') {
    return new MailErrorClass({
      code: 'E4001',
      providerCode: String(code),
      message: `Gmail API bad request: ${message}`,
      retryable: false,
    })
  }

  // Rate limit / quota (429)
  if (code === 429 || code === 'RESOURCE_EXHAUSTED') {
    const msg = message.toLowerCase()
    // Sending quota exceeded (E2003) — not just rate limiting
    if (msg.includes('quota') || msg.includes('quota exceeded') || msg.includes('sending limit exceeded')) {
      return new MailErrorClass({
        code: 'E2003',
        providerCode: String(code),
        message: `Gmail API quota exceeded: ${message}`,
        retryable: false,
      })
    }
    // Regular rate limit (E3001, retryable)
    const retryAfter = err.headers?.['retry-after'] ? parseInt(err.headers['retry-after'], 10) : 30
    return new MailErrorClass({
      code: 'E3001',
      providerCode: String(code),
      message: `Gmail API rate limited: ${message}`,
      retryable: true,
      retryAfter,
    })
  }

  // Server errors (retryable)
  if (code === 500 || code === 502 || code === 503) {
    return new MailErrorClass({
      code: 'E1001',
      providerCode: String(code),
      message: `Gmail API server error: ${message}`,
      retryable: true,
      retryAfter: 5,
    })
  }

  // Default: generic not found
  return new MailErrorClass({
    code: 'E2001',
    providerCode: String(code || 'unknown'),
    message,
    retryable: false,
  })
}
