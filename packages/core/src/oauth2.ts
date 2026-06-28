/**
 * OAuth2 共享常量与工具函数
 *
 * 供 provider-smtp、provider-gmail-api、cli 共用，
 * 避免 TOKEN_ENDPOINTS / isTokenExpired 等在三处重复定义。
 */

import type { OAuth2Credentials } from './provider.js'

// ── 常量 ──

/** OAuth2 提供商的 token 端点 */
export const TOKEN_ENDPOINTS: Record<string, string> = {
  gmail: 'https://oauth2.googleapis.com/token',
  outlook: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
}

/** accessToken 过期缓冲（5 分钟内视为即将过期） */
export const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000

/** 默认 token 有效期（秒），当响应不含 expires_in 时使用 */
export const DEFAULT_TOKEN_EXPIRY_SECONDS = 3600

// ── 工具函数 ──

/**
 * 检查 accessToken 是否即将过期（5 分钟内），需要刷新
 */
export function isTokenExpired(oauth2: OAuth2Credentials): boolean {
  if (!oauth2.expires) return true
  return Date.now() > oauth2.expires - TOKEN_EXPIRY_BUFFER_MS
}

/**
 * 用 refreshToken 刷新 accessToken
 *
 * 供 IMAP 连接前调用（imapflow 不支持自动刷新），
 * 以及 Gmail API 手动刷新（同步更新本地存储的凭据）。
 */
export async function refreshAccessToken(oauth2: OAuth2Credentials, provider: string): Promise<OAuth2Credentials> {
  const tokenUrl = TOKEN_ENDPOINTS[provider]
  if (!tokenUrl) {
    throw new Error(`不支持的 OAuth2 邮箱类型: ${provider}，无法刷新 token`)
  }

  const body = new URLSearchParams({
    refresh_token: oauth2.refreshToken,
    client_id: oauth2.clientId,
    client_secret: oauth2.clientSecret,
    grant_type: 'refresh_token',
  })

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!response.ok) {
    const errorText = await response.text()
    // 脱敏：不暴露完整原始响应体（可能含 client_id / redirect_uri 等敏感信息）
    const safeError = errorText.length > 200 ? errorText.slice(0, 200) + '...' : errorText
    let hint = ''
    try {
      const errJson = JSON.parse(errorText)
      if (errJson.error === 'invalid_grant') {
        hint = '\n\n💡 refreshToken 已失效，请重新运行 ma account add 授权。'
      }
    } catch {}
    throw new Error(`OAuth2 token 刷新失败 (${response.status}): ${safeError}${hint}`)
  }

  const data = (await response.json()) as any

  return {
    ...oauth2,
    accessToken: data.access_token,
    expires: Date.now() + (data.expires_in || DEFAULT_TOKEN_EXPIRY_SECONDS) * 1000,
  }
}
