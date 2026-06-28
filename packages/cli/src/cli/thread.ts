import { Command } from 'commander'
import { loadConfig, persistRefreshedToken } from '../config.js'
import { connectProvider, cliResult, summarizeMailDetail } from '../shared.js'
import type { MailThread } from '@mail-agent/core'

export function registerThreadCommand(program: Command): void {
  program
    .command('thread <thread-id>')
    .description(
      `View email thread
  ma thread 1982abc123                    View thread from default mailbox
  ma thread 1982abc123 --account "Gmail"  View thread from a specific mailbox
  Gmail and Lark/Feishu use native threads; SMTP/IMAP groups by References header`,
    )
    .option('--account <alias>', 'Account alias to use; defaults to the default account')
    .option('--json', 'Output in JSON format')
    .action(async (threadId, opts) => {
      const config = loadConfig()
      const { provider, accountConfig } = await connectProvider(config, opts.account)

      try {
        const thread = await provider.getThread(threadId)

        if (opts.json) {
          const summarizeThread = (t: MailThread) => ({
            id: t.id,
            subject: t.subject,
            mail_count: t.mailCount,
            participants: t.participants.map((a: any) => (a.name ? `${a.name} <${a.address}>` : a.address)),
            mails: t.mails.map(summarizeMailDetail),
          })
          console.log(JSON.stringify(cliResult(true, summarizeThread(thread)), null, 2))
        } else {
          console.log(`\n📧 Thread: ${thread.subject}`)
          console.log('─'.repeat(50))
          console.log(
            `  Participants: ${thread.participants.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', ')}`,
          )
          console.log(`  Email count: ${thread.mailCount}`)
          console.log('─'.repeat(50))
          for (const mail of thread.mails) {
            const status = mail.read ? '✅' : '🔵'
            console.log(`\n${status} ${mail.from.name || mail.from.address} — ${mail.date.toLocaleString()}`)
            console.log(`   ${mail.body.text?.slice(0, 200) || '(no body)'}`)
          }
          console.log('')
        }
      } catch (err: any) {
        console.error(`❌ Failed to fetch thread: ${err.message || err}`)
        process.exit(1)
      } finally {
        await provider.disconnect()
        persistRefreshedToken(accountConfig)
      }
    })
}
