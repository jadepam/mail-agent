import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import type { AccountConfig, OutboundMail, SendResult } from '@mail-agent/core'
import { resolveSmtpConfig, isOAuth2Account, formatMailAddress } from '@mail-agent/core'
import { v7 as uuidv7 } from 'uuid'
import { withRetry } from './errors.js'

/**
 * SMTP 发送封装 — 基于 nodemailer
 * 支持密码认证（QQ/163/企业邮箱）与 OAuth2 认证（Gmail/Outlook）
 */
export class SmtpSender {
  private transporter: Transporter | null = null
  private config: AccountConfig | null = null

  async connect(config: AccountConfig): Promise<void> {
    const smtp = resolveSmtpConfig(config)
    if (!smtp.host) {
      throw new Error(`账号 ${config.alias} 缺少 SMTP 配置`)
    }
    this.config = config

    // 根据认证方式创建不同的 transport
    if (isOAuth2Account(config) && config.oauth2) {
      this.transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: {
          type: 'OAuth2',
          user: smtp.user,
          clientId: config.oauth2.clientId,
          clientSecret: config.oauth2.clientSecret,
          refreshToken: config.oauth2.refreshToken,
          accessToken: config.oauth2.accessToken,
          expires: config.oauth2.expires,
        } as any,
        tls: smtp.rejectUnauthorized === false ? { rejectUnauthorized: false } : undefined,
      })
    } else {
      // 密码/授权码认证
      this.transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: {
          user: smtp.user,
          pass: smtp.pass,
        },
        tls: smtp.rejectUnauthorized === false ? { rejectUnauthorized: false } : undefined,
      })
    }

    await this.transporter.verify()
  }

  async send(mail: OutboundMail): Promise<SendResult> {
    if (!this.transporter || !this.config) {
      return {
        success: false,
        mailId: '',
        errorCode: 'E1001',
        errorMessage: 'SMTP 未连接',
      }
    }

    const smtpUser = resolveSmtpConfig(this.config).user

    return withRetry(async () => {
      try {
        const sendOpts: any = {
          from: formatMailAddress(this.config!.alias, smtpUser),
          to: mail.to.map((a) => formatMailAddress(a.name, a.address)).join(', '),
          cc: mail.cc?.map((a) => formatMailAddress(a.name, a.address)).join(', '),
          bcc: mail.bcc?.map((a) => formatMailAddress(a.name, a.address)).join(', '),
          subject: mail.subject,
          text: mail.body.text,
          html: mail.body.html,
          inReplyTo: mail.inReplyTo,
        }

        // 附件内容（转发时使用 attachmentContents，否则用 attachments）
        if (mail.attachmentContents?.length) {
          sendOpts.attachments = mail.attachmentContents.map((att) => ({
            filename: att.filename,
            content: att.content,
            contentType: att.contentType,
          }))
        }

        const result = await this.transporter!.sendMail(sendOpts)

        return {
          success: true,
          mailId: uuidv7(),
          providerId: result.messageId,
        }
      } catch (err: any) {
        const errorCode = this.mapSmtpError(err.code || err.responseCode)
        // 标记不可重试错误，让 withRetry 不重试
        if (!['E1001', 'E3001'].includes(errorCode)) {
          ;(err as any).retryable = false
        }
        return {
          success: false,
          mailId: '',
          errorCode,
          errorMessage: err.message,
        }
      }
    }, 'SMTP send')
  }

  async disconnect(): Promise<void> {
    if (this.transporter) {
      this.transporter.close()
      this.transporter = null
    }
  }

  private mapSmtpError(code: number | string): string {
    // 连接类错误（可重试）
    if (code === 'EAUTH' || code === 'EDENIED') return 'E1002'
    if (code === 'ECONNECTION' || code === 'ETIMEDOUT' || code === 'ECONNRESET') return 'E1001'
    // 风控类错误
    if (code === 550 || code === 553) return 'E3002' // 账号封禁/拒收
    if (code === 451) return 'E3001' // 限流（可重试）
    if (code === 552) return 'E4002' // 附件超限
    if (code === 554) return 'E2001' // 邮件被拒
    if (code === 501 || code === 503) return 'E4001' // 参数错误
    // 协议类错误
    if (code === 535) return 'E1002' // 认证失败
    if (code === 530) return 'E1003' // 需要 TLS
    return 'E2001'
  }
}
