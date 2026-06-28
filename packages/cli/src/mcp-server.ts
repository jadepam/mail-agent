import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { createRequire } from 'module'
import { loadConfig, getAccount } from './config.js'
import { createProvider } from './factory.js'
import { cliResult, parseAddresses, summarizeMail, summarizeMailDetail } from './shared.js'
import { redactError } from './redact.js'
import { ProviderPool } from './pool.js'
import type { MailProvider, MailThread, AccountConfig } from '@mail-agent/core'
import { getAuthLabel, DEFAULT_FETCH_LIMIT } from '@mail-agent/core'

const require = createRequire(import.meta.url)
const { version: pkgVersion } = require('../package.json')

export async function startMcpServer(): Promise<void> {
  const config = loadConfig()
  const pool = new ProviderPool({ maxIdleMs: 5 * 60 * 1000 })
  pool.startCleanup()

  const server = new McpServer({
    name: 'mail-agent',
    version: pkgVersion,
  })

  // ── Tool: list_mails ──
  server.tool(
    'list_mails',
    'List emails in the mailbox. Returns a summary of each email including ID, thread_id, sender, subject, date, read status, etc. (excluding body content).' +
      'Use cases: viewing the inbox, checking unread emails, browsing recent emails.' +
      'To read the full content, first use this tool to get the mail ID, then call read_mail.' +
      'To view the full conversation, call get_thread with the returned thread_id.',
    {
      account_alias: z
        .string()
        .optional()
        .describe(
          'Email alias (if not specified, uses the default account; use list_accounts to see available aliases)',
        ),
      folder: z.string().default('INBOX').describe('Folder name, defaults to INBOX'),
      limit: z.number().default(DEFAULT_FETCH_LIMIT).describe('Number of results to return, defaults to 20'),
      unread_only: z.boolean().optional().describe('Only return unread emails'),
    },
    async (params) => {
      const { result: mails, accountConfig } = await withProvider(
        params.account_alias,
        config,
        pool,
        async (provider) => {
          return provider.fetch({
            folder: params.folder,
            limit: params.limit,
            unread: params.unread_only,
          })
        },
      )
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              cliResult(true, {
                account: accountConfig.alias,
                folder: params.folder,
                count: mails.length,
                mails: mails.map(summarizeMail),
              }),
              null,
              2,
            ),
          },
        ],
      }
    },
  )

  // ── Tool: read_mail ──
  server.tool(
    'read_mail',
    'Read the full content of a specified email, including body, recipients, CC, attachments, etc.' +
      'Use cases: reading email body, viewing attachment info, preparing to reply.' +
      'The mail_id parameter comes from the id field returned by list_mails.',
    {
      mail_id: z.string().describe('Mail ID (from the id field returned by list_mails)'),
      account_alias: z.string().optional().describe('Email alias (if not specified, uses the default account)'),
    },
    async (params) => {
      const { result: mail, accountConfig } = await withProvider(
        params.account_alias,
        config,
        pool,
        async (provider) => {
          return provider.read(params.mail_id)
        },
      )
      const detail = summarizeMailDetail(mail)
      detail.account = accountConfig.alias
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(cliResult(true, detail), null, 2) }],
      }
    },
  )

  // ── Tool: search_mails ──
  server.tool(
    'search_mails',
    'Search emails by keyword. Returns a summary list of matching emails.' +
      'Use cases: finding emails containing specific keywords, finding emails from someone.' +
      'To read the full content of search results, call read_mail with the returned id.',
    {
      query: z.string().describe('Search keyword'),
      folder: z.string().optional().describe('Search in a specific folder, defaults to INBOX'),
      from: z.string().optional().describe('Filter by sender (email address)'),
      unread_only: z.boolean().optional().describe('Only return unread emails'),
      account_alias: z.string().optional().describe('Email alias (if not specified, uses the default account)'),
      limit: z.number().default(DEFAULT_FETCH_LIMIT).describe('Number of results to return, defaults to 20'),
    },
    async (params) => {
      const { result: mails, accountConfig } = await withProvider(
        params.account_alias,
        config,
        pool,
        async (provider) => {
          return provider.search({
            query: params.query,
            folder: params.folder,
            from: params.from,
            unread: params.unread_only,
            limit: params.limit,
          })
        },
      )
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              cliResult(true, {
                query: params.query,
                account: accountConfig.alias,
                count: mails.length,
                mails: mails.map(summarizeMail),
              }),
              null,
              2,
            ),
          },
        ],
      }
    },
  )

  // ── Tool: send_mail ──
  server.tool(
    'send_mail',
    'Send an email. Recipient, subject, and body are required.' +
      'Use cases: sending a new email, replying to an email (subject gets Re: prefix, to is the original sender).',
    {
      to: z.string().describe('Recipient email address, multiple addresses separated by commas'),
      subject: z.string().describe('Email subject'),
      body: z.string().describe('Email body'),
      cc: z.string().optional().describe('CC addresses, multiple separated by commas'),
      bcc: z.string().optional().describe('BCC addresses, multiple separated by commas'),
      account_alias: z.string().optional().describe('Email alias (if not specified, uses the default account)'),
    },
    async (params) => {
      const { result: sendResult, accountConfig } = await withProvider(
        params.account_alias,
        config,
        pool,
        async (provider) => {
          return provider.send({
            to: parseAddresses(params.to),
            subject: params.subject,
            body: { text: params.body },
            cc: params.cc ? parseAddresses(params.cc) : undefined,
            bcc: params.bcc ? parseAddresses(params.bcc) : undefined,
          })
        },
      )
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              cliResult(
                sendResult.success,
                {
                  mailId: sendResult.mailId,
                  account: accountConfig.alias,
                  to: params.to,
                  subject: params.subject,
                },
                sendResult.success ? undefined : sendResult.errorMessage,
              ),
              null,
              2,
            ),
          },
        ],
      }
    },
  )

  // ── Tool: get_thread ──
  server.tool(
    'get_thread',
    'Get the full content of an email thread, including all messages in the conversation.' +
      'Use cases: viewing the complete context of a conversation, understanding email dialogue history.' +
      'The thread_id parameter comes from the thread_id field returned by list_mails or read_mail.' +
      'Gmail and Lark/Feishu use server-native threadId; SMTP/IMAP accounts are merged based on References/In-Reply-To headers.',
    {
      thread_id: z.string().describe('Thread ID (from the thread_id field returned by list_mails or read_mail)'),
      account_alias: z.string().optional().describe('Email alias (if not specified, uses the default account)'),
    },
    async (params) => {
      const { result: thread, accountConfig } = await withProvider(
        params.account_alias,
        config,
        pool,
        async (provider) => {
          return provider.getThread(params.thread_id)
        },
      )
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              cliResult(true, { account: accountConfig.alias, ...summarizeThread(thread) }),
              null,
              2,
            ),
          },
        ],
      }
    },
  )

  // ── Tool: trash_mail ──
  server.tool(
    'trash_mail',
    'Move an email to the trash (soft delete).' +
      'Use cases: deleting unwanted emails.' +
      'The mail_id parameter comes from the id field returned by list_mails or search_mails.',
    {
      mail_id: z.string().describe('Mail ID (from the id field returned by list_mails or search_mails)'),
      account_alias: z.string().optional().describe('Email alias (if not specified, uses the default account)'),
    },
    async (params) => {
      const { accountConfig } = await withProvider(params.account_alias, config, pool, async (provider) => {
        await provider.trash(params.mail_id)
      })
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              cliResult(true, {
                mailId: params.mail_id,
                account: accountConfig.alias,
                action: 'trash',
              }),
              null,
              2,
            ),
          },
        ],
      }
    },
  )

  // ── Tool: reply_mail ──
  server.tool(
    'reply_mail',
    'Reply to a specified email. Automatically fills in the recipient (original sender), subject (Re: prefix), and quotes the original message.' +
      'Use cases: replying to an email, replying to all.' +
      'The mail_id parameter comes from the id field returned by list_mails or read_mail.',
    {
      mail_id: z.string().describe('Mail ID to reply to (from the id field returned by list_mails or read_mail)'),
      body: z.string().describe('Reply body'),
      reply_all: z
        .boolean()
        .optional()
        .describe('Reply to all (including original recipients and CC), defaults to replying only to the sender'),
      cc: z.string().optional().describe('Additional CC addresses, multiple separated by commas'),
      quote_original: z.boolean().optional().describe('Whether to quote the original message (defaults to true)'),
      account_alias: z.string().optional().describe('Email alias (if not specified, uses the default account)'),
    },
    async (params) => {
      const { result: sendResult, accountConfig } = await withProvider(
        params.account_alias,
        config,
        pool,
        async (provider) => {
          return provider.reply(params.mail_id, params.body, {
            replyAll: params.reply_all,
            cc: params.cc ? parseAddresses(params.cc) : undefined,
            quoteOriginal: params.quote_original,
          })
        },
      )
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              cliResult(
                sendResult.success,
                {
                  mailId: sendResult.mailId,
                  account: accountConfig.alias,
                  action: 'reply',
                  originalMailId: params.mail_id,
                },
                sendResult.success ? undefined : sendResult.errorMessage,
              ),
              null,
              2,
            ),
          },
        ],
      }
    },
  )

  // ── Tool: forward_mail ──
  server.tool(
    'forward_mail',
    'Forward a specified email to new recipients. Automatically adds Fwd: prefix and forwards the original content.' +
      'Use cases: forwarding emails to others.' +
      'The mail_id parameter comes from the id field returned by list_mails or read_mail.',
    {
      mail_id: z.string().describe('Mail ID to forward (from the id field returned by list_mails or read_mail)'),
      to: z.string().describe('Forward recipient email addresses, multiple separated by commas'),
      body: z.string().optional().describe('Forward note (optional)'),
      include_attachments: z
        .boolean()
        .optional()
        .describe('Whether to include original attachments (defaults to false)'),
      account_alias: z.string().optional().describe('Email alias (if not specified, uses the default account)'),
    },
    async (params) => {
      const { result: sendResult, accountConfig } = await withProvider(
        params.account_alias,
        config,
        pool,
        async (provider) => {
          return provider.forward(params.mail_id, parseAddresses(params.to), {
            body: params.body,
            includeAttachments: params.include_attachments,
          })
        },
      )
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              cliResult(
                sendResult.success,
                {
                  mailId: sendResult.mailId,
                  account: accountConfig.alias,
                  action: 'forward',
                  originalMailId: params.mail_id,
                  to: params.to,
                },
                sendResult.success ? undefined : sendResult.errorMessage,
              ),
              null,
              2,
            ),
          },
        ],
      }
    },
  )

  // ── Tool: download_attachment ──
  server.tool(
    'download_attachment',
    'Download an email attachment to the local filesystem.' +
      'Use cases: saving attachment files from emails.' +
      'The mail_id parameter comes from list_mails or read_mail, attachment_name comes from the attachments list returned by read_mail.',
    {
      mail_id: z.string().describe('Mail ID (from the id field returned by list_mails or read_mail)'),
      attachment_name: z
        .string()
        .describe('Attachment filename (filename field from the attachments list returned by read_mail)'),
      output_dir: z.string().optional().describe('Save directory (defaults to current directory, ".." is not allowed)'),
      account_alias: z.string().optional().describe('Email alias (if not specified, uses the default account)'),
    },
    async (params) => {
      // Path traversal security check
      const path = await import('path')
      if (params.output_dir && params.output_dir.includes('..')) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                cliResult(false, undefined, 'Save directory must not contain ".." path traversal'),
                null,
                2,
              ),
            },
          ],
        }
      }
      if (
        params.attachment_name.includes('..') ||
        params.attachment_name.includes('/') ||
        params.attachment_name.includes('\\')
      ) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                cliResult(false, undefined, 'Attachment name must not contain path separators or ".."'),
                null,
                2,
              ),
            },
          ],
        }
      }

      const { result: attContent, accountConfig } = await withProvider(
        params.account_alias,
        config,
        pool,
        async (provider) => {
          return provider.fetchAttachment(params.mail_id, params.attachment_name)
        },
      )

      // Attachment filename secondary security check
      if (
        attContent.filename.includes('..') ||
        attContent.filename.includes('/') ||
        attContent.filename.includes('\\')
      ) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                cliResult(false, undefined, 'Attachment filename contains illegal path characters'),
                null,
                2,
              ),
            },
          ],
        }
      }

      const fs = await import('fs')
      const outputDir = path.resolve(params.output_dir || '.')
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true })
      }

      const filePath = path.join(outputDir, attContent.filename)
      // Verify final path is within outputDir
      if (!filePath.startsWith(outputDir + path.sep) && filePath !== outputDir) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(cliResult(false, undefined, 'Attachment path traversal risk'), null, 2),
            },
          ],
        }
      }

      fs.writeFileSync(filePath, attContent.content)

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              cliResult(true, {
                mailId: params.mail_id,
                account: accountConfig.alias,
                action: 'download',
                filename: attContent.filename,
                size: attContent.size,
                savedTo: filePath,
              }),
              null,
              2,
            ),
          },
        ],
      }
    },
  )

  // ── Tool: list_accounts ──
  server.tool(
    'list_accounts',
    'List configured email accounts. Returns each account alias, type, email address, and whether it is the default account.' +
      'Use cases: viewing available email accounts, determining the account_alias parameter value, confirming the default account.',
    {},
    async () => {
      const accounts = config.accounts.map((a) => ({
        alias: a.alias,
        provider: a.provider,
        email: a.user || null,
        auth: getAuthLabel(a),
        isDefault: a.isDefault,
      }))
      const defaultAccount = config.accounts.find((a) => a.isDefault)?.alias || null
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              cliResult(true, {
                accounts,
                defaultAccount,
                mode: config.mode || 'human',
                tip: defaultAccount
                  ? `The account_alias parameter for other tools can be omitted and will automatically use the default account "${defaultAccount}"`
                  : 'No default account set, please specify in account_alias',
              }),
              null,
              2,
            ),
          },
        ],
      }
    },
  )

  // ── Tool: health_check ──
  server.tool(
    'health_check',
    'Check the connection status and diagnostic information of an email account.' +
      'Use cases: troubleshooting connection issues, verifying account configuration, diagnosing authentication or network errors.',
    {
      account_alias: z.string().optional().describe('Email alias (if not specified, uses the default account)'),
    },
    async (params) => {
      const { result: health, accountConfig } = await withProvider(
        params.account_alias,
        config,
        pool,
        async (provider) => {
          return provider.healthCheck()
        },
      )
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              cliResult(true, {
                account: accountConfig.alias,
                ...health,
              }),
              null,
              2,
            ),
          },
        ],
      }
    },
  )

  // ── Tool: get_capabilities ──
  server.tool(
    'get_capabilities',
    'Get the capabilities and limits of an email account, such as whether native threading is supported, maximum attachment size, send rate limits, etc.' +
      'Use cases: determining whether an account supports a feature (like threading), understanding attachment size limits, deciding whether to use get_thread.',
    {
      account_alias: z.string().optional().describe('Email alias (if not specified, uses the default account)'),
    },
    async (params) => {
      const { result: caps, accountConfig } = await withProvider(
        params.account_alias,
        config,
        pool,
        async (provider) => {
          return provider.capabilities()
        },
      )
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              cliResult(true, {
                account: accountConfig.alias,
                ...caps,
              }),
              null,
              2,
            ),
          },
        ],
      }
    },
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

// ── Helper functions ──

async function withProvider<T>(
  alias: string | undefined,
  config: ReturnType<typeof loadConfig>,
  pool: ProviderPool,
  fn: (provider: MailProvider) => Promise<T>,
): Promise<{ result: T; accountConfig: AccountConfig }> {
  const accountConfig = getAccount(config, alias)
  if (!accountConfig) {
    throw new Error(
      alias
        ? `No email account with alias "${alias}" found, use list_accounts to see available accounts`
        : 'No email accounts configured, please run ma init in the terminal to configure your email first',
    )
  }

  const { provider, accountConfig: freshConfig } = await pool.getOrCreate(accountConfig)
  try {
    const result = await fn(provider)
    await pool.release(freshConfig)
    return { result, accountConfig: freshConfig }
  } catch (err: any) {
    // On error, evict from pool (connection may be broken)
    await pool.evict(accountConfig.id)
    // Sanitize error messages before throwing to prevent sensitive info leakage to MCP clients
    const redacted = new Error(redactError(err.message || String(err)))
    throw redacted
  }
}

/** Thread summary (for get_thread) */
function summarizeThread(thread: MailThread) {
  return {
    id: thread.id,
    subject: thread.subject,
    mail_count: thread.mailCount,
    participants: thread.participants.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)),
    mails: thread.mails.map(summarizeMailDetail),
  }
}
