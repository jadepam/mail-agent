---
name: mail-agent-setup
description: 将 Mail Agent 邮件能力接入 AI Agent。当用户想让 Agent 能收发邮件、或需要在 IDE/Agent 中配置邮件工具时使用此 skill。
version: 0.1.0
---

# Mail Agent 安装配置指南

根据你选择的接入方式，执行以下步骤。

## Skill 方式（推荐）

Agent 会自动安装 CLI + Skill，无需手动操作。

### 第 1 步：安装 CLI

```bash
npm install -g @mail-agent/cli
```

### 第 2 步：安装 Skill

**Claude Code：**

```bash
claude install-skill https://raw.githubusercontent.com/jadepam/mail-agent/main/cli-setup.md
```

**其他 Agent：** 将此文档内容作为工具说明提供给 Agent。

### 第 3 步：配置邮箱账号

```bash
ma init
```

自动扫描本地已安装的 agently-cli 等工具，交互式添加可用邮箱。

也可手动添加：

```bash
ma account add
```

支持的邮箱类型：

- **Agently Mail** — 通过 agently-cli OAuth 授权（凭证自管）
- **Lark / 飞书企业邮箱** — 通过 lark-cli OAuth 授权（凭证自管）
- **Gmail / Outlook** — OAuth2 授权（需自备 Client ID / Secret）
- **QQ / 163 邮箱** — 授权码认证
- **企业私有化邮箱** — 自定义 SMTP/IMAP

### 验证

```bash
ma +me
```

确认已配置的邮箱账号和默认邮箱。看到账号列表即表示就绪。

### 运行模式

初始化时会询问运行模式，也可随时切换：

```bash
ma mode            # 查看当前模式
ma mode ai         # 切换到 AI 模式（跳过确认，适合自动化）
ma mode human      # 切换到人类模式（破坏性操作需二次确认）
```

- **Human 模式**（默认）：`send`、`reply`、`forward`、`trash` 前需二次确认
- **AI 模式**：跳过所有确认，适合 AI Agent 自动化流程

---

## MCP 方式

需先确保本地已安装 Mail Agent CLI，再手动将 Mail Agent 添加为 MCP Server。

### 第 1 步：安装 CLI

```bash
npm install -g @mail-agent/cli
```

### 第 2 步：配置邮箱账号(同skill方式 第 3 步：配置邮箱账号)

```bash
ma init
```

也可手动添加：

```bash
ma account add
```

### 第 3 步：添加 MCP Server

**Claude Code（一行命令）：**

```bash
claude mcp add mail-agent -- ma mcp
```

**Cursor / Windsurf：** 在 Settings → MCP 中添加：

- **Command**: `ma`
- **Args**: `mcp`

或手动编辑 MCP 配置文件：

```json
{
  "mcpServers": {
    "ma": {
      "command": "ma",
      "args": ["mcp"]
    }
  }
}
```

各工具配置文件位置：

| 工具        | 配置文件位置                                             |
| ----------- | -------------------------------------------------------- |
| Claude Code | `~/.claude/settings.json` 或项目 `.claude/settings.json` |
| Cursor      | Settings → MCP → Add new MCP Server                      |
| Windsurf    | Settings → MCP Servers                                   |

### 验证

在 AI 工具中尝试：

> 帮我查看最近的邮件

如果 AI 能调用 `list_mails` 并返回结果，说明配置成功。

> **MCP 模式天然是 AI 模式**，所有操作无需确认直接执行。如需在 CLI 终端也使用 AI 模式，运行 `ma mode ai`。

### MCP 工具列表

| 工具                  | 用途               | 何时使用                                       |
| --------------------- | ------------------ | ---------------------------------------------- |
| `list_accounts`       | 查看已配置邮箱账号 | 需要确认可用账号、获取 account_alias 值        |
| `list_mails`          | 列出邮件摘要       | 查看收件箱、查看未读邮件                       |
| `read_mail`           | 读取邮件完整内容   | 阅读正文、查看附件、准备回复                   |
| `search_mails`        | 按关键词搜索邮件   | 查找特定主题/内容的邮件、按发件人过滤          |
| `send_mail`           | 发送邮件           | 发送新邮件                                     |
| `get_thread`          | 获取邮件会话       | 查看完整往来邮件上下文（Gmail、Lark 原生支持） |
| `trash_mail`          | 将邮件移入回收站   | 删除不需要的邮件                               |
| `reply_mail`          | 回复邮件           | 回复邮件（自动填充收件人、Re: 前缀、引用原文） |
| `forward_mail`        | 转发邮件           | 转发邮件给其他人（自动添加 Fwd: 前缀）         |
| `download_attachment` | 下载邮件附件       | 保存邮件中的附件到本地                         |

### MCP 工具调用要点

- `account_alias` 参数可省略，自动使用默认邮箱
- `list_mails` 返回摘要（不含正文），需要正文时用 `read_mail`
- `read_mail` 的 `mail_id` 来自 `list_mails` 或 `search_mails` 返回的 `id` 字段
- `search_mails` 支持 `folder`、`from`、`unread_only` 过滤参数
- 回复邮件优先用 `reply_mail`（自动填充收件人、Re: 前缀、引用原文），也可用 `send_mail` 手动回复
- 转发邮件用 `forward_mail`（自动添加 Fwd: 前缀和转发原文）
- 删除邮件用 `trash_mail`（软删除，移入回收站）
- 下载附件用 `download_attachment`，`attachment_name` 来自 `read_mail` 返回的附件列表
- `list_accounts` 返回 `tip` 字段，提示默认邮箱用法
