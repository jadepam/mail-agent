/**
 * 日志脱敏工具 — 防止敏感信息泄露到控制台和 MCP 响应
 *
 * 脱敏规则：
 * - URL 中的 client_id / client_secret：脱敏为 ***
 * - 错误消息中的 token / secret 片段：截断
 * - 凭证对象中的密码、token：脱敏为 ***
 *
 * 注意：邮箱地址不脱敏。邮件地址是通信标识而非凭证，
 * 脱敏后用户无法确认发件人/收件人，也无法构造回复/转发命令。
 */

/**
 * 脱敏 URL 中的敏感查询参数
 *
 * 移除或替换 client_id, client_secret, login_hint, refresh_token 等参数
 */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const sensitiveParams = ['client_id', 'client_secret', 'login_hint', 'refresh_token', 'access_token', 'code']
    for (const param of sensitiveParams) {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, '***')
      }
    }
    return parsed.toString()
  } catch {
    // Not a valid URL, redact with regex
    return url
      .replace(/client_id=[^&\s]+/g, 'client_id=***')
      .replace(/client_secret=[^&\s]+/g, 'client_secret=***')
      .replace(/login_hint=[^&\s]+/g, 'login_hint=***')
      .replace(/refresh_token=[^&\s]+/g, 'refresh_token=***')
      .replace(/access_token=[^&\s]+/g, 'access_token=***')
  }
}

/**
 * 脱敏凭证对象 — 防止密码、token 意外打印到终端
 *
 * pass → ***
 * apiKey → ***
 * oauth2.accessToken → ***
 * oauth2.refreshToken → ***
 * oauth2.clientSecret → ***
 */
export function redactCredential(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj

  const result: any = Array.isArray(obj) ? [...obj] : { ...obj }

  const sensitiveKeys = ['pass', 'apiKey', 'api_key']
  for (const key of sensitiveKeys) {
    if (result[key]) result[key] = '***'
  }

  if (result.oauth2 && typeof result.oauth2 === 'object') {
    result.oauth2 = { ...result.oauth2 }
    if (result.oauth2.accessToken || result.oauth2.access_token) {
      result.oauth2.accessToken = '***'
      result.oauth2.access_token = '***'
    }
    if (result.oauth2.refreshToken || result.oauth2.refresh_token) {
      result.oauth2.refreshToken = '***'
      result.oauth2.refresh_token = '***'
    }
    if (result.oauth2.clientSecret || result.oauth2.client_secret) {
      result.oauth2.clientSecret = '***'
      result.oauth2.client_secret = '***'
    }
  }

  return result
}

/**
 * 脱敏错误消息
 *
 * 1. 截断过长的原始响应体（>200 字符）
 * 2. 脱敏 token / secret 片段
 */
export function redactError(message: string): string {
  let result = message

  // 脱敏 token 类字段值
  result = result.replace(/"(?:access_token|refresh_token|client_secret|password|pass)"\s*:\s*"[^"]+"/g, '"$1":"***"')
  result = result.replace(/(?:access_token|refresh_token|client_secret|password|pass)[=:]\s*\S+/g, '$1=***')

  // 截断过长的原始响应（可能是 HTTP 响应体）
  if (result.length > 500) {
    result = result.slice(0, 200) + '...(truncated)'
  }

  return result
}
