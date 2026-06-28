import { Command } from 'commander'
import { loadConfig, persistRefreshedToken } from '../config.js'
import { connectProvider, cliResult } from '../shared.js'

export function registerDownloadCommand(program: Command): void {
  program
    .command('download <mail-id>')
    .description(
      `Download email attachments
  ma download msg_abc123 --att Report.pdf              Download a specific attachment
  ma download msg_abc123 --att Report.pdf -o ~/Downloads  Specify save directory
  ma download msg_abc123 --all                        Download all attachments`,
    )
    .option('--att <filename>', 'Attachment name (from the attachment list returned by the read command)')
    .option('--all', 'Download all attachments')
    .option('-o, --output <dir>', 'Save directory (defaults to current directory)', '.')
    .option('--account <alias>', 'Account alias to use, e.g. --account "QQ Mail"; defaults to the default account')
    .option('--json', 'Output in JSON format')
    .action(async (mailId, opts) => {
      if (!opts.att && !opts.all) {
        console.error('❌ Please specify --att <filename> or --all')
        process.exit(2)
      }

      // Path traversal safety check
      const path = await import('path')
      if (opts.output.includes('..')) {
        console.error('❌ Save directory must not contain ".." path traversal')
        process.exit(2)
      }
      if (opts.att && (opts.att.includes('..') || opts.att.includes('/') || opts.att.includes('\\'))) {
        console.error('❌ Attachment name must not contain path separators or ".."')
        process.exit(2)
      }

      const config = loadConfig()
      const { provider, accountConfig } = await connectProvider(config, opts.account)

      try {
        // Fetch email to list attachments
        const mail = await provider.read(mailId)

        if (mail.attachments.length === 0) {
          console.log('📭 This email has no attachments')
          return
        }

        // Determine which attachments to download
        let targets: string[]
        if (opts.all) {
          targets = mail.attachments.map((a) => a.filename)
        } else {
          targets = [opts.att]
          // Check if attachment exists
          const found = mail.attachments.some((a) => a.filename === opts.att)
          if (!found) {
            console.error(
              `❌ Attachment "${opts.att}" not found. Available: ${mail.attachments.map((a) => a.filename).join(', ')}`,
            )
            process.exit(2)
          }
        }

        const fs = await import('fs')
        const outputDir = path.resolve(opts.output)
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true })
        }

        const downloaded: string[] = []
        const LARGE_ATTACHMENT_THRESHOLD = 10 * 1024 * 1024 // 10MB

        for (const filename of targets) {
          // Attachment filename safety check
          if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
            console.error(`❌ Attachment "${filename}" contains illegal path characters, skipping`)
            continue
          }
          // Large attachment notification
          const attMeta = mail.attachments.find((a) => a.filename === filename)
          if (attMeta && attMeta.size > LARGE_ATTACHMENT_THRESHOLD && !opts.json) {
            const sizeMB = (attMeta.size / 1024 / 1024).toFixed(1)
            console.log(`⏳ Downloading large attachment "${filename}" (${sizeMB}MB), please wait...`)
          }
          const attContent = await provider.fetchAttachment(mailId, filename)
          const filePath = path.join(outputDir, attContent.filename)
          // Double-check: ensure final path is within outputDir
          if (!filePath.startsWith(outputDir + path.sep) && filePath !== outputDir) {
            console.error(`❌ Attachment "${attContent.filename}" path traversal detected, skipping`)
            continue
          }
          fs.writeFileSync(filePath, attContent.content)
          downloaded.push(filePath)
        }

        if (opts.json) {
          console.log(
            JSON.stringify(
              cliResult(true, {
                mailId,
                account: accountConfig.alias,
                action: 'download',
                files: downloaded,
              }),
              null,
              2,
            ),
          )
        } else {
          for (const f of downloaded) {
            console.log(`📎 Saved: ${f}`)
          }
          console.log(`\n✅ Downloaded ${downloaded.length} attachment(s) via ${accountConfig.alias} to ${outputDir}`)
        }
      } catch (err: any) {
        console.error(`❌ Download failed: ${err.message || err}`)
        process.exit(1)
      } finally {
        await provider.disconnect()
        persistRefreshedToken(accountConfig)
      }
    })
}
