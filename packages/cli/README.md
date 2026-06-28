# @mail-agent/cli

Mail Agent CLI — 一行命令接入 AI Agent 操作邮箱。

## 功能

- `ma account add/list/remove` — 邮箱账号管理
- `ma list/read/search/send` — 邮件收发与检索
- `ma mcp` — 以 MCP Server 模式启动，供 IDE / AI Agent 接入
- `ma init` — 首次使用，扫描并添加本地邮箱
- OAuth2 浏览器授权（Gmail / Outlook）
- 凭据安全存储（`~/.mail-agent/credentials.yaml`，权限 600）

## 安装

```bash
npm install -g @mail-agent/cli
```

## License

代码：[MIT](../../LICENSE) | 文档：[CC BY 4.0](../../LICENSE-DOCS)
