import { Command } from 'commander'
import inquirer from 'inquirer'
import {
  loadConfig,
  saveConfig,
  getAccount,
  removeAccount,
  encryptCredentialFile,
  decryptCredentialFile,
  isCredentialsEncrypted,
  setMasterPassword,
} from '../config.js'
import { createProvider } from '../factory.js'
import { performOAuth2Auth, getOAuth2ProviderConfig } from '../oauth2.js'
import { PROVIDER_TEMPLATES, getAuthLabel } from '@mail-agent/core'
import type { MailProvider, AccountConfig } from '@mail-agent/core'
import { v7 as uuidv7 } from 'uuid'
import { execFileSync } from 'child_process'
import { scanLocalAccounts } from '../scanner.js'
import { Table } from '../table.js'
import { parseCliJson } from '../shared.js'

/**
 * account subcommand — manage email accounts
 */

export function registerAccountCommand(program: Command): void {
  const accountCmd = new Command('account')
  accountCmd.description('Manage email accounts — add, remove, test, set default')

  // ── account add ──
  accountCmd
    .command('add')
    .description('Interactively add an email account (for detailed usage: ma account add -h)')
    .option('--alias <name>', 'Account alias (e.g. "Gmail", "QQ Mail")')
    .option('--purpose <purpose>', 'Purpose tag (e.g. "personal daily", "formal business")')
    .option('--provider <type>', '邮箱类型（gmail|outlook|qq|163|smtp-imap|agently|lark）')
    .option('--set-default', '设置为默认账号')
    .option('--config <path>', '配置文件路径')
    .action(async (opts) => {
      const config = loadConfig(opts.config)
      const accounts = config.accounts

      let alias = opts.alias
      let purpose = opts.purpose || ''
      let provider = opts.provider as AccountConfig['provider'] | undefined
      let isDefault = opts.setDefault || accounts.length === 0

      // Declare variables upfront (scan branch may assign user early)
      let user = ''
      let pass: string | undefined
      let oauth2: AccountConfig['oauth2']
      let apiKey: string | undefined
      let inboxId: string | undefined
      let smtpConfig: AccountConfig['smtp']
      let imapConfig: AccountConfig['imap']
      let network: 'public' | 'private' = 'public'

      // 1. Alias
      if (!alias) {
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'alias',
            message: 'Please enter an email alias (e.g. "Gmail", "QQ Mail"): ',
            validate: (input: string) => (input.trim() ? true : 'Alias cannot be empty'),
          },
        ])
        alias = answers.alias
      }

      // Check if alias already exists
      if (accounts.find((a) => a.alias === alias)) {
        console.error(`❌ Alias "${alias}" already exists, please use a different alias`)
        process.exit(1)
      }

      // 2. Choose email provider type
      if (!provider) {
        // First scan locally available accounts
        const scanResult = scanLocalAccounts(accounts)
        const addable = scanResult.accounts.filter((a) => !a.alreadyConfigured && a.email !== '(未登录)')

        // Build choices list, scanned accounts first
        const choices: Array<{ name: string; value: string; disabled?: boolean | string }> = []

        if (addable.length > 0) {
          for (const disc of addable) {
            const icon = disc.provider === 'agently' ? '🤖' : disc.provider === 'lark' ? '🏢' : '📧'
            const detail = disc.detail ? ` — ${disc.detail}` : ''
            choices.push({
              name: `${icon} ${disc.email} (${disc.source})${detail} ⭐ 已就绪`,
              value: `scan:${disc.email}:${disc.provider}`,
            })
          }
          // Separator line
          choices.push({ name: '─── Manually add other types ───', value: '__separator__', disabled: true } as any)
        }

        choices.push(
          { name: '📧 Gmail (OAuth2 Authorization)', value: 'gmail' },
          { name: '📧 Outlook (OAuth2 Authorization)', value: 'outlook' },
          { name: '📧 QQ Mail (Authorization Code)', value: 'qq' },
          { name: '📧 163 Mail (Authorization Code)', value: '163' },
          { name: '🏢 Enterprise Private Email (Custom SMTP/IMAP)', value: 'smtp-imap' },
          { name: '🤖 Agently Mail (agently-cli OAuth Authorization)', value: 'agently' },
          { name: '🏢 Lark / 飞书企业邮箱 (lark-cli OAuth Authorization)', value: 'lark' },
        )

        const answers = await inquirer.prompt([
          {
            type: 'select',
            name: 'provider',
            message: addable.length > 0 ? 'Select an email account: ' : 'Please select an email provider type: ',
            choices,
          },
        ])

        // Handle scanned accounts (auto-fill email and provider)
        if (answers.provider.startsWith('scan:')) {
          const [, scanEmail, scanProvider] = answers.provider.split(':')
          user = scanEmail
          provider = scanProvider as AccountConfig['provider']
        } else {
          provider = answers.provider as AccountConfig['provider']
        }
      }

      // 3. Follow different auth flow based on type
      const template = PROVIDER_TEMPLATES[provider as string]

      if (provider === 'agently') {
        // ── Agently Mail flow (via agently-cli OAuth authorization) ──
        // Check if agently-cli is installed
        try {
          execSync('which agently-cli', { encoding: 'utf-8', stdio: 'pipe' })
        } catch {
          console.error('❌ agently-cli not found, please install first:')
          console.error('   npm install -g agently-cli')
          process.exit(1)
        }

        // Check if already logged in
        let alreadyLoggedIn = false
        try {
          const statusOutput = execSync('agently-cli auth status', { encoding: 'utf-8' })
          const statusJson = parseCliJson(statusOutput)
          alreadyLoggedIn = statusJson?.data?.logged_in === true
        } catch {}

        if (alreadyLoggedIn) {
          console.log('✅ agently-cli already logged in, skipping authorization')
        } else {
          console.log('\n🔐 About to authorize via agently-cli...')
          console.log('   This will open a browser for authorization. Please complete it in the browser.\n')
          try {
            execSync('agently-cli auth login', { encoding: 'utf-8', stdio: 'inherit' })
            console.log('✅ Agently Mail authorization successful!')
          } catch (err: any) {
            console.error(`❌ Agently Mail authorization failed: ${err.message}`)
            process.exit(1)
          }
        }

        // Skip +me reading if email address was obtained via scan
        if (!user) {
          try {
            const meOutput = execSync('agently-cli +me', { encoding: 'utf-8' })
            const meJson = parseCliJson(meOutput)
            const primaryAlias = meJson?.data?.aliases?.find((a: any) => a.is_primary)
            user = primaryAlias?.email || ''
            if (!user) {
              console.error('❌ Unable to retrieve email address from agently-cli')
              process.exit(1)
            }
            console.log(`   Email address: ${user}`)
          } catch (err: any) {
            console.error(`❌ Failed to retrieve Agently user info: ${err.message}`)
            process.exit(1)
          }
        } else {
          console.log(`   邮箱地址：${user}`)
        }

        // Agently accounts don't need pass/oauth2/smtp/imap; credentials managed by agently-cli
        network = 'public'
      } else if (provider === 'lark') {
        // ── Lark / 飞书企业邮箱 flow (via lark-cli OAuth authorization) ──
        // Check if lark-cli is installed
        try {
          execSync('which lark-cli', { encoding: 'utf-8', stdio: 'pipe' })
        } catch {
          console.error('❌ lark-cli not found, please install first:')
          console.error('   npx @larksuite/cli@latest install')
          process.exit(1)
        }

        // Check if already logged in (user identity)
        let alreadyLoggedIn = false
        try {
          const statusOutput = execSync('lark-cli auth status --as user', { encoding: 'utf-8' })
          const statusJson = parseCliJson(statusOutput)
          alreadyLoggedIn = statusJson?.data?.logged_in === true
        } catch {}

        if (alreadyLoggedIn) {
          console.log('✅ lark-cli already logged in (user identity), skipping authorization')
        } else {
          console.log('\n🔐 About to authorize via lark-cli...')
          console.log('   This will generate a QR code. Please scan it with the Lark mobile app to authorize.\n')
          try {
            execSync('lark-cli auth login --domain mail --as user', { encoding: 'utf-8', stdio: 'inherit' })
            console.log('✅ Lark Mail authorization successful!')
          } catch (err: any) {
            console.error(`❌ Lark Mail authorization failed: ${err.message}`)
            process.exit(1)
          }
        }

        // Read user mailbox profile to get email address
        if (!user) {
          try {
            // Try reading mailbox profile first
            const profileOutput = execSync('lark-cli mail user_mailbox profile --as user', { encoding: 'utf-8' })
            const profileJson = parseCliJson(profileOutput)
            user = profileJson?.data?.primary_email_address || ''
          } catch {
            // Fallback: try +me
            try {
              const meOutput = execSync('lark-cli +me --as user', { encoding: 'utf-8' })
              const meJson = parseCliJson(meOutput)
              const primaryAlias = meJson?.data?.aliases?.find((a: any) => a.is_primary)
              user = primaryAlias?.email || ''
            } catch {}
          }

          if (!user) {
            console.error('❌ Unable to retrieve email address from lark-cli')
            process.exit(1)
          }
          console.log(`   Email address: ${user}`)
        } else {
          console.log(`   邮箱地址：${user}`)
        }

        // Lark accounts don't need pass/oauth2/smtp/imap; credentials managed by lark-cli
        network = 'public'
      } else if (template?.authType === 'oauth2') {
        // ── OAuth2 flow (Gmail / Outlook / all OAuth2 providers) ──
        const providerConfig = getOAuth2ProviderConfig(provider as string)

        // 1. Enter email address
        const emailAnswer = await inquirer.prompt([
          {
            type: 'input',
            name: 'user',
            message: `Please enter your ${provider === 'gmail' ? 'Gmail' : provider === 'outlook' ? 'Outlook' : provider} email address: `,
            validate: (input: string) => (input.trim() ? true : 'Email address cannot be empty'),
          },
        ])
        user = emailAnswer.user

        // 2. Show registration guide + enter clientId / clientSecret
        if (providerConfig) {
          console.log(`\n${providerConfig.registerGuide}\n`)
        }

        const credAnswers = await inquirer.prompt([
          {
            type: 'input',
            name: 'clientId',
            message: 'Please enter OAuth2 Client ID: ',
            validate: (input: string) => (input.trim() ? true : 'Client ID cannot be empty'),
          },
          {
            type: 'password',
            mask: '*',
            name: 'clientSecret',
            message: providerConfig?.requiresClientSecret
              ? 'Please enter OAuth2 Client Secret: '
              : 'Please enter OAuth2 Client Secret (leave blank if not required): ',
            validate: (input: string) => {
              if (providerConfig?.requiresClientSecret && !input.trim()) {
                return 'This provider requires a client secret'
              }
              return true
            },
          },
        ])

        // 3. Remind about redirect URI configuration
        console.log(`\n⚠️  Please ensure the following redirect URIs are added in the OAuth2 app settings:`)
        console.log(`   Gmail:    http://127.0.0.1:18291/callback`)
        console.log(`   Outlook:  http://127.0.0.1:18292/callback`)
        console.log(
          `   (If default ports are in use, the port will auto-increment during authorization and the actual URI will be shown)\n`,
        )

        const confirmReady = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'ready',
            message: 'Redirect URI configured and ready to start authorization?',
            default: true,
          },
        ])

        if (!confirmReady.ready) {
          console.log('Authorization cancelled.')
          process.exit(0)
        }

        // 4. Perform OAuth2 authorization
        console.log(`\n🔐 About to open browser for OAuth2 authorization...`)
        try {
          const tokenResult = await performOAuth2Auth(
            provider,
            user,
            credAnswers.clientId.trim(),
            credAnswers.clientSecret.trim(),
          )
          oauth2 = {
            clientId: tokenResult.clientId,
            clientSecret: tokenResult.clientSecret,
            refreshToken: tokenResult.refreshToken,
            accessToken: tokenResult.accessToken,
            expires: tokenResult.expires,
          }
          console.log(`✅ OAuth2 authorization successful!`)
        } catch (err: any) {
          console.error(`❌ OAuth2 authorization failed: ${err.message}`)
          process.exit(1)
        }

        // OAuth2 accounts don't need manual smtp/imap; template auto-fills them
      } else if (template?.authType === 'password') {
        // ── Authorization code flow (QQ / 163) ──
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'user',
            message: `Please enter your ${provider === 'qq' ? 'QQ' : '163'} email address: `,
            validate: (input: string) => (input.trim() ? true : 'Email address cannot be empty'),
          },
          {
            type: 'password',
            name: 'pass',
            message: 'Please enter authorization code (not your email password): ',
            mask: '*',
            validate: (input: string) => (input.trim() ? true : 'Authorization code cannot be empty'),
          },
        ])
        user = answers.user
        pass = answers.pass

        // Template accounts don't need manual smtp/imap
      } else if (provider === 'smtp-imap') {
        // ── Custom SMTP/IMAP flow (enterprise private email) ──
        network = 'private'

        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'user',
            message: 'Email address: ',
            validate: (input: string) => (input.trim() ? true : 'Email address cannot be empty'),
          },
          {
            type: 'password',
            name: 'pass',
            message: '密码：',
            mask: '*',
          },
          {
            type: 'input',
            name: 'smtpHost',
            message: 'SMTP 服务器地址（如 mail.company.com）：',
          },
          {
            type: 'input',
            name: 'smtpPort',
            message: 'SMTP 端口（465=SSL, 587=STARTTLS, 25=明文）：',
            default: '465',
          },
          {
            type: 'input',
            name: 'imapHost',
            message: 'IMAP 服务器地址：',
          },
          {
            type: 'input',
            name: 'imapPort',
            message: 'IMAP 端口（993=SSL, 143=明文）：',
            default: '993',
          },
          {
            type: 'confirm',
            name: 'rejectUnauthorized',
            message: '是否允许自签名证书？',
            default: true,
          },
        ])

        user = answers.user
        pass = answers.pass
        smtpConfig = {
          host: answers.smtpHost || undefined,
          port: answers.smtpPort ? parseInt(answers.smtpPort) : undefined,
          rejectUnauthorized: answers.rejectUnauthorized ? false : undefined,
        }
        imapConfig = {
          host: answers.imapHost || undefined,
          port: answers.imapPort ? parseInt(answers.imapPort) : undefined,
          rejectUnauthorized: answers.rejectUnauthorized ? false : undefined,
        }
      }

      // 4. 创建账号配置
      const newAccount: AccountConfig = {
        id: uuidv7(),
        alias,
        purpose,
        isDefault,
        provider,
        network,
        user,
        pass,
        oauth2,
        apiKey,
        inboxId,
        smtp: smtpConfig,
        imap: imapConfig,
      }

      // 如果设置为默认，取消其他账号的默认标记
      if (isDefault) {
        accounts.forEach((a) => {
          if (a.alias !== alias) a.isDefault = false
        })
      }

      // 相同邮箱地址覆盖已有账号，而非新建重复条目
      const existingIndex = accounts.findIndex((a) => a.user === user)
      if (existingIndex >= 0) {
        newAccount.id = accounts[existingIndex].id
        accounts[existingIndex] = newAccount
        console.log(`\n🔄 已更新账号 "${alias}"（${user}）`)
      } else {
        accounts.push(newAccount)
        console.log(`\n✅ 已成功添加账号 "${alias}"`)
      }

      // 保存配置（config.yaml + credentials.yaml 分离存储）
      saveConfig({ accounts, defaultAccount: accounts.find((a) => a.isDefault)?.alias }, opts.config)

      if (isDefault) {
        console.log(`   已设置为默认邮箱`)
      }
      console.log(`   配置文件：~/.mail-agent/config.yaml`)
      console.log(`   凭据文件：~/.mail-agent/credentials.yaml`)

      // 添加成功后，询问后续操作（传入刚添加的别名）
      await promptNextAction(opts.config, alias)
    })

  // ── account list ──
  accountCmd
    .command('list')
    .description('列出已配置的邮箱账号的邮件')
    .option('--config <path>', '配置文件路径')
    .action((opts) => {
      const config = loadConfig(opts.config)
      if (config.accounts.length === 0) {
        console.log('📭 未配置任何邮箱账号')
        console.log('   请先运行: ma init 或 ma account add')
        return
      }
      const t = new Table()
      t.header(['别名', '类型', '邮箱地址', '认证方式', ''])
      t.colWidths([12, 12, 30, 10, 8])
      for (const a of config.accounts) {
        const def = a.isDefault ? '⭐ 默认' : ''
        const authLabelMap: Record<string, string> = {
          oauth2: 'OAuth2',
          'agently-cli': 'CLI代理',
          'lark-cli': 'CLI代理',
          'api-key': 'API Key',
          password: '密码',
          unconfigured: '未配置',
        }
        const authLabel = authLabelMap[getAuthLabel(a)] || getAuthLabel(a)
        t.row([a.alias, a.provider, a.user || '-', authLabel, def])
      }
      console.log(t.render())
    })

  // ── account remove ──
  accountCmd
    .command('remove <alias>')
    .description('删除指定邮箱账号')
    .option('--config <path>', '配置文件路径')
    .option('-y, --yes', '跳过确认提示')
    .action(async (alias, opts) => {
      const config = loadConfig(opts.config)
      const account = config.accounts.find((a) => a.alias === alias)
      if (!account) {
        console.error(`❌ 未找到账号 "${alias}"`)
        process.exit(1)
      }

      // 非 --yes 模式下需要确认
      if (!opts.yes) {
        const { confirmed } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirmed',
            message: `确认删除账号 "${account.alias}" (${account.user})？此操作不可撤销`,
            default: false,
          },
        ])
        if (!confirmed) {
          console.log('已取消')
          return
        }
      }

      removeAccount(account.id, opts.config)
      console.log(`✅ 已删除账号 "${account.alias}"`)
    })

  // ── account rename ──
  accountCmd
    .command('rename <alias> <newAlias>')
    .description('修改账号别名')
    .option('--config <path>', '配置文件路径')
    .action((alias, newAlias, opts) => {
      const config = loadConfig(opts.config)
      const account = config.accounts.find((a) => a.alias === alias)
      if (!account) {
        console.error(`❌ 未找到账号 "${alias}"`)
        process.exit(1)
      }
      if (config.accounts.find((a) => a.alias === newAlias)) {
        console.error(`❌ 别名 "${newAlias}" 已存在`)
        process.exit(1)
      }
      account.alias = newAlias
      saveConfig(config, opts.config)
      console.log(`✅ 已将 "${alias}" 重命名为 "${newAlias}"`)
    })

  // ── account test ──
  accountCmd
    .command('test <alias>')
    .description('测试邮箱账号连接是否正常')
    .option('--config <path>', '配置文件路径')
    .action(async (alias, opts) => {
      const config = loadConfig(opts.config)
      const account = getAccount(config, alias)
      if (!account) {
        console.error(`❌ 未找到账号 "${alias}"`)
        process.exit(1)
      }

      console.log(`🔍 正在测试账号 "${account.alias}"...`)

      // 不先调用 connect()，直接用 healthCheck() 做独立诊断
      // healthCheck() 会自行建立/断开连接
      let provider: MailProvider | null = null
      try {
        provider = createProvider(account)
        await provider.connect(account)

        const status = await provider.healthCheck()
        const d = status.diagnostics

        if (status.connected) {
          console.log(`✅ 连接成功！`)
        } else {
          console.log(`⚠️  连接异常`)
        }

        // SMTP/IMAP 诊断
        if (d?.smtp) {
          const icon = d.smtp.connected ? '✅' : '❌'
          console.log(
            `   ${icon} SMTP: ${d.smtp.host}:${d.smtp.port} (${d.smtp.secure ? 'SSL/TLS' : '明文'}, ${d.smtp.authMethod})${d.smtp.connected ? ` — ${d.smtp.latencyMs}ms` : ''}`,
          )
          if (d.smtp.error) {
            console.log(`      错误: ${d.smtp.error}`)
            console.log(`      建议: ${suggestFix(account, 'smtp', d.smtp.error)}`)
          }
        }
        if (d?.imap) {
          const icon = d.imap.connected ? '✅' : '❌'
          console.log(
            `   ${icon} IMAP: ${d.imap.host}:${d.imap.port} (${d.imap.secure ? 'SSL/TLS' : '明文'}, ${d.imap.authMethod})${d.imap.connected ? ` — ${d.imap.latencyMs}ms` : ''}`,
          )
          if (d.imap.error) {
            console.log(`      错误: ${d.imap.error}`)
            console.log(`      建议: ${suggestFix(account, 'imap', d.imap.error)}`)
          }
        }

        // API 诊断（Gmail API / Agently）
        if (d?.api) {
          const icon = d.api.connected ? '✅' : '❌'
          console.log(
            `   ${icon} API: ${d.api.host} (${d.api.authMethod})${d.api.connected ? ` — ${d.api.latencyMs}ms` : ''}`,
          )
          if (d.api.error) {
            console.log(`      错误: ${d.api.error}`)
            console.log(`      建议: ${suggestFix(account, 'api', d.api.error)}`)
          }
        }
        if (d?.cli) {
          const icon = d.cli.connected ? '✅' : '❌'
          const cliName = account.provider === 'lark' ? 'lark-cli' : 'agently-cli'
          console.log(`   ${icon} CLI: ${cliName} (${d.cli.authMethod})`)
          if (d.cli.error) {
            const fixCmd = account.provider === 'lark' ? 'lark-cli auth login --domain mail' : 'agently-cli auth login'
            console.log(`      错误: ${d.cli.error}`)
            console.log(`      建议: 请运行 ${fixCmd} 重新授权`)
          }
        }

        // OAuth2 诊断
        if (d?.oauth2) {
          const icon = d.oauth2.isExpired ? '⚠️' : '✅'
          const expiry = d.oauth2.tokenExpiry ? ` (过期时间: ${d.oauth2.tokenExpiry})` : ''
          console.log(`   ${icon} OAuth2: ${d.oauth2.isExpired ? 'token 已过期，需刷新' : 'token 有效'}${expiry}`)
        }

        // 尝试获取最近邮件
        if (status.connected) {
          try {
            const mails = await provider.fetch({ limit: 1 })
            if (mails.length > 0) {
              console.log(`   📨 最近邮件: ${mails[0].subject}`)
            } else {
              console.log('   📭 收件箱为空')
            }
          } catch {
            console.log('   （无法读取最近邮件）')
          }
        }
      } catch (err: any) {
        console.error(`❌ 测试失败：${err.message}`)
        console.error(`   建议: ${suggestFix(account, 'general', err.message)}`)
        process.exit(1)
      } finally {
        if (provider) {
          try {
            await provider.disconnect()
          } catch {}
        }
      }
    })

  // ── account set-default ──
  accountCmd
    .command('set-default <alias>')
    .description('设置默认邮箱账号')
    .option('--config <path>', '配置文件路径')
    .action((alias, opts) => {
      const config = loadConfig(opts.config)
      const account = getAccount(config, alias)
      if (!account) {
        console.error(`❌ 未找到账号 "${alias}"`)
        process.exit(1)
      }
      config.accounts.forEach((a) => {
        a.isDefault = a.alias === alias
      })
      saveConfig(config, opts.config)
      console.log(`✅ 已将 "${alias}" 设置为默认邮箱`)
    })

  // ── account encrypt ──
  accountCmd
    .command('encrypt')
    .description('加密 credentials.yaml（AES-256-GCM）')
    .action(async () => {
      if (isCredentialsEncrypted()) {
        console.log('ℹ️  凭证文件已加密，无需重复操作')
        return
      }
      // 提示输入主密码
      const answers = await inquirer.prompt([
        {
          type: 'password',
          name: 'password',
          message: '🔐 请设置主密码（用于加密凭证）：',
          mask: '*',
          validate: (input: string) => (input.length >= 6 ? true : '主密码至少 6 个字符'),
        },
        {
          type: 'password',
          name: 'confirm',
          message: '🔐 请再次输入主密码确认：',
          mask: '*',
        },
      ])
      if (answers.password !== answers.confirm) {
        console.error('❌ 两次输入的密码不一致')
        process.exit(1)
      }
      setMasterPassword(answers.password)
      try {
        encryptCredentialFile(answers.password)
        console.log('✅ credentials.yaml 已加密')
        console.log('   后续使用 ma 命令时需输入主密码或设置 MAIL_AGENT_MASTER_PASSWORD 环境变量')
      } catch (err: any) {
        console.error(`❌ 加密失败：${err.message}`)
        process.exit(1)
      }
    })

  // ── account decrypt ──
  accountCmd
    .command('decrypt')
    .description('解密 credentials.yaml 回明文')
    .action(async () => {
      if (!isCredentialsEncrypted()) {
        console.log('ℹ️  凭证文件未加密，无需解密')
        return
      }
      const answers = await inquirer.prompt([
        {
          type: 'password',
          name: 'password',
          message: '🔐 请输入主密码：',
          mask: '*',
        },
      ])
      setMasterPassword(answers.password)
      try {
        decryptCredentialFile(answers.password)
        console.log('✅ credentials.yaml 已解密为明文')
      } catch (err: any) {
        console.error(`❌ 解密失败：${err.message}`)
        process.exit(1)
      }
    })

  program.addCommand(accountCmd)
}

/**
 * 添加账号成功后的后续操作循环
 * 让用户选择继续添加、测试连接、查看账号列表或退出
 *
 * 使用 while 循环而非递归，避免 inquirer select 在递归调用时
 * 因 stdin 缓冲区残留（子进程输出、终端控制字符）被自动确认
 */
async function promptNextAction(configPath?: string, justAddedAlias?: string): Promise<void> {
  let defaultAction = 'test'

  while (true) {
    // 如果刚添加了账号，提示语体现出来
    const justAdded = justAddedAlias ? `"${justAddedAlias}"` : ''
    const choices = [
      { name: '➕ 继续添加其他邮箱', value: 'add' },
      { name: justAddedAlias ? `🔍 测试刚添加的邮箱 ${justAddedAlias}` : '🔍 测试邮箱连接', value: 'test' },
      { name: '📋 查看所有已配置账号', value: 'list' },
      { name: '👋 完成，退出', value: 'exit' },
    ]

    const { action } = await inquirer.prompt([
      {
        type: 'select',
        name: 'action',
        message: '接下来你想做什么？',
        default: defaultAction,
        choices,
      },
    ])

    if (action === 'exit') {
      return
    }

    if (action === 'add') {
      // 通过 execFileSync 重新运行 account add（共享 stdio 以支持交互）
      try {
        const args = ['account', 'add']
        if (configPath) args.push('--config', configPath)
        execFileSync('ma', args, { stdio: 'inherit' })
      } catch {}
      return
    }

    if (action === 'test') {
      const config = loadConfig(configPath)
      if (config.accounts.length === 0) {
        console.log('📭 没有可测试的账号')
        defaultAction = 'test'
        continue
      }

      // 首次测试直接测刚添加的账号，后续循环再让用户选择
      let testAlias = justAddedAlias
      justAddedAlias = undefined // 只用一次

      if (!testAlias) {
        const { selectedAlias } = await inquirer.prompt([
          {
            type: 'select',
            name: 'selectedAlias',
            message: '选择要测试的账号：',
            choices: config.accounts.map((a) => ({
              name: `${a.alias} (${a.provider} / ${a.user || '?'})${a.isDefault ? ' ★默认' : ''}`,
              value: a.alias,
            })),
          },
        ])
        testAlias = selectedAlias
      }

      console.log(`\n🔍 正在测试账号 "${testAlias}"...`)
      const account = getAccount(config, testAlias)
      if (!account) {
        console.error(`❌ 未找到账号 "${testAlias}"`)
      } else {
        let provider: MailProvider | null = null
        try {
          provider = createProvider(account)
          await provider.connect(account)
          const status = await provider.healthCheck()
          const d = status.diagnostics

          if (status.connected) {
            console.log(`✅ 连接成功！`)
          } else {
            console.log(`⚠️  连接异常`)
          }

          // 简要诊断输出
          if (d?.smtp) {
            const icon = d.smtp.connected ? '✅' : '❌'
            console.log(
              `   ${icon} SMTP: ${d.smtp.host}:${d.smtp.port}${d.smtp.connected ? ` (${d.smtp.latencyMs}ms)` : ''}`,
            )
            if (d.smtp.error) console.log(`      → ${suggestFix(account, 'smtp', d.smtp.error)}`)
          }
          if (d?.imap) {
            const icon = d.imap.connected ? '✅' : '❌'
            console.log(
              `   ${icon} IMAP: ${d.imap.host}:${d.imap.port}${d.imap.connected ? ` (${d.imap.latencyMs}ms)` : ''}`,
            )
            if (d.imap.error) console.log(`      → ${suggestFix(account, 'imap', d.imap.error)}`)
          }
          if (d?.api) {
            const icon = d.api.connected ? '✅' : '❌'
            console.log(`   ${icon} API: ${d.api.host}${d.api.connected ? ` (${d.api.latencyMs}ms)` : ''}`)
            if (d.api.error) console.log(`      → ${suggestFix(account, 'api', d.api.error)}`)
          }
          if (d?.cli) {
            const icon = d.cli.connected ? '✅' : '❌'
            console.log(`   ${icon} CLI: agently-cli`)
            if (d.cli.error) console.log(`      → 请运行 agently-cli auth login 重新授权`)
          }
          if (d?.oauth2) {
            const icon = d.oauth2.isExpired ? '⚠️' : '✅'
            console.log(`   ${icon} OAuth2: ${d.oauth2.isExpired ? 'token 已过期' : 'token 有效'}`)
          }
        } catch (err: any) {
          console.error(`❌ 连接失败：${err.message}`)
        } finally {
          if (provider) {
            try {
              await provider.disconnect()
            } catch {}
          }
        }
      }

      // 测试完成后循环回到菜单（默认选中"测试"以便连续测试多个账号）
      defaultAction = 'test'
      continue
    }

    if (action === 'list') {
      const config = loadConfig(configPath)
      if (config.accounts.length === 0) {
        console.log('📭 未配置任何邮箱账号')
      } else {
        console.log('已配置邮箱账号：')
        for (const a of config.accounts) {
          const def = a.isDefault ? ' (默认)' : ''
          const authLabelMap2: Record<string, string> = {
            oauth2: 'OAuth2',
            'agently-cli': 'CLI代理',
            'lark-cli': 'CLI代理',
            'api-key': 'API Key',
            password: '密码',
            unconfigured: '未配置',
          }
          const authLabel = authLabelMap2[getAuthLabel(a)] || getAuthLabel(a)
          console.log(`  ${a.alias}${def} - ${a.provider} / ${a.user} [${authLabel}]`)
        }
      }

      // 列出后循环回到菜单
      defaultAction = 'list'
      continue
    }
  }
}

/**
 * 根据错误信息给出可操作的修复建议
 */
function suggestFix(account: AccountConfig, protocol: string, errorMessage: string): string {
  const msg = errorMessage.toLowerCase()

  // 认证失败
  if (msg.includes('e1002') || msg.includes('auth') || msg.includes('login') || msg.includes('credentials')) {
    if (account.provider === 'lark') {
      return 'Lark Mail 认证失败，请运行 lark-cli auth login --domain mail 重新授权'
    }
    if (account.provider === 'qq' || account.provider === '163') {
      return '授权码错误，请确认已在邮箱设置中开启 SMTP/IMAP 服务并获取授权码（非邮箱密码）'
    }
    if (isOAuth2Account(account)) {
      return 'OAuth2 认证失败，请重新运行 ma account add 授权'
    }
    return '认证失败，请检查密码或授权码是否正确'
  }

  // 连接失败
  if (msg.includes('e1001') || msg.includes('econnrefused') || msg.includes('etimedout') || msg.includes('enotfound')) {
    return '无法连接服务器，请检查网络和服务器地址/端口是否正确'
  }

  // TLS 错误
  if (msg.includes('e1003') || msg.includes('tls') || msg.includes('ssl') || msg.includes('certificate')) {
    return 'TLS/SSL 错误，企业邮箱可尝试允许自签名证书（account add 时选择允许）'
  }

  // 限流
  if (msg.includes('e3001') || msg.includes('rate') || msg.includes('429') || msg.includes('451')) {
    return '服务器限流，请稍后重试'
  }

  // 通用建议
  return '请检查网络连接和账号配置'
}

/**
 * 判断是否为 OAuth2 账号（简化版，避免从 @mail-agent/core 导入）
 */
function isOAuth2Account(account: AccountConfig): boolean {
  return !!account.oauth2
}
