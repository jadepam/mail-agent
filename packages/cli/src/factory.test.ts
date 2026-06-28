import { describe, it, expect } from 'vitest'
import { createProvider } from './factory.js'
import { SmtpImapProvider } from '@mail-agent/provider-smtp'
import { AgentlyProvider } from '@mail-agent/provider-agently'
import { GmailApiProvider } from '@mail-agent/provider-gmail-api'
import type { AccountConfig } from '@mail-agent/core'

/**
 * CLI 包 - Factory 单元测试
 */

function makeTestConfig(overrides: Partial<AccountConfig> = {}): AccountConfig {
  return {
    id: 'acc_factory_test',
    alias: '测试账号',
    purpose: 'testing',
    isDefault: true,
    provider: 'smtp-imap',
    network: 'public',
    user: 'test@test.com',
    ...overrides,
  }
}

describe('createProvider', () => {
  it('应该为 smtp-imap 创建 SmtpImapProvider', () => {
    const config = makeTestConfig()
    const provider = createProvider(config)

    // 检查类型名称而非 instanceof（跨包构建后 instanceof 可能失效）
    expect(provider.constructor.name).toBe('SmtpImapProvider')
  })

  it('应该为 agently 创建 AgentlyProvider', () => {
    const config = makeTestConfig({ provider: 'agently' })
    const provider = createProvider(config)
    expect(provider.constructor.name).toBe('AgentlyProvider')
  })

  it('应该为 gmail 创建 GmailApiProvider', () => {
    const config = makeTestConfig({ provider: 'gmail' })
    const provider = createProvider(config)
    expect(provider.constructor.name).toBe('GmailApiProvider')
  })

  it('应该为 qq 创建 SmtpImapProvider', () => {
    const config = makeTestConfig({ provider: 'qq' })
    const provider = createProvider(config)
    expect(provider.constructor.name).toBe('SmtpImapProvider')
  })

  it('应该为未知 provider 类型抛出错误', () => {
    const config = makeTestConfig({ provider: 'unknown-type' as any })
    expect(() => createProvider(config)).toThrow('不支持的邮箱类型')
  })

  it('应该为 outlook 创建 SmtpImapProvider', () => {
    const config = makeTestConfig({ provider: 'outlook' })
    const provider = createProvider(config)
    expect(provider.constructor.name).toBe('SmtpImapProvider')
  })

  it('应该为 163 创建 SmtpImapProvider', () => {
    const config = makeTestConfig({ provider: '163' })
    const provider = createProvider(config)
    expect(provider.constructor.name).toBe('SmtpImapProvider')
  })

  it('应该为不同网络类型创建相同的 provider 类型', () => {
    const publicConfig = makeTestConfig({ network: 'public' })
    const privateConfig = makeTestConfig({ network: 'private' })

    const publicProvider = createProvider(publicConfig)
    const privateProvider = createProvider(privateConfig)

    expect(publicProvider.constructor.name).toBe('SmtpImapProvider')
    expect(privateProvider.constructor.name).toBe('SmtpImapProvider')
  })
})
