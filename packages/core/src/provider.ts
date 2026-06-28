import type {
  Mail,
  MailAddress,
  MailThread,
  OutboundMail,
  SendResult,
  FetchCriteria,
  SearchCriteria,
  HealthStatus,
  AttachmentContent,
} from './model.js'

/** Provider capabilities declaration */
export interface ProviderCapabilities {
  realtimePush: boolean
  imapIdle: boolean
  threadNative: boolean
  aiParsing: boolean
  attachmentOcr: boolean
  maxAttachmentSize: number
  sendRateLimit: number
}

/** OAuth2 credentials */
export interface OAuth2Credentials {
  clientId: string
  clientSecret: string
  refreshToken: string
  accessToken?: string // Auto-refreshed, no need to fill manually
  expires?: number // accessToken expiry time (epoch ms), auto-updated
}

/** Email account authentication type */
export type AuthType = 'password' | 'oauth2' | 'cli' | 'apikey'

/** Default fetch limit */
export const DEFAULT_FETCH_LIMIT = 20

/**
 * Email provider template — built-in host/port/secure/tls for common providers
 * Users only need to fill in user + credentials (pass or oauth2), no manual server address needed
 */
export interface MailProviderTemplate {
  smtp: { host: string; port: number; secure: boolean }
  imap: { host: string; port: number; tls: boolean }
  authType: AuthType
}

/** Built-in provider templates */
export const PROVIDER_TEMPLATES: Record<string, MailProviderTemplate> = {
  gmail: {
    smtp: { host: '', port: 0, secure: true }, // 不走 SMTP，走 Gmail REST API
    imap: { host: '', port: 0, tls: true }, // 不走 IMAP，走 Gmail REST API
    authType: 'oauth2',
  },
  outlook: {
    smtp: { host: 'smtp-mail.outlook.com', port: 587, secure: false },
    imap: { host: 'outlook.office365.com', port: 993, tls: true },
    authType: 'oauth2',
  },
  qq: {
    smtp: { host: 'smtp.qq.com', port: 465, secure: true },
    imap: { host: 'imap.qq.com', port: 993, tls: true },
    authType: 'password',
  },
  '163': {
    smtp: { host: 'smtp.163.com', port: 465, secure: true },
    imap: { host: 'imap.163.com', port: 993, tls: true },
    authType: 'password',
  },
  agently: {
    smtp: { host: '', port: 0, secure: true }, // 不走 SMTP，占位
    imap: { host: '', port: 0, tls: true }, // 不走 IMAP，占位
    authType: 'cli', // CLI 代理认证，凭证由 agently-cli 自管
  },
  lark: {
    smtp: { host: '', port: 0, secure: true }, // 不走 SMTP，走 lark-cli
    imap: { host: '', port: 0, tls: true }, // 不走 IMAP，走 lark-cli
    authType: 'cli', // CLI 代理认证，凭证由 lark-cli 自管
  },
}

export type ProviderType = keyof typeof PROVIDER_TEMPLATES | 'smtp-imap'

/** 账号配置 */
export interface AccountConfig {
  id: string
  alias: string
  purpose: string
  isDefault: boolean
  provider: ProviderType
  network: 'public' | 'private'
  user: string // 邮箱地址（账号级别，不再重复写在 smtp/imap 里）
  pass?: string // 密码/授权码（账号级别，QQ/163/企业邮箱用）
  oauth2?: OAuth2Credentials // OAuth2 凭据（Gmail/Outlook 用）
  apiKey?: string // API Key 凭据（API-first 平台用，存 credentials.yaml）
  inboxId?: string // 默认收件箱 ID（多收件箱平台用）
  /** 自定义 SMTP/IMAP 服务器配置（仅 smtp-imap / 私有化邮箱需手动填写） */
  smtp?: {
    host?: string // 模板自动填充，私有化邮箱需手动填
    port?: number
    secure?: boolean
    rejectUnauthorized?: boolean
  }
  imap?: {
    host?: string
    port?: number
    tls?: boolean
    rejectUnauthorized?: boolean
  }
}

/**
 * 将 AccountConfig 展开为完整的 SMTP 连接参数
 * 模板自动填充 host/port/secure，私有化邮箱使用手动填写的值
 */
export function resolveSmtpConfig(config: AccountConfig): {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
  rejectUnauthorized?: boolean
} {
  const template = PROVIDER_TEMPLATES[config.provider]
  const defaults = template?.smtp

  return {
    host: config.smtp?.host || defaults?.host || '',
    port: config.smtp?.port || defaults?.port || 465,
    secure: config.smtp?.secure ?? defaults?.secure ?? true,
    user: config.user,
    pass: config.pass || '',
    rejectUnauthorized: config.smtp?.rejectUnauthorized,
  }
}

/**
 * 将 AccountConfig 展开为完整的 IMAP 连接参数
 * 模板自动填充 host/port/tls，私有化邮箱使用手动填写的值
 */
export function resolveImapConfig(config: AccountConfig): {
  host: string
  port: number
  tls: boolean
  user: string
  pass: string
  rejectUnauthorized?: boolean
} {
  const template = PROVIDER_TEMPLATES[config.provider]
  const defaults = template?.imap

  return {
    host: config.imap?.host || defaults?.host || '',
    port: config.imap?.port || defaults?.port || 993,
    tls: config.imap?.tls ?? defaults?.tls ?? true,
    user: config.user,
    pass: config.pass || '',
    rejectUnauthorized: config.imap?.rejectUnauthorized,
  }
}

/** 判断账号是否使用 OAuth2 认证 */
export function isOAuth2Account(config: AccountConfig): boolean {
  const template = PROVIDER_TEMPLATES[config.provider]
  return template?.authType === 'oauth2' || !!config.oauth2
}

/** 获取账号认证方式标签（用于 CLI/MCP 显示） */
export function getAuthLabel(account: AccountConfig): string {
  if (account.oauth2) return 'oauth2'
  if (account.provider === 'agently') return 'agently-cli'
  if (account.provider === 'lark') return 'lark-cli'
  if (account.apiKey) return 'api-key'
  if (account.pass) return 'password'
  return 'unconfigured'
}

/** 回复选项 */
export interface ReplyOptions {
  replyAll?: boolean // 回复全部
  cc?: MailAddress[] // 追加 CC
  quoteOriginal?: boolean // 是否引用原文（默认 true）
}

/** 转发选项 */
export interface ForwardOptions {
  includeAttachments?: boolean // 是否附带原附件（默认 false）
  body?: string // 转发说明
}

/** 邮件适配器抽象接口 — 所有适配器必须实现 */
export interface MailProvider {
  /** 连接 */
  connect(config: AccountConfig): Promise<void>

  /** 断开 */
  disconnect(): Promise<void>

  /** 健康检查 */
  healthCheck(): Promise<HealthStatus>

  /** 发送邮件（L0） */
  send(mail: OutboundMail): Promise<SendResult>

  /** 拉取邮件列表（L0） */
  fetch(criteria: FetchCriteria): Promise<Mail[]>

  /** 读取单封邮件详情（L0） */
  read(mailId: string): Promise<Mail>

  /** 搜索邮件（L0） */
  search(criteria: SearchCriteria): Promise<Mail[]>

  /** 获取会话（L1） */
  getThread(threadId: string): Promise<MailThread>

  /** 删除邮件 — 移入回收站（L0） */
  trash(mailId: string): Promise<void>

  /** 回复邮件（L0） */
  reply(mailId: string, body: string, options?: ReplyOptions): Promise<SendResult>

  /** 转发邮件（L0） */
  forward(mailId: string, to: MailAddress[], options?: ForwardOptions): Promise<SendResult>

  /** 下载附件（L0） */
  fetchAttachment(mailId: string, filename: string): Promise<AttachmentContent>

  /** 能力声明 */
  capabilities(): ProviderCapabilities
}
