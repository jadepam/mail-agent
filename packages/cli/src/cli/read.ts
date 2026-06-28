import { Command } from 'commander'
import { loadConfig, persistRefreshedToken } from '../config.js'
import { connectProvider, cliResult, summarizeMailDetail } from '../shared.js'
import { renderMailDetail } from '../table.js'

export function registerReadCommand(program: Command): void {
  program
    .command('read <mail-id>')
    .description(
      `Read email details
  ma read msg_abc123                      Read email from default mailbox
  ma read msg_abc123 --account "Google Mail"  Read from a specific mailbox`,
    )
    .option('--account <alias>', 'Account alias to use, e.g. --account "QQ Mail"; defaults to the default account')
    .option('--json', 'Output in JSON format')
    .action(async (mailId, opts) => {
      const config = loadConfig()
      const { provider, accountConfig } = await connectProvider(config, opts.account)

      try {
        const mail = await provider.read(mailId)

        if (opts.json) {
          console.log(JSON.stringify(cliResult(true, summarizeMailDetail(mail)), null, 2))
        } else {
          renderMailDetail(mail, accountConfig.alias)
        }
      } catch (err: any) {
        console.error(`❌ Failed to read email: ${err.message || err}`)
        process.exit(1)
      } finally {
        await provider.disconnect()
        persistRefreshedToken(accountConfig)
      }
    })
}
