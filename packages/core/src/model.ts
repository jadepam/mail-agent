/** Email address */
export interface MailAddress {
  name: string
  address: string
}

/** Email body */
export interface MailBody {
  text: string
  html?: string
}

/** Attachment */
export interface Attachment {
  filename: string
  contentType: string
  size: number
  contentId?: string
  downloadUrl?: string
}

/** Attachment content (returned when downloading) */
export interface AttachmentContent {
  filename: string
  contentType: string
  size: number
  content: Buffer
}

/** Email message */
export interface Mail {
  id: string
  providerId: string
  accountId: string
  accountAlias: string
  threadId?: string
  from: MailAddress
  to: MailAddress[]
  cc: MailAddress[]
  bcc: MailAddress[]
  subject: string
  body: MailBody
  attachments: Attachment[]
  labels: string[]
  date: Date
  read: boolean
  starred: boolean
}

/** Email thread */
export interface MailThread {
  id: string
  mails: Mail[]
  subject: string
  participants: MailAddress[]
  lastMail?: Mail
  mailCount: number
}

/** Send email parameters */
export interface OutboundMail {
  to: MailAddress[]
  subject: string
  body: MailBody
  cc?: MailAddress[]
  bcc?: MailAddress[]
  attachments?: Attachment[]
  /** Attachment contents (used when forwarding, with Buffer content) */
  attachmentContents?: AttachmentContent[]
  inReplyTo?: string
  accountAlias?: string
}

/** Send result */
export interface SendResult {
  success: boolean
  mailId: string
  providerId?: string
  errorCode?: string
  errorMessage?: string
  confirmToken?: string
  confirmSummary?: string
}

/** Fetch/search criteria */
export interface FetchCriteria {
  folder?: string
  limit?: number
  unread?: boolean
  since?: Date
  before?: Date
  cursor?: string
  accountAlias?: string
}

/** Search criteria */
export interface SearchCriteria extends FetchCriteria {
  query: string
  from?: string
  to?: string
  hasAttachments?: boolean
  accountAlias?: string
}

/** Protocol connection diagnostic */
export interface ProtocolDiagnostic {
  connected: boolean
  host: string
  port: number
  secure: boolean
  authMethod: string
  latencyMs: number
  error?: string
}

/** OAuth2 diagnostic */
export interface OAuth2Diagnostic {
  tokenExpiry?: string
  isExpired: boolean
}

/** Connection diagnostic collection */
export interface ConnectionDiagnostics {
  smtp?: ProtocolDiagnostic
  imap?: ProtocolDiagnostic
  api?: ProtocolDiagnostic
  cli?: ProtocolDiagnostic
  oauth2?: OAuth2Diagnostic
}

/** Health status */
export interface HealthStatus {
  connected: boolean
  accountId: string
  alias: string
  provider: string
  latency?: number
  diagnostics?: ConnectionDiagnostics
}

/** Unified error */
export interface MailError {
  code: string
  providerCode: string
  message: string
  retryable: boolean
  retryAfter?: number
  accountId?: string
}

// ── Error Code Definitions ──

/** Connection errors */
export const E1001_CONNECTION_FAILED = 'E1001'
/** Authentication failure */
export const E1002_AUTH_FAILED = 'E1002'
/** TLS/SSL certificate error */
export const E1003_TLS_ERROR = 'E1003'

/** Generic / not found */
export const E2001_NOT_FOUND = 'E2001'
/** Mailbox not found */
export const E2002_MAILBOX_NOT_FOUND = 'E2002'
/** Over quota */
export const E2003_OVER_QUOTA = 'E2003'

/** Rate limited */
export const E3001_RATE_LIMITED = 'E3001'
/** Account disabled */
export const E3002_ACCOUNT_DISABLED = 'E3002'

/** Bad request */
export const E4001_BAD_REQUEST = 'E4001'
/** Attachment too large */
export const E4002_ATTACHMENT_TOO_LARGE = 'E4002'
/** Permission denied */
export const E4003_FORBIDDEN = 'E4003'

/** Agently CLI execution failed */
export const E5001_CLI_EXEC_FAILED = 'E5001'
/** Agently CLI +me failed */
export const E5002_CLI_ME_FAILED = 'E5002'
/** Confirmation token required */
export const E0008_CONFIRMATION_REQUIRED = 'E0008'

/** All error code mappings (for documentation and validation) */
export const ERROR_CODES: Record<string, { code: string; category: string; description: string }> = {
  E1001: { code: 'E1001', category: 'connection', description: 'Connection failed' },
  E1002: { code: 'E1002', category: 'authentication', description: 'Authentication failed' },
  E1003: { code: 'E1003', category: 'security', description: 'TLS/SSL certificate error' },
  E2001: { code: 'E2001', category: 'not_found', description: 'Generic / not found' },
  E2002: { code: 'E2002', category: 'not_found', description: 'Mailbox not found' },
  E2003: { code: 'E2003', category: 'quota', description: 'Over quota' },
  E3001: { code: 'E3001', category: 'rate_limit', description: 'Rate limited' },
  E3002: { code: 'E3002', category: 'account', description: 'Account disabled' },
  E4001: { code: 'E4001', category: 'bad_request', description: 'Bad request' },
  E4002: { code: 'E4002', category: 'bad_request', description: 'Attachment too large' },
  E4003: { code: 'E4003', category: 'permission', description: 'Permission denied' },
  E5001: { code: 'E5001', category: 'cli', description: 'Agently CLI execution failed' },
  E5002: { code: 'E5002', category: 'cli', description: 'Agently CLI +me failed' },
  E0008: { code: 'E0008', category: 'cli', description: 'Confirmation token required' },
}

/** Unified error class — supports instanceof checks */
export class MailErrorClass extends Error {
  readonly code: string
  readonly providerCode: string
  readonly retryable: boolean
  readonly retryAfter?: number
  readonly accountId?: string

  constructor(opts: {
    code: string
    providerCode: string
    message: string
    retryable: boolean
    retryAfter?: number
    accountId?: string
  }) {
    super(opts.message)
    this.name = 'MailError'
    this.code = opts.code
    this.providerCode = opts.providerCode
    this.retryable = opts.retryable
    this.retryAfter = opts.retryAfter
    this.accountId = opts.accountId
  }
}

/** CLI standard output format */
export interface CliResult<T = unknown> {
  ok: boolean
  data?: T
  error?: string | MailError
}
