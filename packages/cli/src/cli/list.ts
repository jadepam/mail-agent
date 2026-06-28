import { Command } from 'commander'
import { loadConfig, persistRefreshedToken } from '../config.js'
import { connectProvider, cliResult, summarizeMail } from '../shared.js'
import { renderMailTable } from '../table.js'
import { DEFAULT_FETCH_LIMIT } from '@mail-agent/core'

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description(
      `List emails
  ma list                             List last 20 emails from default mailbox
  ma list --account "Google Mail" -n 5  List last 5 from Google mailbox`,
    )
    .option('-f, --folder <name>', 'Folder name (INBOX / Sent / Trash, etc.)', 'INBOX')
    .option('-n, --limit <number>', 'Number of results', String(DEFAULT_FETCH_LIMIT))
    .option('--unread', 'Unread only')
    .option('--account <alias>', 'Account alias to use, e.g. --account "QQ Mail"; defaults to the default account')
    .option('--json', 'Output in JSON format')
    .action(async (opts) => {
      const config = loadConfig()
      const { provider, accountConfig } = await connectProvider(config, opts.account)

      try {
        const mails = await provider.fetch({
          folder: opts.folder,
          limit: parseInt(opts.limit) || 20,
          unread: opts.unread,
        })

        if (opts.json) {
          console.log(
            JSON.stringify(
              cliResult(true, {
                account: accountConfig.alias,
                folder: opts.folder,
                count: mails.length,
                mails: mails.map(summarizeMail),
              }),
              null,
              2,
            ),
          )
        } else {
          if (mails.length === 0) {
            console.log('📭 No emails')
            return
          }
          renderMailTable(mails, accountConfig.alias)
        }
      } catch (err: any) {
        console.error(`❌ Failed to fetch emails: ${err.message || err}`)
        process.exit(1)
      } finally {
        await provider.disconnect()
        persistRefreshedToken(accountConfig)
      }
    })
}
