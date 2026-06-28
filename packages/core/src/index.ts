// 统一数据模型
export type {
  Mail,
  MailAddress,
  MailBody,
  MailThread,
  Attachment,
  AttachmentContent,
  OutboundMail,
  SendResult,
  FetchCriteria,
  SearchCriteria,
  HealthStatus,
  ConnectionDiagnostics,
  ProtocolDiagnostic,
  OAuth2Diagnostic,
  MailError,
  CliResult,
} from './model.js'

// MailError 类（支持 instanceof 判断）
export { MailErrorClass } from './model.js'

// 错误码常量与文档
export {
  E1001_CONNECTION_FAILED,
  E1002_AUTH_FAILED,
  E1003_TLS_ERROR,
  E2001_NOT_FOUND,
  E2002_MAILBOX_NOT_FOUND,
  E2003_OVER_QUOTA,
  E3001_RATE_LIMITED,
  E3002_ACCOUNT_DISABLED,
  E4001_BAD_REQUEST,
  E4002_ATTACHMENT_TOO_LARGE,
  E4003_FORBIDDEN,
  E5001_CLI_EXEC_FAILED,
  E5002_CLI_ME_FAILED,
  E0008_CONFIRMATION_REQUIRED,
  ERROR_CODES,
} from './model.js'

// 适配器接口
export type {
  MailProvider,
  ProviderCapabilities,
  AccountConfig,
  OAuth2Credentials,
  MailProviderTemplate,
  AuthType,
  ReplyOptions,
  ForwardOptions,
} from './provider.js'

export {
  PROVIDER_TEMPLATES,
  resolveSmtpConfig,
  resolveImapConfig,
  isOAuth2Account,
  getAuthLabel,
  DEFAULT_FETCH_LIMIT,
} from './provider.js'

export type { ProviderType } from './provider.js'

// 地址格式化
export { formatMailAddress } from './format.js'

// OAuth2 共享常量与工具
export {
  TOKEN_ENDPOINTS,
  TOKEN_EXPIRY_BUFFER_MS,
  DEFAULT_TOKEN_EXPIRY_SECONDS,
  isTokenExpired,
  refreshAccessToken,
} from './oauth2.js'
