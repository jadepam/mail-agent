import { Command } from 'commander'
import { loadConfig } from '../config.js'
import { cliResult } from '../shared.js'
import { Table } from '../table.js'
import { getAuthLabel } from '@mail-agent/core'

export function registerMeCommand(program: Command): void {
  program
    .command('+me')
    .description('List configured email accounts')
    .option('--json', 'Output in JSON format')
    .action((opts) => {
      const config = loadConfig()
      if (config.accounts.length === 0) {
        if (opts.json) {
          console.log(JSON.stringify(cliResult(true, { accounts: [], defaultAccount: null }), null, 2))
        } else {
          console.log('❌ No email accounts configured')
          console.log('   Run ma init to scan and add a local mailbox')
          console.log('   Or run ma account add to add one manually')
        }
        return
      }
      const defaultAlias = config.accounts.find((a) => a.isDefault)?.alias || null
      if (opts.json) {
        console.log(
          JSON.stringify(
            cliResult(true, {
              accounts: config.accounts.map((a) => ({
                alias: a.alias,
                provider: a.provider,
                email: a.user || null,
                auth: getAuthLabel(a),
                isDefault: a.isDefault,
              })),
              defaultAccount: defaultAlias,
            }),
            null,
            2,
          ),
        )
        return
      }
      const t = new Table()
      t.header(['Alias', 'Type', 'Email', 'Auth', ''])
      t.colWidths([12, 10, 30, 10, 8])
      for (const a of config.accounts) {
        const def = a.isDefault ? '⭐ Default' : ''
        const authLabelMap: Record<string, string> = {
          oauth2: 'OAuth2',
          'agently-cli': 'CLI Proxy',
          'api-key': 'API Key',
          password: 'Password',
          unconfigured: 'Unconfigured',
        }
        const auth = authLabelMap[getAuthLabel(a)] || getAuthLabel(a)
        t.row([a.alias, a.provider, a.user || '-', auth, def])
      }
      console.log(t.render())
    })
}
