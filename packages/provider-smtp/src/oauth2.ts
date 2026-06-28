/**
 * OAuth2 Token 刷新工具 — 重导出 @mail-agent/core 的共享实现
 *
 * imapflow 不支持自动刷新 token，需要在连接前手动刷新 accessToken
 * nodemailer 支持 OAuth2 自动刷新，但 IMAP 不行
 *
 * 此模块仅做 re-export，核心实现在 @mail-agent/core/oauth2.ts
 */

export { isTokenExpired, refreshAccessToken } from '@mail-agent/core'
