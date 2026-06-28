# 一个命令，AI 帮你收发邮件 —— 任意邮箱，直连无中转

## 起因

我日常要同时用 QQ 邮箱、Gmail、163、飞书企业邮箱，还有 Agently Mail 这种 AI 专用邮箱。查邮件切窗口，找附件翻半天，AI 想帮我处理邮件又够不着——MCP 协议里没有邮件工具，各家 Agent 对邮箱操作都是空白。

所以我自己写了一个。叫 Mail Agent，命令 `ma`，npm 包 `@mail-agent/cli`。

## 架构

```
AI Agent (Claude/Cursor/Windsurf)
        │ MCP (stdio)
        ▼
   ma mcp ──→ MCP Server
        │
        ▼
   Provider Pool (连接池 + 自动清理)
    ┌───┼───────────────┐
    ▼   ▼               ▼
  SMTP  Gmail API   agently-cli / lark-cli
  IMAP  (OAuth2)    (CLI 封装)
```

核心设计三个点：

1. **Provider 抽象层**——`@mail-agent/core` 定义统一的 `MailProvider` 接口，各邮箱实现自己的 adapter。CLI 和 MCP Server 都只依赖接口，不依赖具体实现。

2. **连接池**——IMAP 连接建立成本高，ProviderPool 做了空闲连接复用和超时自动清理，MCP Server 长驻时不用每次操作都重新握手。

3. **双模式**——Human Mode 和 AI Mode。Human Mode 下破坏性操作（发邮件、删邮件）必须用户确认，AI Mode 跳过确认。`ma mode` 随时切。

## 六种邮箱怎么接的

| 邮箱                | 包                               | 接入方式         | 认证          |
| ------------------- | -------------------------------- | ---------------- | ------------- |
| QQ / 163 / 企业自建 | `@mail-agent/provider-smtp`      | SMTP/IMAP 直连   | 授权码 / 密码 |
| Gmail               | `@mail-agent/provider-gmail-api` | Gmail REST API   | OAuth2        |
| 飞书企业邮箱        | `@mail-agent/provider-lark`      | lark-cli 封装    | 企业 OAuth    |
| Agently Mail        | `@mail-agent/provider-agently`   | agently-cli 封装 | OAuth         |

SMTP/IMAP 那个包同时兼容公网邮箱和企业私有化邮箱，自签名证书也支持。Gmail 用 REST API 而不是 IMAP，因为 API 模式对代理环境更友好，原生支持会话线程和附件管理。飞书和 Agently 走 CLI 封装，复用官方工具的认证流程，不用自己实现 OAuth。

## MCP Server 暴露了什么

10 个工具，覆盖邮件操作全链路：

```json
{
  "list_accounts": "列出已配置邮箱账号",
  "list_mails": "列出邮件（摘要，不含正文）",
  "read_mail": "读取邮件完整内容",
  "search_mails": "按关键词搜索",
  "send_mail": "发送邮件",
  "reply_mail": "回复邮件（自动引用原文）",
  "forward_mail": "转发邮件（可选附带附件）",
  "get_thread": "获取会话线程",
  "trash_mail": "删除邮件（软删除）",
  "download_attachment": "下载附件到本地"
}
```

每个工具都有 `account_alias` 可选参数，不传就走默认账号。AI 不用关心底层是 SMTP 还是 API，调同一个接口就行。

## 安全设计

这块我比较在意，多说两句。

**直连，不中转。** 所有邮箱都是客户端直连服务器，邮件不经过任何第三方。跟你自己用 Foxmail 发邮件一样，只是操作者从你变成了 AI。

**凭据加密。** `~/.mail-agent/credentials.yaml` 支持加密存储。设主密码后，凭据用 AES-256-GCM 加密，文件权限强制 600。自动化场景用 `MAIL_AGENT_MASTER_PASSWORD` 环境变量。

**模式隔离。** Human Mode 是默认值，AI 不能静默发邮件。切 AI Mode 是显式操作，而且随时能切回来。

**MCP 层防注入。** 邮件内容视为不可信外部输入，AI 不会执行邮件中的指令，只做数据处理。

## 本地扫描

`ma init` 会自动扫本地已有的邮箱登录：

- 检测 agently-cli 是否安装且已登录 → 自动添加 Agently Mail 账号
- 检测 lark-cli 是否安装且已登录 → 自动添加飞书企业邮箱账号
- 读取已有配置 → 跳过重复添加

扫到的账号在 `ma account add` 的选择列表里会标 ⭐ 已就绪，选了直接用，不用再输邮箱地址。

## 实际使用体验

命令行：

```bash
# 查看所有账号
ma +me

# 列出最近 20 封邮件
ma list

# 搜索报销相关邮件
ma search "报销" --from finance@company.com

# 读取一封邮件
ma read <mail-id>

# 发邮件
ma send -t zhangsan@example.com -s "方案确认" -b "已确认，请推进"

# 回复邮件
ma reply <mail-id> -b "收到，明天给反馈"

# 下载附件
ma download <mail-id> --att 报告.pdf -o ~/Downloads
```

AI Agent 里更自然：

```
我: 帮我看看 QQ 邮箱有没有未读邮件
AI: [调用 list_mails] 有 3 封未读...

我: 回复第一封，说方案明天给
AI: [调用 reply_mail] 已回复

我: 把第二封的附件下载到桌面
AI: [调用 download_attachment] 已保存到 ~/Desktop/报告.pdf
```

## 技术栈

pnpm monorepo，TypeScript 全栈。构建用 tsdown，测试用 vitest。六个包：

```
@mail-agent/core              # 数据模型 + Provider 接口
@mail-agent/cli               # CLI + MCP Server
@mail-agent/provider-smtp     # SMTP/IMAP 适配器
@mail-agent/provider-gmail-api # Gmail REST API 适配器
@mail-agent/provider-lark     # 飞书企业邮箱适配器
@mail-agent/provider-agently  # Agently Mail 适配器
```

每个 provider 只依赖 core，cli 聚合所有 provider。依赖关系是严格的分层：core → provider → cli。

## 接入方式

最简单的，一行命令：

```bash
npm install -g @mail-agent/cli
ma init
claude mcp add mail-agent -- ma mcp
```

或者 Skill 方式，在 Agent 对话里粘贴一句就行，它自己装好一切。

Cursor 和 Windsurf 在设置里加 MCP Server，Command 填 `ma`，Args 填 `mcp`。

---

GitHub: https://github.com/jadepam/mail-agent
文档: https://jadepam.github.io/mail-agent/
npm: https://www.npmjs.com/package/@mail-agent/cli

MIT 协议，欢迎贡献。
