import { Command } from 'commander'
import { loadConfig, saveConfig } from '../config.js'

export function registerModeCommand(program: Command): void {
  program
    .command('mode [value]')
    .description(
      `View or switch running mode
  ma mode            View current mode
  ma mode ai         Switch to AI mode (skip confirmations, suitable for automation)
  ma mode human      Switch to human mode (destructive actions require confirmation)`,
    )
    .action(async (value) => {
      const config = loadConfig()
      const current = config.mode || 'human'

      if (!value) {
        // View current mode
        const label = current === 'ai' ? 'AI mode (skip confirmations)' : 'Human mode (confirmations required)'
        console.log(`Current mode: ${label}`)
        return
      }

      const normalized = value.toLowerCase()
      if (normalized !== 'ai' && normalized !== 'human') {
        console.error('❌ Mode must be "ai" or "human"')
        process.exit(2)
      }

      if (normalized === current) {
        console.log(`ℹ️  Already in ${normalized === 'ai' ? 'AI' : 'human'} mode`)
        return
      }

      config.mode = normalized as 'ai' | 'human'
      saveConfig(config)
      const label = normalized === 'ai' ? 'AI mode (skip confirmations)' : 'Human mode (confirmations required)'
      console.log(`✅ Switched to ${label}`)
    })
}
