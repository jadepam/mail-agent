/**
 * Gmail API wrapper — based on @googleapis/gmail
 *
 * Send and receive emails via Gmail REST API using HTTPS,
 * solving the problem of SMTP/IMAP ports being blocked by proxies in regions with restricted internet.
 */

import { gmail, auth, type gmail_v1 } from '@googleapis/gmail'
import type { OAuth2Credentials } from '@mail-agent/core'
import { isTokenExpired, refreshAccessToken } from '@mail-agent/core'

// Re-export isTokenExpired for use by provider.ts etc.
export { isTokenExpired }

/**
 * Ensure accessToken is valid; automatically refresh if expired
 */
export async function ensureFreshToken(oauth2: OAuth2Credentials): Promise<OAuth2Credentials> {
  if (!isTokenExpired(oauth2) && oauth2.accessToken) {
    return oauth2
  }
  return await refreshAccessToken(oauth2, 'gmail')
}

// ── Gmail API Client ──

/**
 * Create an authenticated Gmail API client
 *
 * Uses the built-in OAuth2 client from @googleapis/gmail.
 * After setting credentials, it automatically adds the Authorization header to requests,
 * and supports automatic token refresh.
 */
export function createGmailClient(oauth2: OAuth2Credentials): gmail_v1.Gmail {
  // 创建 OAuth2 客户端
  const oauth2Client = new auth.OAuth2(oauth2.clientId, oauth2.clientSecret)

  // 设置凭据（accessToken + refreshToken）
  oauth2Client.setCredentials({
    access_token: oauth2.accessToken,
    refresh_token: oauth2.refreshToken,
    expiry_date: oauth2.expires,
  })

  // 创建 Gmail 客户端
  return gmail({ version: 'v1', auth: oauth2Client })
}

/**
 * 创建带 OAuth2 自动刷新的 Gmail API 客户端
 *
 * 先检查 token 是否过期，过期则手动刷新（更新 credentials.yaml），
 * 然后创建客户端。@googleapis/gmail 的 OAuth2 客户端也内置了
 * 自动刷新能力，但手动刷新可以让我们同步更新本地存储的凭据。
 */
export async function createAuthenticatedClient(oauth2: OAuth2Credentials): Promise<{
  client: gmail_v1.Gmail
  oauth2: OAuth2Credentials
}> {
  const fresh = await ensureFreshToken(oauth2)
  const client = createGmailClient(fresh)
  return { client, oauth2: fresh }
}
