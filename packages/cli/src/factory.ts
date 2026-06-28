import type { MailProvider, AccountConfig } from '@mail-agent/core'
import { PROVIDER_TEMPLATES } from '@mail-agent/core'
import { SmtpImapProvider } from '@mail-agent/provider-smtp'
import { AgentlyProvider } from '@mail-agent/provider-agently'
import { GmailApiProvider } from '@mail-agent/provider-gmail-api'
import { LarkProvider } from '@mail-agent/provider-lark'

/**
 * 适配器工厂 — 根据 provider 类型创建对应的 MailProvider
 *
 * gmail 走 Gmail REST API（HTTPS 协议，翻墙友好）
 * outlook/qq/163 使用内置模板，底层走 SmtpImapProvider
 * smtp-imap 是完全自定义的 SMTP/IMAP 配置
 * agently 通过 agently-cli 操作 Agent 原生邮箱
 * lark 通过 lark-cli 操作飞书企业邮箱
 */
export function createProvider(config: AccountConfig): MailProvider {
  switch (config.provider) {
    // Gmail — 走 Gmail REST API（HTTPS 协议，翻墙友好，支持线程/标签）
    case 'gmail':
      return new GmailApiProvider()

    // 内置邮箱模板 — 底层走 SMTP/IMAP
    case 'outlook':
    case 'qq':
    case '163':
    case 'smtp-imap':
      return new SmtpImapProvider()

    // Agent 原生邮箱 — 通过 agently-cli 操作
    case 'agently':
      return new AgentlyProvider()

    // 飞书企业邮箱 — 通过 lark-cli 操作
    case 'lark':
      return new LarkProvider()

    default:
      throw new Error(
        `不支持的邮箱类型: ${config.provider}，支持的类型: gmail, outlook, qq, 163, smtp-imap, agently, lark`,
      )
  }
}
