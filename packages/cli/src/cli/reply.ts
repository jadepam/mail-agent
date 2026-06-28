import { Command } from 'commander'
import { loadConfig, persistRefreshedToken } from '../config.js'
import { connectProvider, shouldConfirm, confirmAction, parseAddresses, cliResult } from '../shared.js'

export function registerReplyCommand(program: Command): void {
  program
    .command('reply <mail-id>')
    .description(
      `Reply to an email
  ma reply msg_abc123 -b "Received, thanks"              Reply to sender
  ma reply msg_abc123 -b "Got it" --reply-all             Reply all
  ma reply msg_abc123 -b "Got it" --account "QQ Mail"     Reply using a specific account`,
    )
    .requiredOption('-b, --body <body>', 'Reply body')
    .option('--reply-all', 'Reply to all (recipients + CC)')
    .option('--cc <addresses>', 'Additional CC addresses (comma-separated)')
    .option('--no-quote', 'Do not quote original')
    .option('--account <alias>', 'Account alias to use, e.g. --account "QQ Mail"; defaults to the default account')
    .option('--json', 'Output in JSON format')
    .option('-y, --yes', 'Skip confirmation (AI mode)')
    .action(async (mailId, opts) => {
      const config = loadConfig()
      const { provider, accountConfig } = await connectProvider(config, opts.account)

      // Human mode: confirm reply
      if (shouldConfirm(opts, config)) {
        const bodyPreview = opts.body.length > 80 ? opts.body.slice(0, 80) + '...' : opts.body
        const replyMode = opts.replyAll ? 'all' : 'sender'
        const confirmed = await confirmAction(
          `Confirm replying to ${mailId} via ${accountConfig.alias} (${replyMode})?\n   Reply: ${bodyPreview}`,
        )
        if (!confirmed) {
          console.log('Reply cancelled')
          process.exit(0)
        }
      }

      try {
        const result = await provider.reply(mailId, opts.body, {
          replyAll: opts.replyAll || false,
          cc: opts.cc ? parseAddresses(opts.cc) : undefined,
          quoteOriginal: opts.quote !== false,
        })

        if (opts.json) {
          console.log(
            JSON.stringify(
              cliResult(
                result.success,
                {
                  mailId: result.mailId,
                  account: accountConfig.alias,
                  action: 'reply',
                  originalMailId: mailId,
                },
                result.success ? undefined : result.errorMessage,
              ),
              null,
              2,
            ),
          )
        } else if (result.success) {
          console.log(`✉️  Replied to ${mailId} via ${accountConfig.alias}`)
        } else {
          console.error(`❌ Reply failed: ${result.errorMessage}`)
          process.exit(1)
        }
      } catch (err: any) {
        console.error(`❌ Reply failed: ${err.message || err}`)
        process.exit(1)
      } finally {
        await provider.disconnect()
        persistRefreshedToken(accountConfig)
      }
    })
}
