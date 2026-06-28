import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * CLI 包 - 端到端集成测试
 * 通过实际执行 ma 命令来测试 CLI 行为
 */

const TEST_HOME = join(homedir(), '.mail-agent-e2e-test')
const CONFIG_DIR = join(TEST_HOME, '.mail-agent')
const CONFIG_PATH = join(CONFIG_DIR, 'config.yaml')

function setupTestConfig(yaml: string) {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }
  writeFileSync(CONFIG_PATH, yaml, 'utf-8')
}

function cleanup() {
  if (existsSync(TEST_HOME)) {
    rmSync(TEST_HOME, { recursive: true, force: true })
  }
  delete process.env.HOME
  delete process.env.MAIL_AGENT_CONFIG
}

// 获取 CLI 包的 dist 目录
const CLI_DIST = join(__dirname, '..', 'dist')
const PROJECT_ROOT = join(__dirname, '..', '..')

describe('ma CLI - 端到端测试', () => {
  beforeEach(() => {
    process.env.HOME = TEST_HOME
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true })
    }
  })

  afterEach(() => {
    cleanup()
  })

  it('+me 在没有配置时应返回未配置提示', () => {
    const output = execSync(`node index.mjs +me`, {
      cwd: CLI_DIST,
      encoding: 'utf-8',
      env: { ...process.env, HOME: TEST_HOME },
    })
    expect(output).toContain('No email accounts configured')
  })

  it('+me 在有配置时应显示账号列表', () => {
    const yaml = `
accounts:
  - alias: test-qq
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
    setupTestConfig(yaml)

    const output = execSync(`node index.mjs +me`, {
      cwd: CLI_DIST,
      encoding: 'utf-8',
      env: { ...process.env, HOME: TEST_HOME },
    })
    expect(output).toContain('test-qq')
    expect(output).toContain('smtp-im')
  })

  it('list 在没有配置时应返回未配置提示', () => {
    // list 命令在找不到账号时会 process.exit(1)，输出到 stderr
    try {
      execSync(`node index.mjs list`, {
        cwd: CLI_DIST,
        encoding: 'utf-8',
        env: { ...process.env, HOME: TEST_HOME },
        stdio: 'pipe',
      })
      // 如果不抛错，检查输出
    } catch (err: any) {
      const combined = (err.stdout?.toString() || '') + (err.stderr?.toString() || '')
      expect(combined).toContain('No email accounts configured')
    }
  })

  it('send 缺少必要选项时应报错', () => {
    try {
      execSync(`node index.mjs send`, {
        cwd: CLI_DIST,
        encoding: 'utf-8',
        env: { ...process.env, HOME: TEST_HOME },
        stdio: 'pipe',
      })
      expect(true).toBe(false) // 不应该到达这里
    } catch (err: any) {
      const combined = (err.stdout?.toString() || '') + (err.stderr?.toString() || '')
      expect(combined).toContain('--to')
    }
  })

  it('应该能打印帮助信息', () => {
    const output = execSync(`node index.mjs --help`, {
      cwd: CLI_DIST,
      encoding: 'utf-8',
      env: { ...process.env, HOME: TEST_HOME },
    })
    expect(output).toContain('ma')
    expect(output).toContain('send')
    expect(output).toContain('list')
    expect(output).toContain('read')
    expect(output).toContain('search')
  })

  it('应该能打印版本信息', () => {
    const output = execSync(`node index.mjs --version`, {
      cwd: CLI_DIST,
      encoding: 'utf-8',
      env: { ...process.env, HOME: TEST_HOME },
    })
    // 动态读取当前版本号，避免硬编码
    const cliPkgPath = join(CLI_DIST, '..', 'package.json')
    const pkg = JSON.parse(readFileSync(cliPkgPath, 'utf-8'))
    expect(output.trim()).toBe(pkg.version)
  })
})
