# @mail-agent/core

Mail Agent 核心包 — 统一数据模型与适配器接口。

## 功能

- 定义 `MailMessage`、`MailFolder`、`Account` 等统一数据模型
- 定义 `MailProvider` 适配器接口（发送、接收、搜索、文件夹管理）
- 各 Provider 实现此接口即可接入 Mail Agent 生态

## 安装

```bash
pnpm add @mail-agent/core
```

## License

代码：[MIT](../../LICENSE) | 文档：[CC BY 4.0](../../LICENSE-DOCS)
