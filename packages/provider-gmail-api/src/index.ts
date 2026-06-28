export { GmailApiProvider } from './provider.js'
export { createAuthenticatedClient, createGmailClient, ensureFreshToken, isTokenExpired } from './api.js'
// refreshAccessToken 从 @mail-agent/core re-export（Gmail 固定传 provider='gmail'）
export { refreshAccessToken } from '@mail-agent/core'
export {
  gmailMessageToMail,
  gmailThreadToMailThread,
  encodeRawEmail,
  decodeBase64Url,
  stripHtml,
  decodeMimeHeader,
} from './convert.js'
export type { GmailMessage, GmailMessagePart, GmailThread } from './convert.js'
export { mapGmailApiError } from './errors.js'
