import { Command } from 'commander'
import { loadConfig, persistRefreshedToken } from '../config.js'
import { connectProvider, cliResult, summarizeMail } from '../shared.js'
import { renderMailTable } from '../table.js'

export function registerSearchCommand(program: Command): void {
  program
    .command('search <query>')
    .description(
      `Search emails
  ma search "reimbursement"                          Search default mailbox
  ma search "report" --account "Google Mail"   Search a specific mailbox
  ma search "report" --unread                 Search unread only
  ma search "meeting" --from "boss@x.com"      Filter by sender`,
    )
    .option('-n, --limit <number>', 'Number of results')
    .option('-f, --folder <name>', 'Search within a specific folder')
    .option('--from <sender>', 'Filter by sender')
    .option('--unread', 'Unread only')
    .option('--account <alias>', 'Account alias to use, e.g. --account "QQ Mail"; defaults to the default account')
    .option('--json', 'Output in JSON format')
    .action(async (query, opts) => {
      const config = loadConfig()
      const { provider, accountConfig } = await connectProvider(config, opts.account)

      try {
        const mails = await provider.search({
          query,
          limit: parseInt(opts.limit) || 20,
          folder: opts.folder,
          from: opts.from,
          unread: opts.unread,
        })

        if (opts.json) {
          console.log(
            JSON.stringify(
              cliResult(true, {
                query,
                account: accountConfig.alias,
                count: mails.length,
                mails: mails.map(summarizeMail),
              }),
              null,
              2,
            ),
          )
        } else {
          if (mails.length === 0) {
            console.log(`🔍 No results for "${query}"`)
            return
          }
          console.log(`🔍 Found ${mails.length} email(s) for "${query}":\n`)
          renderMailTable(mails, accountConfig.alias)
        }
      } catch (err: any) {
        console.error(`❌ Search failed: ${err.message || err}`)
        process.exit(1)
      } finally {
        await provider.disconnect()
        persistRefreshedToken(accountConfig)
      }
    })
}
