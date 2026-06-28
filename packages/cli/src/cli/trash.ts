import { Command } from 'commander'
import { loadConfig, persistRefreshedToken } from '../config.js'
import { connectProvider, shouldConfirm, confirmAction, cliResult } from '../shared.js'

export function registerTrashCommand(program: Command): void {
  program
    .command('trash <mail-id>')
    .description(
      `Delete email (move to trash)
  ma trash msg_abc123                    Delete from default mailbox
  ma trash msg_abc123 --account "Gmail"  Delete from a specific mailbox`,
    )
    .option('--account <alias>', 'Account alias to use, e.g. --account "QQ Mail"; defaults to the default account')
    .option('--json', 'Output in JSON format')
    .option('-y, --yes', 'Skip confirmation (AI mode)')
    .action(async (mailId, opts) => {
      const config = loadConfig()
      const { provider, accountConfig } = await connectProvider(config, opts.account)

      // Human mode: confirm deletion
      if (shouldConfirm(opts, config)) {
        const confirmed = await confirmAction(`Confirm moving email ${mailId} from ${accountConfig.alias} to trash?`)
        if (!confirmed) {
          console.log('Deletion cancelled')
          process.exit(0)
        }
      }

      try {
        await provider.trash(mailId)

        if (opts.json) {
          console.log(
            JSON.stringify(
              cliResult(true, {
                mailId,
                account: accountConfig.alias,
                action: 'trash',
              }),
              null,
              2,
            ),
          )
        } else {
          console.log(`🗑️  Moved email ${mailId} to trash via ${accountConfig.alias}`)
        }
      } catch (err: any) {
        if (opts.json) {
          console.log(JSON.stringify(cliResult(false, undefined, err.message || 'Delete failed'), null, 2))
        } else {
          console.error(`❌ Delete failed: ${err.message || err}`)
        }
        process.exit(1)
      } finally {
        await provider.disconnect()
        persistRefreshedToken(accountConfig)
      }
    })
}
