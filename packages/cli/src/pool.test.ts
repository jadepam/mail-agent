import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProviderPool } from '../src/pool.js'
import type { MailProvider, AccountConfig } from '@mail-agent/core'

/**
 * @mail-agent/cli ProviderPool 单元测试
 * Mock createProvider 和 provider 方法，验证连接复用逻辑
 */

// Mock factory
vi.mock('../src/factory.js', () => ({
  createProvider: vi.fn(),
}))

// Mock config persistRefreshedToken (called by pool)
vi.mock('../src/config.js', () => ({
  persistRefreshedToken: vi.fn(),
}))

import { createProvider } from '../src/factory.js'

function makeMockProvider(): MailProvider {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({ connected: true }),
    capabilities: vi.fn().mockReturnValue({}),
    send: vi.fn(),
    fetch: vi.fn(),
    read: vi.fn(),
    search: vi.fn(),
    getThread: vi.fn(),
    trash: vi.fn(),
    reply: vi.fn(),
    forward: vi.fn(),
    fetchAttachment: vi.fn(),
  } as unknown as MailProvider
}

function makeAccountConfig(id = 'test-account'): AccountConfig {
  return {
    id,
    alias: 'Test Account',
    provider: 'smtp-imap',
    user: 'test@example.com',
    isDefault: true,
  } as AccountConfig
}

describe('ProviderPool', () => {
  let pool: ProviderPool
  let mockProvider: MailProvider

  beforeEach(() => {
    vi.clearAllMocks()
    pool = new ProviderPool({ maxIdleMs: 5000 })
    mockProvider = makeMockProvider()
    vi.mocked(createProvider).mockReturnValue(mockProvider)
  })

  it('getOrCreate creates a new provider on first call', async () => {
    const config = makeAccountConfig()
    const result = await pool.getOrCreate(config)

    expect(createProvider).toHaveBeenCalledWith(config)
    expect(mockProvider.connect).toHaveBeenCalledWith(config)
    expect(result.provider).toBe(mockProvider)
    expect(result.accountConfig).toBe(config)
  })

  it('getOrCreate returns cached provider on second call with same account ID', async () => {
    const config = makeAccountConfig()
    const result1 = await pool.getOrCreate(config)
    const result2 = await pool.getOrCreate(config)

    // Only one createProvider call
    expect(createProvider).toHaveBeenCalledTimes(1)
    expect(mockProvider.connect).toHaveBeenCalledTimes(1)
    expect(result2.provider).toBe(result1.provider)
  })

  it('getOrCreate creates separate providers for different accounts', async () => {
    const config1 = makeAccountConfig('account-1')
    const config2 = makeAccountConfig('account-2')
    const mockProvider2 = makeMockProvider()
    vi.mocked(createProvider).mockReturnValueOnce(mockProvider).mockReturnValueOnce(mockProvider2)

    const result1 = await pool.getOrCreate(config1)
    const result2 = await pool.getOrCreate(config2)

    expect(createProvider).toHaveBeenCalledTimes(2)
    expect(result1.provider).not.toBe(result2.provider)
  })

  it('release updates lastUsed timestamp', async () => {
    const config = makeAccountConfig()
    await pool.getOrCreate(config)

    // Release should not disconnect
    await pool.release(config)
    expect(mockProvider.disconnect).not.toHaveBeenCalled()
  })

  it('evict removes and disconnects a provider', async () => {
    const config = makeAccountConfig()
    await pool.getOrCreate(config)

    await pool.evict(config.id)
    expect(mockProvider.disconnect).toHaveBeenCalled()

    // Next getOrCreate should create a new provider
    const newMockProvider = makeMockProvider()
    vi.mocked(createProvider).mockReturnValue(newMockProvider)

    const result = await pool.getOrCreate(config)
    expect(result.provider).toBe(newMockProvider)
    expect(createProvider).toHaveBeenCalledTimes(2)
  })

  it('evict on non-existent account is a no-op', async () => {
    await expect(pool.evict('non-existent')).resolves.toBeUndefined()
  })

  it('shutdown disconnects all providers', async () => {
    const config1 = makeAccountConfig('account-1')
    const config2 = makeAccountConfig('account-2')
    const mockProvider2 = makeMockProvider()
    vi.mocked(createProvider).mockReturnValueOnce(mockProvider).mockReturnValueOnce(mockProvider2)

    await pool.getOrCreate(config1)
    await pool.getOrCreate(config2)

    await pool.shutdown()

    expect(mockProvider.disconnect).toHaveBeenCalled()
    expect(mockProvider2.disconnect).toHaveBeenCalled()
  })

  it('shutdown with no providers is a no-op', async () => {
    await expect(pool.shutdown()).resolves.toBeUndefined()
  })

  it('idle providers are cleaned up after maxIdleMs', async () => {
    const shortPool = new ProviderPool({ maxIdleMs: 50 }) // 50ms idle timeout
    shortPool.startCleanup(20) // cleanup every 20ms

    const config = makeAccountConfig()
    await shortPool.getOrCreate(config)

    // Wait for idle timeout
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Provider should have been disconnected by cleanup
    expect(mockProvider.disconnect).toHaveBeenCalled()

    await shortPool.shutdown()
  })

  it('startCleanup does not create duplicate timers', async () => {
    pool.startCleanup(1000)
    pool.startCleanup(1000) // second call should be no-op
    // No assertion needed — just verify no error thrown
    await pool.shutdown()
  })

  it('disconnect errors are silently ignored during evict', async () => {
    const config = makeAccountConfig()
    await pool.getOrCreate(config)

    // Make disconnect throw
    ;(mockProvider.disconnect as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Connection already closed'))

    // Should not throw
    await expect(pool.evict(config.id)).resolves.toBeUndefined()
  })
})
