import { Command } from 'commander'
import { loadConfig, persistRefreshedToken } from '../config.js'
import { connectProvider, shouldConfirm, confirmAction, parseAddresses, cliResult } from '../shared.js'

export function registerForwardCommand(program: Command): void {
  program
    .command('forward <mail-id>')
    .description(
      `Forward an email
  ma forward msg_abc123 -t bob@x.com              Forward email
  ma forward msg_abc123 -t bob@x.com -b "Please review"   With forwarding note
  ma forward msg_abc123 -t bob@x.com --include-attachments  Include original attachments`,
    )
    .requiredOption('-t, --to <addresses>', 'Forward recipient (comma-separated for multiple)')
    .option('-b, --body <body>', 'Forwarding note')
    .option('--include-attachments', 'Include original attachments')
    .option('--account <alias>', 'Account alias to use, e.g. --account "QQ Mail"; defaults to the default account')
    .option('--json', 'Output in JSON format')
    .option('-y, --yes', 'Skip confirmation (AI mode)')
    .action(async (mailId, opts) => {
      const config = loadConfig()
      const { provider, accountConfig } = await connectProvider(config, opts.account)

      // Human mode: confirm forward
      if (shouldConfirm(opts, config)) {
        const confirmed = await confirmAction(`Confirm forwarding ${mailId} via ${accountConfig.alias} to ${opts.to}?`)
        if (!confirmed) {
          console.log('Forward cancelled')
          process.exit(0)
        }
      }

      try {
        const result = await provider.forward(mailId, parseAddresses(opts.to), {
          body: opts.body,
          includeAttachments: opts.includeAttachments || false,
        })

        if (opts.json) {
          console.log(
            JSON.stringify(
              cliResult(
                result.success,
                {
                  mailId: result.mailId,
                  account: accountConfig.alias,
                  action: 'forward',
                  originalMailId: mailId,
                  to: opts.to,
                },
                result.success ? undefined : result.errorMessage,
              ),
              null,
              2,
            ),
          )
        } else if (result.success) {
          console.log(`✉️  Forwarded ${mailId} to ${opts.to} via ${accountConfig.alias}`)
        } else {
          console.error(`❌ Forward failed: ${result.errorMessage}`)
          process.exit(1)
        }
      } catch (err: any) {
        console.error(`❌ Forward failed: ${err.message || err}`)
        process.exit(1)
      } finally {
        await provider.disconnect()
        persistRefreshedToken(accountConfig)
      }
    })
}
