import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { loadConfig, getAccount, saveConfig } from './config.js'

/**
 * CLI 包 - 配置加载单元测试
 */

describe('loadConfig', () => {
  const testDir = join(homedir(), '.mail-agent-test')
  const testConfigPath = join(testDir, 'config.yaml')

  beforeEach(() => {
    // 清理测试目录
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
    // 清除环境变量
    delete process.env.MAIL_AGENT_CONFIG
  })

  it('应该在配置文件不存在时返回空账户列表', () => {
    const config = loadConfig('/nonexistent/path.yaml')
    expect(config.accounts).toEqual([])
    expect(config.defaultAccount).toBeUndefined()
  })

  it('应该能加载基本的 SMTP 配置', () => {
    const yaml = `
accounts:
  - alias: qq邮箱
    purpose: daily
    is_default: true
    provider: smtp-imap
    network: public
    smtp:
      host: smtp.qq.com
      port: 465
      secure: true
      user: 123456@qq.com
      pass: authcode
    imap:
      host: imap.qq.com
      port: 993
      tls: true
      user: 123456@qq.com
      pass: authcode
`
    writeFileSync(testConfigPath, yaml, 'utf-8')
    const config = loadConfig(testConfigPath)

    expect(config.accounts).toHaveLength(1)
    expect(config.accounts[0].alias).toBe('qq邮箱')
    expect(config.accounts[0].isDefault).toBe(true)
    expect(config.accounts[0].provider).toBe('smtp-imap')
    expect(config.accounts[0].network).toBe('public')
    expect(config.accounts[0].smtp?.host).toBe('smtp.qq.com')
    expect(config.accounts[0].smtp?.port).toBe(465)
    expect(config.accounts[0].smtp?.secure).toBe(true)
    expect(config.accounts[0].imap?.host).toBe('imap.qq.com')
    expect(config.defaultAccount).toBe('qq邮箱')
  })

  it('应该支持私有化邮箱配置', () => {
    const yaml = `
accounts:
  - alias: 企业邮箱
    purpose: work
    is_default: false
    provider: smtp-imap
    network: private
    smtp:
      host: mail.internal.corp
      port: 465
      secure: true
      user: zhangsan@corp.com
      pass: password
      reject_unauthorized: false
    imap:
      host: mail.internal.corp
      port: 993
      tls: true
      user: zhangsan@corp.com
      pass: password
      reject_unauthorized: false
`
    writeFileSync(testConfigPath, yaml, 'utf-8')
    const config = loadConfig(testConfigPath)

    expect(config.accounts).toHaveLength(1)
    expect(config.accounts[0].network).toBe('private')
    expect(config.accounts[0].smtp?.rejectUnauthorized).toBe(false)
    expect(config.accounts[0].imap?.rejectUnauthorized).toBe(false)
  })

  it('应该支持多账号配置', () => {
    const yaml = `
accounts:
  - alias: qq邮箱
    purpose: daily
    is_default: true
    provider: smtp-imap
    network: public
    smtp:
      host: smtp.qq.com
      port: 465
      secure: true
      user: 123456@qq.com
      pass: authcode
    imap:
      host: imap.qq.com
      port: 993
      tls: true
      user: 123456@qq.com
      pass: authcode
  - alias: 工作邮箱
    purpose: work
    is_default: false
    provider: smtp-imap
    network: public
    smtp:
      host: smtp.company.com
      port: 587
      secure: false
      user: user@company.com
      pass: password
    imap:
      host: imap.company.com
      port: 993
      tls: true
      user: user@company.com
      pass: password
`
    writeFileSync(testConfigPath, yaml, 'utf-8')
    const config = loadConfig(testConfigPath)

    expect(config.accounts).toHaveLength(2)
    expect(config.accounts[0].alias).toBe('qq邮箱')
    expect(config.accounts[1].alias).toBe('工作邮箱')
    expect(config.defaultAccount).toBe('qq邮箱')
  })

  it('应该支持从环境变量读取配置路径', () => {
    const yaml = `
accounts:
  - alias: env测试
    purpose: test
    is_default: true
    provider: smtp-imap
    network: public
    smtp:
      host: smtp.test.com
      port: 465
      secure: true
      user: test@test.com
      pass: test
    imap:
      host: imap.test.com
      port: 993
      tls: true
      user: test@test.com
      pass: test
`
    writeFileSync(testConfigPath, yaml, 'utf-8')
    process.env.MAIL_AGENT_CONFIG = testConfigPath
    const config = loadConfig()

    expect(config.accounts).toHaveLength(1)
    expect(config.accounts[0].alias).toBe('env测试')
  })

  it('应该处理缺少 SMTP 或 IMAP 配置的情况', () => {
    const yaml = `
accounts:
  - alias: 不完整配置
    purpose: test
    is_default: true
    provider: smtp-imap
    network: public
    smtp:
      host: smtp.test.com
      port: 465
      secure: true
      user: test@test.com
      pass: test
`
    writeFileSync(testConfigPath, yaml, 'utf-8')
    const config = loadConfig(testConfigPath)

    expect(config.accounts).toHaveLength(1)
    expect(config.accounts[0].smtp).toBeDefined()
    expect(config.accounts[0].imap).toBeUndefined()
  })

  it('should use first account as default when no is_default', () => {
    const yaml = `
accounts:
  - alias: 默认第一个
    purpose: test
    provider: smtp-imap
    network: public
    smtp:
      host: smtp.test.com
      port: 465
      secure: true
      user: test@test.com
      pass: test
    imap:
      host: imap.test.com
      port: 993
      tls: true
      user: test@test.com
      pass: test
`
    writeFileSync(testConfigPath, yaml, 'utf-8')
    const config = loadConfig(testConfigPath)

    expect(config.accounts).toHaveLength(1)
    expect(config.accounts[0].isDefault).toBe(true)
    expect(config.defaultAccount).toBe('默认第一个')
  })
})

describe('getAccount', () => {
  const testDir = join(homedir(), '.mail-agent-test')
  const testConfigPath = join(testDir, 'config.yaml')

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
    mkdirSync(testDir, { recursive: true })

    const yaml = `
accounts:
  - alias: qq邮箱
    purpose: daily
    is_default: true
    provider: smtp-imap
    network: public
    smtp:
      host: smtp.qq.com
      port: 465
      secure: true
      user: 123456@qq.com
      pass: authcode
    imap:
      host: imap.qq.com
      port: 993
      tls: true
      user: 123456@qq.com
      pass: authcode
  - alias: 工作邮箱
    purpose: work
    is_default: false
    provider: smtp-imap
    network: private
    smtp:
      host: mail.corp.com
      port: 465
      secure: true
      user: user@corp.com
      pass: password
    imap:
      host: mail.corp.com
      port: 993
      tls: true
      user: user@corp.com
      pass: password
`
    writeFileSync(testConfigPath, yaml, 'utf-8')
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('应该通过别名查找账号', () => {
    const config = loadConfig(testConfigPath)
    const account = getAccount(config, '工作邮箱')
    expect(account).toBeDefined()
    expect(account?.alias).toBe('工作邮箱')
    expect(account?.network).toBe('private')
  })

  it('应该返回默认账号当 alias 为空', () => {
    const config = loadConfig(testConfigPath)
    const account = getAccount(config)
    expect(account).toBeDefined()
    expect(account?.alias).toBe('qq邮箱')
  })

  it('当找不到指定别名时应返回 undefined', () => {
    const config = loadConfig(testConfigPath)
    const account = getAccount(config, '不存在的账号')
    expect(account).toBeUndefined()
  })
})

// ── 企业自建邮配置加载专项测试 ──

describe('loadConfig - 企业自建邮场景', () => {
  const testDir = join(homedir(), '.mail-agent-test-corp')
  const testConfigPath = join(testDir, 'config.yaml')

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
    delete process.env.MAIL_AGENT_CONFIG
  })

  it('应该加载企业自建邮明文 SMTP（端口 25）配置', () => {
    const yaml = `
accounts:
  - alias: 内网明文SMTP
    purpose: work
    is_default: true
    provider: smtp-imap
    network: private
    smtp:
      host: mail.internal.corp
      port: 25
      secure: false
      user: admin@corp.com
      pass: password
      reject_unauthorized: false
    imap:
      host: mail.internal.corp
      port: 143
      tls: false
      user: admin@corp.com
      pass: password
      reject_unauthorized: false
`
    writeFileSync(testConfigPath, yaml, 'utf-8')
    const config = loadConfig(testConfigPath)

    expect(config.accounts).toHaveLength(1)
    const acc = config.accounts[0]
    expect(acc.provider).toBe('smtp-imap')
    expect(acc.network).toBe('private')
    expect(acc.smtp?.port).toBe(25)
    expect(acc.smtp?.secure).toBe(false)
    expect(acc.imap?.port).toBe(143)
    expect(acc.imap?.tls).toBe(false)
    expect(acc.smtp?.rejectUnauthorized).toBe(false)
    expect(acc.imap?.rejectUnauthorized).toBe(false)
  })

  it('应该加载企业自建邮 STARTTLS（端口 587）配置', () => {
    const yaml = `
accounts:
  - alias: 内网STARTTLS
    purpose: work
    is_default: true
    provider: smtp-imap
    network: private
    smtp:
      host: mail.corp.com
      port: 587
      secure: false
      user: user@corp.com
      pass: password
    imap:
      host: mail.corp.com
      port: 993
      tls: true
      user: user@corp.com
      pass: password
`
    writeFileSync(testConfigPath, yaml, 'utf-8')
    const config = loadConfig(testConfigPath)

    const acc = config.accounts[0]
    expect(acc.smtp?.port).toBe(587)
    expect(acc.smtp?.secure).toBe(false)
    expect(acc.imap?.port).toBe(993)
    expect(acc.imap?.tls).toBe(true)
  })

  it('应该加载 Outlook 邮箱配置', () => {
    const yaml = `
accounts:
  - alias: Outlook工作
    purpose: work
    is_default: true
    provider: outlook
    network: public
    smtp:
      host: smtp-mail.outlook.com
      port: 587
      secure: false
      user: user@outlook.com
      pass: password
    imap:
      host: outlook.office365.com
      port: 993
      tls: true
      user: user@outlook.com
      pass: password
`
    writeFileSync(testConfigPath, yaml, 'utf-8')
    const config = loadConfig(testConfigPath)

    const acc = config.accounts[0]
    expect(acc.provider).toBe('outlook')
    expect(acc.smtp?.host).toBe('smtp-mail.outlook.com')
    expect(acc.smtp?.port).toBe(587)
  })

  it('应该加载 163 邮箱配置', () => {
    const yaml = `
accounts:
  - alias: 163邮箱
    purpose: daily
    is_default: true
    provider: "163"
    network: public
    smtp:
      host: smtp.163.com
      port: 465
      secure: true
      user: user@163.com
      pass: authcode
    imap:
      host: imap.163.com
      port: 993
      tls: true
      user: user@163.com
      pass: authcode
`
    writeFileSync(testConfigPath, yaml, 'utf-8')
    const config = loadConfig(testConfigPath)

    const acc = config.accounts[0]
    expect(acc.provider).toBe('163')
    expect(acc.smtp?.host).toBe('smtp.163.com')
  })

  it('应该支持 reject_unauthorized YAML 键映射为 rejectUnauthorized', () => {
    const yaml = `
accounts:
  - alias: 自签名证书企业邮
    purpose: work
    is_default: true
    provider: smtp-imap
    network: private
    smtp:
      host: mail.selfsigned.corp
      port: 465
      secure: true
      user: admin@selfsigned.corp
      pass: password
      reject_unauthorized: false
    imap:
      host: mail.selfsigned.corp
      port: 993
      tls: true
      user: admin@selfsigned.corp
      pass: password
      reject_unauthorized: false
`
    writeFileSync(testConfigPath, yaml, 'utf-8')
    const config = loadConfig(testConfigPath)

    const acc = config.accounts[0]
    expect(acc.smtp?.rejectUnauthorized).toBe(false)
    expect(acc.imap?.rejectUnauthorized).toBe(false)
  })
})

// ── mode 字段（Human Mode / AI Mode）测试 ──

describe('loadConfig - mode 字段', () => {
  const testDir = join(homedir(), '.mail-agent-test-mode')
  const testConfigPath = join(testDir, 'config.yaml')

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
    delete process.env.MAIL_AGENT_CONFIG
  })

  it('应该解析 mode: ai', () => {
    const yaml = `
mode: ai
accounts:
  - alias: test
    purpose: test
    is_default: true
    provider: smtp-imap
    network: public
    smtp:
      host: smtp.test.com
      port: 465
      secure: true
      user: t@t.com
      pass: test
    imap:
      host: imap.test.com
      port: 993
      tls: true
      user: t@t.com
      pass: test
`
    writeFileSync(testConfigPath, yaml, 'utf-8')
    const config = loadConfig(testConfigPath)
    expect(config.mode).toBe('ai')
  })

  it('应该解析 mode: human', () => {
    const yaml = `
mode: human
accounts:
  - alias: test
    purpose: test
    is_default: true
    provider: smtp-imap
    network: public
    smtp:
      host: smtp.test.com
      port: 465
      secure: true
      user: t@t.com
      pass: test
    imap:
      host: imap.test.com
      port: 993
      tls: true
      user: t@t.com
      pass: test
`
    writeFileSync(testConfigPath, yaml, 'utf-8')
    const config = loadConfig(testConfigPath)
    expect(config.mode).toBe('human')
  })

  it('mode 缺失时默认为 human', () => {
    const yaml = `
accounts:
  - alias: test
    purpose: test
    is_default: true
    provider: smtp-imap
    network: public
    smtp:
      host: smtp.test.com
      port: 465
      secure: true
      user: t@t.com
      pass: test
    imap:
      host: imap.test.com
      port: 993
      tls: true
      user: t@t.com
      pass: test
`
    writeFileSync(testConfigPath, yaml, 'utf-8')
    const config = loadConfig(testConfigPath)
    expect(config.mode).toBe('human')
  })

  it('mode 值无效时应视为 human', () => {
    const yaml = `
mode: invalid
accounts:
  - alias: test
    purpose: test
    is_default: true
    provider: smtp-imap
    network: public
    smtp:
      host: smtp.test.com
      port: 465
      secure: true
      user: t@t.com
      pass: test
    imap:
      host: imap.test.com
      port: 993
      tls: true
      user: t@t.com
      pass: test
`
    writeFileSync(testConfigPath, yaml, 'utf-8')
    const config = loadConfig(testConfigPath)
    expect(config.mode).toBe('human')
  })

  it('saveConfig 应持久化 mode: ai', () => {
    const yaml = `
accounts:
  - alias: test
    purpose: test
    is_default: true
    provider: smtp-imap
    network: public
    smtp:
      host: smtp.test.com
      port: 465
      secure: true
      user: t@t.com
      pass: test
    imap:
      host: imap.test.com
      port: 993
      tls: true
      user: t@t.com
      pass: test
`
    writeFileSync(testConfigPath, yaml, 'utf-8')
    let config = loadConfig(testConfigPath)
    expect(config.mode).toBe('human')

    // 切换到 ai 模式
    config.mode = 'ai'
    saveConfig(config, testConfigPath)

    // 重新加载确认持久化
    config = loadConfig(testConfigPath)
    expect(config.mode).toBe('ai')
  })

  it('saveConfig 持久化 mode: human 时不应写入 mode 字段', () => {
    const yaml = `
accounts:
  - alias: test
    purpose: test
    is_default: true
    provider: smtp-imap
    network: public
    smtp:
      host: smtp.test.com
      port: 465
      secure: true
      user: t@t.com
      pass: test
    imap:
      host: imap.test.com
      port: 993
      tls: true
      user: t@t.com
      pass: test
`
    writeFileSync(testConfigPath, yaml, 'utf-8')
    let config = loadConfig(testConfigPath)
    config.mode = 'human'
    saveConfig(config, testConfigPath)

    // 读取原始 YAML，human 模式不应写入 mode 字段
    const rawYaml = readFileSync(testConfigPath, 'utf-8')
    expect(rawYaml).not.toContain('mode:')
  })

  it('缺少 alias 字段应抛出错误', () => {
    writeFileSync(
      testConfigPath,
      `
accounts:
  - id: acc_0
    provider: smtp-imap
    smtp:
      host: smtp.test.com
      port: 465
    imap:
      host: imap.test.com
      port: 993
`,
      'utf-8',
    )
    expect(() => loadConfig(testConfigPath)).toThrow('alias')
  })

  it('不支持的 provider 应抛出错误', () => {
    writeFileSync(
      testConfigPath,
      `
accounts:
  - id: acc_0
    alias: test
    provider: yahoo
    smtp:
      host: smtp.yahoo.com
      port: 465
    imap:
      host: imap.yahoo.com
      port: 993
`,
      'utf-8',
    )
    expect(() => loadConfig(testConfigPath)).toThrow('unsupported provider')
  })

  it('YAML 格式错误应抛出友好错误', () => {
    writeFileSync(testConfigPath, '{{invalid yaml: [', 'utf-8')
    expect(() => loadConfig(testConfigPath)).toThrow('Failed to parse config file')
  })
})
