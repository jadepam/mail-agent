import { Command } from 'commander'
import { readFileSync } from 'fs'
import { basename } from 'path'
import { loadConfig, persistRefreshedToken } from '../config.js'
import { connectProvider, parseAddresses, shouldConfirm, confirmAction, cliResult } from '../shared.js'

export function registerSendCommand(program: Command): void {
  program
    .command('send')
    .description(
      `Send an email
  ma send -t bob@example.com -s "Meeting Notice" -b "Meeting tomorrow at 3pm"
  ma send -t a@x.com -s "Report" -b "See attachment" --attach ./report.pdf
  ma send -t a@x.com -s "Report" -b "See attachment" --account "Google Mail"`,
    )
    .requiredOption('-t, --to <addresses>', 'Recipient (comma-separated for multiple)')
    .requiredOption('-s, --subject <subject>', 'Email subject')
    .requiredOption('-b, --body <body>', 'Email body')
    .option('-c, --cc <addresses>', 'CC (comma-separated for multiple)')
    .option('--bcc <addresses>', 'BCC (comma-separated for multiple)')
    .option('--attach <files...>', 'Attachment file paths (comma-separated or multiple flags)')
    .option('--in-reply-to <message-id>', 'Message-ID of the email to reply to')
    .option('--account <alias>', 'Account alias to use, e.g. --account "QQ Mail"; defaults to the default account')
    .option('--json', 'Output in JSON format')
    .option('-y, --yes', 'Skip confirmation (AI mode)')
    .action(async (opts) => {
      const config = loadConfig()
      const { provider, accountConfig } = await connectProvider(config, opts.account)

      // Human mode: confirm before sending
      if (shouldConfirm(opts, config)) {
        const confirmed = await confirmAction(
          `Confirm sending via ${accountConfig.alias} to ${opts.to}?\n   Subject: ${opts.subject}`,
        )
        if (!confirmed) {
          console.log('Send cancelled')
          process.exit(0)
        }
      }

      // Parse attachments
      let attachmentContents
      if (opts.attach && opts.attach.length > 0) {
        attachmentContents = []
        for (const filePath of opts.attach) {
          try {
            const content = readFileSync(filePath)
            const filename = basename(filePath)
            attachmentContents.push({
              filename,
              contentType: 'application/octet-stream',
              size: content.length,
              content,
            })
          } catch (err: any) {
            console.error(`❌ Failed to read attachment "${filePath}": ${err.message}`)
            process.exit(2)
          }
        }
      }

      try {
        const result = await provider.send({
          to: parseAddresses(opts.to),
          subject: opts.subject,
          body: { text: opts.body },
          cc: opts.cc ? parseAddresses(opts.cc) : undefined,
          bcc: opts.bcc ? parseAddresses(opts.bcc) : undefined,
          attachmentContents,
          inReplyTo: opts.inReplyTo || undefined,
        })

        if (opts.json) {
          console.log(
            JSON.stringify(
              cliResult(
                result.success,
                {
                  mailId: result.mailId,
                  account: accountConfig.alias,
                  to: opts.to,
                  subject: opts.subject,
                  attachments: attachmentContents?.map((a) => a.filename),
                },
                result.success ? undefined : result.errorMessage,
              ),
              null,
              2,
            ),
          )
        } else if (result.success) {
          console.log(`✉️  Sent via ${accountConfig.alias} to ${opts.to}`)
          console.log(`   Subject: ${opts.subject}`)
          if (attachmentContents?.length) {
            console.log(`   Attachments: ${attachmentContents.map((a) => a.filename).join(', ')}`)
          }
        } else {
          console.error(`❌ Send failed: ${result.errorMessage}`)
          process.exit(1)
        }
      } catch (err: any) {
        console.error(`❌ Send failed: ${err.message || err}`)
        process.exit(1)
      } finally {
        await provider.disconnect()
        persistRefreshedToken(accountConfig)
      }
    })
}
