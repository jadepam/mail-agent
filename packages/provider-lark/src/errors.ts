/**
 * Lark API error → Mail Agent MailError mapping
 *
 * Maps Lark Open Platform API error codes and lark-cli exit codes
 * to the unified E1xxx-E5xxx error system.
 */

import type { MailError } from '@mail-agent/core'
import { MailErrorClass } from '@mail-agent/core'

/**
 * Lark OAPI error code → Mail Agent error code mapping
 *
 * Common Lark OAPI error codes:
 * - 40014: Invalid access_token
 * - 40015: Token expired
 * - 99991672: Rate limit
 * - 99991668: Permission denied
 * - 99991663: Resource not found
 * - 99991400: Bad request
 * - 99991401: Unauthorized
 * - 99991403: Forbidden
 */
const LARK_API_CODE_MAP: Record<string, string> = {
  '40014': 'E1002', // Invalid access token
  '40015': 'E1002', // Token expired
  '99991401': 'E1002', // Unauthorized
  '99991672': 'E3001', // Rate limit
  '99991668': 'E4003', // Permission denied
  '99991663': 'E2001', // Resource not found
  '99991400': 'E4001', // Bad request
  '99991403': 'E4003', // Forbidden
}

/**
 * lark-cli exit code → Mail Agent error code mapping
 */
const LARK_EXIT_CODE_MAP: Record<number, string> = {
  1: 'E1001', // Connection/network error
  2: 'E4001', // Parameter error
  3: 'E1002', // Authorization expired
  6: 'E2001', // Business permanent rejection
  7: 'E3001', // Rate limit triggered
  10: 'E4003', // Confirmation gate (high-risk write without --yes)
}

/**
 * Exit codes that are retryable
 */
const RETRYABLE_EXIT_CODES = new Set([1, 7])

/**
 * Map a Lark OAPI error code to MailError
 */
export function mapLarkApiError(code: string | number, message: string): MailError {
  const codeStr = String(code)
  const mappedCode = LARK_API_CODE_MAP[codeStr] || 'E5001'
  const retryable = codeStr === '99991672' // Rate limit is retryable

  return new MailErrorClass({
    code: mappedCode,
    providerCode: codeStr,
    message,
    retryable,
  })
}

/**
 * Map a lark-cli exit code to MailError
 */
export function mapLarkExitCode(exitCode: number, message: string): MailError {
  const mappedCode = LARK_EXIT_CODE_MAP[exitCode] || 'E5001'
  const retryable = RETRYABLE_EXIT_CODES.has(exitCode)

  return new MailErrorClass({
    code: mappedCode,
    providerCode: String(exitCode),
    message,
    retryable,
  })
}

/**
 * Map a lark-cli error result to MailError
 * Tries API error code first, falls back to exit code mapping
 */
export function mapLarkCliError(error: { code: string; message: string }, defaultCode: string): MailError {
  const codeStr = error.code

  // Try Lark API error code mapping first
  if (LARK_API_CODE_MAP[codeStr]) {
    return new MailErrorClass({
      code: LARK_API_CODE_MAP[codeStr],
      providerCode: codeStr,
      message: error.message,
      retryable: codeStr === '99991672',
    })
  }

  // Try exit code mapping
  const exitCode = Number(codeStr)
  if (!isNaN(exitCode) && LARK_EXIT_CODE_MAP[exitCode]) {
    return new MailErrorClass({
      code: LARK_EXIT_CODE_MAP[exitCode],
      providerCode: codeStr,
      message: error.message,
      retryable: RETRYABLE_EXIT_CODES.has(exitCode),
    })
  }

  // Fallback to default code
  return new MailErrorClass({
    code: defaultCode,
    providerCode: codeStr,
    message: error.message,
    retryable: false,
  })
}
