# @mail-agent/provider-lark

飞书企业邮箱适配器 — 通过 `lark-cli` 操作飞书企业邮箱。

## 架构

与 `@mail-agent/provider-agently` 架构一致：

- **零凭证传递**：OAuth token 由 `lark-cli` 自管（本地 Keychain / Secret Service）
- **子进程调用**：通过 `lark-cli` CLI 命令调用飞书 Mail Open API
- **v1 仅支持 user 身份**：完整读写能力，`--as user` 统一追加

```
ma CLI / MCP Server
        │
    factory.ts
        │
  LarkProvider
        │
    lark-cli (child process)
        │
  Lark Open Platform Mail API
```

## 安装

### 1. 安装 lark-cli

```bash
npx @larksuite/cli@latest install
```

### 2. 授权登录

```bash
lark-cli auth login --domain mail
```

扫码完成飞书账号授权。

### 3. 添加飞书邮箱到 ma

```bash
ma account add
# 选择 "🏢 Lark / 飞书企业邮箱"
```

或使用 `ma init` 自动扫描已登录的 lark-cli 账号。

## 支持的操作

| 操作     | lark-cli 命令                        | 说明                                   |
| -------- | ------------------------------------ | -------------------------------------- |
| 列出邮件 | `+triage`                            | 支持 folder / unread / 日期范围 / 分页 |
| 读取邮件 | `+message`                           | 完整邮件内容含附件元数据               |
| 搜索邮件 | `+triage --query`                    | 全文搜索 + 过滤                        |
| 获取线程 | `+thread`                            | 飞书原生线程支持                       |
| 发送邮件 | `+send --confirm-send`               | ma Human/AI Mode 控制确认              |
| 回复邮件 | `+reply / +reply-all --confirm-send` | 自动设置 In-Reply-To / References      |
| 转发邮件 | `+forward --confirm-send`            | 自动包含原文引用                       |
| 删除邮件 | `user_mailbox.messages trash`        | 需 `--yes` 确认                        |
| 下载附件 | `message.attachments download_url`   | 先获取下载链接再下载                   |

## 能力声明

```typescript
{
  realtimePush: false,
  imapIdle: false,
  threadNative: true,         // 飞书原生线程
  aiParsing: false,
  attachmentOcr: false,
  maxAttachmentSize: 30 MB,
  sendRateLimit: 50,
}
```

## 限制

- v1 仅支持 **user 身份**（完整读写），bot 只读身份后续按需扩展为 `lark-bot` provider
- 飞书特有功能（watch 实时推送、邮件签名、分享到聊天、已读回执、模板）v1 不暴露为独立 MCP 工具
- 发送操作统一使用 `--confirm-send` 直接发送，ma 已有 Human/AI Mode 确认机制

## 许可协议

[MIT](../../LICENSE) · 文档 [CC BY 4.0](../../LICENSE-DOCS)
