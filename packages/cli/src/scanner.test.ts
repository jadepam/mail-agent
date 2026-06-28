/**
 * scanner.ts 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { scanLocalAccounts } from './scanner.js'

// Mock child_process
vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}))

import { execFileSync } from 'child_process'

const mockExecFileSync = vi.mocked(execFileSync)

/**
 * Helper: build mock implementation for both agently-cli and lark-cli
 *
 * When a CLI is not installed, `which <cli>` should throw.
 * When installed but not logged in, `auth status` should throw or return logged_in: false.
 */
function buildMock(opts: {
  agentlyInstalled?: boolean
  agentlyLoggedIn?: boolean
  agentlyAliases?: Array<{ email: string; is_primary: boolean; name: string }>
  larkInstalled?: boolean
  larkLoggedIn?: boolean
  larkEmail?: string
  larkAliases?: Array<{ email: string; is_primary: boolean; name: string }>
}) {
  return (cmd: string, args: string[]): string => {
    // ── which ──
    if (cmd === 'which') {
      const target = args[0]
      if (target === 'agently-cli' && opts.agentlyInstalled) return '/usr/local/bin/agently-cli'
      if (target === 'lark-cli' && opts.larkInstalled) return '/usr/local/bin/lark-cli'
      throw new Error(`${target} not found`)
    }

    // ── agently-cli ──
    if (cmd === 'agently-cli') {
      if (args[0] === 'auth' && args[1] === 'status') {
        if (opts.agentlyLoggedIn) {
          return JSON.stringify({ ok: true, data: { logged_in: true, status: 'logged_in', token_status: 'valid' } })
        }
        throw new Error('not logged in')
      }
      if (args[0] === '+me') {
        return JSON.stringify({
          ok: true,
          data: { aliases: opts.agentlyAliases || [] },
        })
      }
      throw new Error(`unexpected agently-cli: ${args.join(' ')}`)
    }

    // ── lark-cli ──
    if (cmd === 'lark-cli') {
      if (args[0] === 'auth' && args[1] === 'status') {
        if (opts.larkLoggedIn) {
          return JSON.stringify({ ok: true, data: { logged_in: true, status: 'logged_in', token_status: 'valid' } })
        }
        throw new Error('not logged in')
      }
      if (args[0] === 'mail' && args[1] === 'user_mailbox' && args[2] === 'profile') {
        return JSON.stringify({
          ok: true,
          data: { primary_email_address: opts.larkEmail || '' },
        })
      }
      if (args[0] === '+me') {
        return JSON.stringify({
          ok: true,
          data: { aliases: opts.larkAliases || [] },
        })
      }
      throw new Error(`unexpected lark-cli: ${args.join(' ')}`)
    }

    throw new Error(`unexpected command: ${cmd} ${args.join(' ')}`)
  }
}

describe('scanLocalAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return empty when no CLI is installed', () => {
    mockExecFileSync.mockImplementation(buildMock({}))

    const result = scanLocalAccounts([])
    expect(result.accounts).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  it('should detect agently-cli installed but not logged in', () => {
    mockExecFileSync.mockImplementation(
      buildMock({
        agentlyInstalled: true,
        agentlyLoggedIn: false,
      }),
    )

    const result = scanLocalAccounts([])
    expect(result.accounts).toHaveLength(1)
    expect(result.accounts[0].email).toBe('(Not logged in)')
    expect(result.accounts[0].provider).toBe('agently')
    expect(result.accounts[0].alreadyConfigured).toBe(false)
    expect(result.warnings).toHaveLength(1)
  })

  it('should discover logged-in agently-cli accounts', () => {
    mockExecFileSync.mockImplementation(
      buildMock({
        agentlyInstalled: true,
        agentlyLoggedIn: true,
        agentlyAliases: [{ alias_id: 'a1', email: 'test@agent.qq.com', is_primary: true, name: 'Test' }],
      }),
    )

    const result = scanLocalAccounts([])
    expect(result.accounts).toHaveLength(1)
    expect(result.accounts[0].email).toBe('test@agent.qq.com')
    expect(result.accounts[0].source).toBe('agently-cli')
    expect(result.accounts[0].provider).toBe('agently')
    expect(result.accounts[0].alreadyConfigured).toBe(false)
    expect(result.accounts[0].detail).toBe('Primary email')
  })

  it('should mark already-configured accounts', () => {
    mockExecFileSync.mockImplementation(
      buildMock({
        agentlyInstalled: true,
        agentlyLoggedIn: true,
        agentlyAliases: [{ alias_id: 'a1', email: 'test@agent.qq.com', is_primary: true, name: 'Test' }],
      }),
    )

    const existingAccounts = [{ id: '1', alias: 'Agent邮箱', provider: 'agently', user: 'test@agent.qq.com' }] as any

    const result = scanLocalAccounts(existingAccounts)
    expect(result.accounts).toHaveLength(1)
    expect(result.accounts[0].alreadyConfigured).toBe(true)
  })

  it('should handle agently-cli +me with multiple aliases', () => {
    mockExecFileSync.mockImplementation(
      buildMock({
        agentlyInstalled: true,
        agentlyLoggedIn: true,
        agentlyAliases: [
          { alias_id: 'a1', email: 'primary@agent.qq.com', is_primary: true, name: 'Primary' },
          { alias_id: 'a2', email: 'secondary@agent.qq.com', is_primary: false, name: 'Secondary' },
        ],
      }),
    )

    const result = scanLocalAccounts([])
    expect(result.accounts).toHaveLength(2)
    expect(result.accounts[0].email).toBe('primary@agent.qq.com')
    expect(result.accounts[0].detail).toBe('Primary email')
    expect(result.accounts[1].email).toBe('secondary@agent.qq.com')
    expect(result.accounts[1].detail).toBe('Alias: Secondary')
  })

  // ── Lark CLI tests ──

  it('should detect lark-cli installed but not logged in', () => {
    mockExecFileSync.mockImplementation(
      buildMock({
        larkInstalled: true,
        larkLoggedIn: false,
      }),
    )

    const result = scanLocalAccounts([])
    expect(result.accounts).toHaveLength(1)
    expect(result.accounts[0].email).toBe('(Not logged in)')
    expect(result.accounts[0].provider).toBe('lark')
    expect(result.accounts[0].source).toBe('lark-cli')
    expect(result.accounts[0].alreadyConfigured).toBe(false)
    expect(result.warnings).toHaveLength(1)
  })

  it('should discover logged-in lark-cli accounts via profile', () => {
    mockExecFileSync.mockImplementation(
      buildMock({
        larkInstalled: true,
        larkLoggedIn: true,
        larkEmail: 'user@company.com',
      }),
    )

    const result = scanLocalAccounts([])
    expect(result.accounts).toHaveLength(1)
    expect(result.accounts[0].email).toBe('user@company.com')
    expect(result.accounts[0].source).toBe('lark-cli')
    expect(result.accounts[0].provider).toBe('lark')
    expect(result.accounts[0].alreadyConfigured).toBe(false)
    expect(result.accounts[0].detail).toBe('Lark / 飞书企业邮箱 (user identity)')
  })

  it('should fallback to +me when lark-cli profile fails', () => {
    const impl = (cmd: string, args: string[]): string => {
      if (cmd === 'which' && args[0] === 'lark-cli') return '/usr/local/bin/lark-cli'
      if (cmd === 'lark-cli' && args[0] === 'auth') {
        return JSON.stringify({ ok: true, data: { logged_in: true } })
      }
      if (cmd === 'lark-cli' && args[0] === 'mail' && args[1] === 'user_mailbox') {
        throw new Error('profile not available')
      }
      if (cmd === 'lark-cli' && args[0] === '+me') {
        return JSON.stringify({
          ok: true,
          data: {
            aliases: [{ email: 'fallback@company.com', is_primary: true, name: 'Fallback User' }],
          },
        })
      }
      throw new Error(`unexpected: ${cmd} ${args.join(' ')}`)
    }

    mockExecFileSync.mockImplementation(impl)

    const result = scanLocalAccounts([])
    expect(result.accounts).toHaveLength(1)
    expect(result.accounts[0].email).toBe('fallback@company.com')
    expect(result.accounts[0].source).toBe('lark-cli')
  })

  it('should discover both agently-cli and lark-cli accounts', () => {
    mockExecFileSync.mockImplementation(
      buildMock({
        agentlyInstalled: true,
        agentlyLoggedIn: true,
        agentlyAliases: [{ alias_id: 'a1', email: 'test@agent.qq.com', is_primary: true, name: 'Test' }],
        larkInstalled: true,
        larkLoggedIn: true,
        larkEmail: 'user@company.com',
      }),
    )

    const result = scanLocalAccounts([])
    expect(result.accounts).toHaveLength(2)
    expect(result.accounts[0].email).toBe('test@agent.qq.com')
    expect(result.accounts[0].source).toBe('agently-cli')
    expect(result.accounts[1].email).toBe('user@company.com')
    expect(result.accounts[1].source).toBe('lark-cli')
  })
})
