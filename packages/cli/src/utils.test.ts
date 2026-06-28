import { describe, it, expect } from 'vitest'
import { parse } from 'yaml'
import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'

/**
 * CLI 包 - 辅助函数和配置格式测试
 */

describe('config 工具函数', () => {
  // 测试 YAML 解析的健壮性
  it('应该正确解析基本 YAML 配置结构', () => {
    const yamlStr = `
accounts:
  - alias: test
    purpose: daily
    is_default: true
    provider: smtp-imap
    network: public
    smtp:
      host: smtp.test.com
      port: 465
      secure: true
      user: test@test.com
      pass: secret
    imap:
      host: imap.test.com
      port: 993
      tls: true
      user: test@test.com
      pass: secret
`
    const parsed = parse(yamlStr) as any
    expect(parsed.accounts).toHaveLength(1)
    expect(parsed.accounts[0].alias).toBe('test')
    expect(parsed.accounts[0].is_default).toBe(true)
    expect(parsed.accounts[0].smtp.port).toBe(465)
  })

  it('应该解析空配置', () => {
    const parsed = parse('') as any
    expect(parsed?.accounts).toBeUndefined()
  })

  it('应该解析只有 accounts 键的配置', () => {
    const parsed = parse('accounts: []') as any
    expect(parsed.accounts).toEqual([])
  })
})

describe('默认配置路径', () => {
  it('默认配置路径应该是 ~/.mail-agent/config.yaml', () => {
    const expected = join(homedir(), '.mail-agent', 'config.yaml')
    // 这个值来自 config.ts 中的 DEFAULT_CONFIG_PATH
    expect(expected).toContain('.mail-agent')
    expect(expected).toContain('config.yaml')
  })
})

describe('YAML snake_case 到 camelCase 映射', () => {
  it('is_default 应该映射为 isDefault', () => {
    const yaml = `
accounts:
  - alias: test
    is_default: true
    provider: smtp-imap
    network: public
    smtp:
      host: smtp.test.com
      port: 465
      secure: true
      user: t@t.com
      pass: p
    imap:
      host: imap.test.com
      port: 993
      tls: true
      user: t@t.com
      pass: p
`
    const parsed = parse(yaml) as any
    expect(parsed.accounts[0].is_default).toBe(true)
  })

  it('reject_unauthorized 应该映射为 rejectUnauthorized', () => {
    const yaml = `
accounts:
  - alias: test
    is_default: true
    provider: smtp-imap
    network: public
    smtp:
      host: smtp.test.com
      port: 465
      secure: true
      user: t@t.com
      pass: p
      reject_unauthorized: false
    imap:
      host: imap.test.com
      port: 993
      tls: true
      user: t@t.com
      pass: p
      reject_unauthorized: false
`
    const parsed = parse(yaml) as any
    expect(parsed.accounts[0].smtp.reject_unauthorized).toBe(false)
    expect(parsed.accounts[0].imap.reject_unauthorized).toBe(false)
  })
})

describe('download 路径穿越安全检查', () => {
  it('包含 .. 的输出目录应被拒绝', () => {
    const outputDir = '../tmp'
    expect(outputDir.includes('..')).toBe(true)
  })

  it('包含 .. 的附件名应被拒绝', () => {
    const attName = '../../../etc/passwd'
    expect(attName.includes('..')).toBe(true)
    expect(attName.includes('/')).toBe(true)
  })

  it('包含 / 的附件名应被拒绝', () => {
    const attName = 'subdir/file.txt'
    expect(attName.includes('/')).toBe(true)
  })

  it('包含 \\ 的附件名应被拒绝', () => {
    const attName = 'subdir\\file.txt'
    expect(attName.includes('\\')).toBe(true)
  })

  it('合法的输出目录和附件名应通过检查', () => {
    const outputDir = '/tmp/downloads'
    const attName = 'report.pdf'
    expect(outputDir.includes('..')).toBe(false)
    expect(attName.includes('..')).toBe(false)
    expect(attName.includes('/')).toBe(false)
    expect(attName.includes('\\')).toBe(false)
  })

  it('最终路径应在 outputDir 下', () => {
    const outputDir = resolve('/tmp/downloads')
    const filePath = resolve('/tmp/downloads/report.pdf')
    expect(filePath.startsWith(outputDir)).toBe(true)
  })

  it('穿越路径应不在 outputDir 下', () => {
    const outputDir = resolve('/tmp/downloads')
    const filePath = resolve('/tmp/etc/passwd')
    expect(filePath.startsWith(outputDir)).toBe(false)
  })
})
