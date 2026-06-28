/**
 * init command — initialization wizard: scan local email accounts, add interactively
 *
 * Flow:
 * 1. Scan locally discoverable accounts (agently-cli, lark-cli, etc.)
 * 2. Display scan results, user selects accounts to add
 * 3. Auto-fill info for unconfigured accounts (e.g., add directly if agently-cli/lark-cli is logged in)
 * 4. Show install prompts for uninstalled providers
 * 5. Save configuration
 */

import { Command } from 'commander'
import inquirer from 'inquirer'
import { loadConfig, saveConfig } from '../config.js'
import { scanLocalAccounts, type DiscoveredAccount } from '../scanner.js'
import type { AccountConfig } from '@mail-agent/core'
import { v7 as uuidv7 } from 'uuid'
import { execFileSync } from 'child_process'
import { parseCliJson } from '../shared.js'

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize configuration — scan local mail, add accounts interactively')
    .option('--config <path>', 'Configuration file path')
    .action(async (opts) => {
      console.log('🔍 Scanning for locally available email accounts...\n')

      const config = loadConfig(opts.config)
      const scanResult = scanLocalAccounts(config.accounts)

      // Show scan warnings
      for (const w of scanResult.warnings) {
        console.log(`  ⚠️  ${w}`)
      }
      if (scanResult.warnings.length > 0) {
        console.log('')
      }

      // Filter out addable accounts (not yet configured)
      const addable = scanResult.accounts.filter((a) => !a.alreadyConfigured)
      // Already configured
      const alreadyDone = scanResult.accounts.filter((a) => a.alreadyConfigured)

      // Show already configured accounts
      if (alreadyDone.length > 0) {
        console.log('✅ Already configured (skipped):')
        for (const a of alreadyDone) {
          console.log(`   ${a.email} (${a.source})`)
        }
        console.log('')
      }

      // No discoverable accounts
      if (addable.length === 0 && config.accounts.length === 0) {
        console.log('📭 No local email accounts found for auto-addition.')
        console.log('')
        console.log('You can add email accounts via:')
        console.log('   ma account add       Interactively add an email account')
        console.log('   agently-cli auth login  Authorize Agently Mail first, then rerun init')
        console.log('   lark-cli auth login --domain mail  Authorize Lark Mail first, then rerun init')
        console.log('')
        // Ask whether to enter account add flow
        const { goAdd } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'goAdd',
            message: 'Add an email account now?',
            default: true,
          },
        ])
        if (goAdd) {
          // Run account add directly
          try {
            execFileSync('ma', ['account', 'add'], { stdio: 'inherit' })
          } catch {}
        }
        return
      }

      // Addable accounts found
      if (addable.length > 0) {
        console.log('🔍 Found the following addable email accounts:')
        for (const a of addable) {
          const icon = a.provider === 'agently' ? '🤖' : a.provider === 'lark' ? '🏢' : '📧'
          const detail = a.detail ? ` — ${a.detail}` : ''
          console.log(`   ${icon} ${a.email} (${a.source})${detail}`)
        }
        console.log('')

        // User selects accounts to add
        const { selected } = await inquirer.prompt([
          {
            type: 'checkbox',
            name: 'selected',
            message: 'Select email accounts to add (space to select, enter to confirm):',
            choices: addable.map((a) => {
              const icon = a.provider === 'agently' ? '🤖' : a.provider === 'lark' ? '🏢' : '📧'
              const detail = a.detail ? ` — ${a.detail}` : ''
              return {
                name: `${icon} ${a.email} (${a.source})${detail}`,
                value: a,
                checked: true, // default all selected
              }
            }),
          },
        ])

        // Create account configs for selected accounts
        for (const disc of selected as DiscoveredAccount[]) {
          // For agently-cli logged-in accounts, create the account config directly
          if (disc.source === 'agently-cli' && disc.provider === 'agently') {
            // Skip placeholder items for "not logged in"
            if (disc.email === '(Not logged in)') {
              console.log(`\n🔐 Starting agently-cli authorization...`)
              try {
                execFileSync('agently-cli', ['auth', 'login'], { stdio: 'inherit' })
                // Re-read email after authorization
                const meOutput = execFileSync('agently-cli', ['+me'], { encoding: 'utf-8' })
                const meJson = parseCliJson(meOutput)
                const primary = meJson?.data?.aliases?.find((a: any) => a.is_primary)
                disc.email = primary?.email || ''
                if (!disc.email) {
                  console.log('❌ Authorization succeeded but could not retrieve email address, skipping')
                  continue
                }
              } catch {
                console.log('❌ agently-cli authorization failed, skipping')
                continue
              }
            }

            // Generate alias
            const alias = await generateAlias(disc, config.accounts)

            const newAccount: AccountConfig = {
              id: uuidv7(),
              alias,
              purpose: disc.detail || '',
              isDefault: config.accounts.length === 0,
              provider: 'agently',
              network: 'public',
              user: disc.email,
              // Agently does not need pass/oauth2/smtp/imap
            }

            config.accounts.push(newAccount)
            console.log(`✅ Added "${alias}" (${disc.email})`)
          }

          // For lark-cli logged-in accounts, create the account config directly
          if (disc.source === 'lark-cli' && disc.provider === 'lark') {
            // Skip placeholder items for "not logged in"
            if (disc.email === '(Not logged in)') {
              console.log(`\n🔐 Starting lark-cli authorization...`)
              try {
                execFileSync('lark-cli', ['auth', 'login', '--domain', 'mail', '--as', 'user'], { stdio: 'inherit' })
                // Re-read email after authorization
                const profileOutput = execFileSync('lark-cli', ['mail', 'user_mailbox', 'profile', '--as', 'user'], {
                  encoding: 'utf-8',
                })
                const profileJson = parseCliJson(profileOutput)
                disc.email = profileJson?.data?.primary_email_address || ''
                if (!disc.email) {
                  console.log('❌ Authorization succeeded but could not retrieve email address, skipping')
                  continue
                }
              } catch {
                console.log('❌ lark-cli authorization failed, skipping')
                continue
              }
            }

            // Generate alias
            const alias = await generateAlias(disc, config.accounts)

            const newAccount: AccountConfig = {
              id: uuidv7(),
              alias,
              purpose: disc.detail || '',
              isDefault: config.accounts.length === 0,
              provider: 'lark',
              network: 'public',
              user: disc.email,
              // Lark does not need pass/oauth2/smtp/imap
            }

            config.accounts.push(newAccount)
            console.log(`✅ Added "${alias}" (${disc.email})`)
          }
        }
      }

      // Save configuration
      if (config.accounts.length > 0) {
        // Ensure there is a default account
        if (!config.accounts.some((a) => a.isDefault)) {
          config.accounts[0].isDefault = true
        }

        // Ask for run mode (Human / AI)
        const { mode } = await inquirer.prompt<{
          mode: 'human' | 'ai'
        }>([
          {
            type: 'select',
            name: 'mode',
            message: 'Select run mode:',
            choices: [
              {
                name: '🧑 Human Mode — Destructive actions (send/delete/etc.) require confirmation (recommended)',
                value: 'human',
              },
              { name: '🤖 AI Mode — Skip all confirmations, suitable for automation', value: 'ai' },
            ],
            default: 'human',
          },
        ])
        config.mode = mode

        saveConfig(config, opts.config)
        console.log('')
        console.log('📝 Configuration saved to ~/.mail-agent/config.yaml')
        const modeLabel = mode === 'ai' ? 'AI Mode (skip confirmations)' : 'Human Mode (requires confirmation)'
        console.log(`   Run mode: ${modeLabel}`)
        console.log('')
        console.log('You can now:')
        console.log('   ma +me               View configured accounts')
        console.log('   ma list               List emails')
        console.log('   ma account add        Continue adding more email accounts')
        console.log('   ma mode ai            Switch to AI mode')
      } else {
        console.log('')
        console.log('No email accounts were added.')
        console.log('Run ma account add to add one manually.')
      }
    })
}

/**
 * Generate an alias for a discovered account.
 * Infer from email address first; ask the user if there's a conflict.
 */
async function generateAlias(disc: DiscoveredAccount, existingAccounts: AccountConfig[]): Promise<string> {
  // Infer alias from email address
  let alias = ''

  if (disc.provider === 'agently') {
    alias = 'Agent Mail'
  } else if (disc.provider === 'lark') {
    alias = 'Lark Mail'
  } else {
    // Infer from email domain
    const domain = disc.email.split('@')[1]?.toLowerCase() || ''
    const aliasMap: Record<string, string> = {
      'gmail.com': 'Gmail',
      'outlook.com': 'Outlook',
      'hotmail.com': 'Outlook',
      'qq.com': 'QQ Mail',
      '163.com': '163 Mail',
      '126.com': '126 Mail',
    }
    alias = aliasMap[domain] || domain.split('.')[0] || 'Mail'
  }

  // Check if alias already exists
  if (!existingAccounts.find((a) => a.alias === alias)) {
    return alias
  }

  // Alias already exists, ask user for a new one
  const { customAlias } = await inquirer.prompt([
    {
      type: 'input',
      name: 'customAlias',
      message: `Alias "${alias}" already exists, please enter a new alias:`,
      default: `${alias}2`,
      validate: (input: string) => {
        if (!input.trim()) return 'Alias cannot be empty'
        if (existingAccounts.find((a) => a.alias === input.trim())) return 'This alias already exists'
        return true
      },
    },
  ])
  return customAlias.trim()
}
