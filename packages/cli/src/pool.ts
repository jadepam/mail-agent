/**
 * Provider connection pool — reuse provider connections within long-lived processes
 *
 * Primarily benefits the MCP server, where multiple tool calls can share
 * the same SMTP/IMAP connections instead of creating/destroying per call.
 * CLI one-shot commands don't use the pool (process exits after each command).
 *
 * Features:
 * - Caches connected providers by account ID
 * - Idle timeout: disconnects providers unused beyond maxIdleMs (default 5 min)
 * - Periodic cleanup with unref() timer (doesn't block process exit)
 * - Error eviction: removes broken connections automatically
 */

import type { MailProvider, AccountConfig } from '@mail-agent/core'
import { createProvider } from './factory.js'
import { persistRefreshedToken } from './config.js'

interface PooledProvider {
  provider: MailProvider
  accountConfig: AccountConfig
  lastUsed: number
}

export class ProviderPool {
  private pool = new Map<string, PooledProvider>()
  private maxIdleMs: number
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(options?: { maxIdleMs?: number }) {
    this.maxIdleMs = options?.maxIdleMs ?? 5 * 60 * 1000 // default 5 minutes
  }

  /**
   * Get or create a connected provider for the given account.
   * If a cached provider exists and hasn't been idle too long, reuse it.
   * Otherwise, create a new one and cache it.
   */
  async getOrCreate(accountConfig: AccountConfig): Promise<{ provider: MailProvider; accountConfig: AccountConfig }> {
    const key = accountConfig.id
    const existing = this.pool.get(key)

    if (existing) {
      // Check if idle too long
      if (Date.now() - existing.lastUsed > this.maxIdleMs) {
        await this.disconnectAndRemove(key)
      } else {
        existing.lastUsed = Date.now()
        return { provider: existing.provider, accountConfig: existing.accountConfig }
      }
    }

    // Create new provider
    const provider = createProvider(accountConfig)
    await provider.connect(accountConfig)
    this.pool.set(key, { provider, accountConfig, lastUsed: Date.now() })
    return { provider, accountConfig }
  }

  /**
   * Release a provider back to the pool after successful use.
   * Does NOT disconnect — keeps the connection alive for reuse.
   * Persists any refreshed OAuth2 tokens.
   */
  async release(accountConfig: AccountConfig): Promise<void> {
    const entry = this.pool.get(accountConfig.id)
    if (entry) {
      entry.lastUsed = Date.now()
      // Persist refreshed OAuth2 tokens
      persistRefreshedToken(entry.accountConfig)
    }
  }

  /**
   * Evict a provider from the pool (e.g. after an error).
   * Disconnects and removes the provider.
   */
  async evict(accountId: string): Promise<void> {
    await this.disconnectAndRemove(accountId)
  }

  private async disconnectAndRemove(key: string): Promise<void> {
    const entry = this.pool.get(key)
    if (entry) {
      this.pool.delete(key)
      try {
        await entry.provider.disconnect()
        persistRefreshedToken(entry.accountConfig)
      } catch {
        // Ignore disconnect errors — the connection may already be broken
      }
    }
  }

  /**
   * Start periodic cleanup of idle connections.
   * The timer uses unref() so it doesn't prevent process exit.
   */
  startCleanup(intervalMs = 60_000): void {
    if (this.cleanupTimer) return
    this.cleanupTimer = setInterval(() => this.cleanup(), intervalMs)
    // Don't prevent process exit
    if (this.cleanupTimer.unref) this.cleanupTimer.unref()
  }

  private async cleanup(): Promise<void> {
    const now = Date.now()
    for (const [key, entry] of this.pool) {
      if (now - entry.lastUsed > this.maxIdleMs) {
        await this.disconnectAndRemove(key)
      }
    }
  }

  /**
   * Disconnect all providers and stop cleanup timer.
   * Call on process shutdown.
   */
  async shutdown(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    for (const key of [...this.pool.keys()]) {
      await this.disconnectAndRemove(key)
    }
  }
}
