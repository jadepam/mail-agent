# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> 中文 | [English](#english-changelog)

--

## [0.1.0] - 2026-06-28

### Added

- 统一邮件数据模型与适配器接口（`@mail-agent/core`）
- SMTP/IMAP 适配器（`@mail-agent/provider-smtp`），支持 QQ/163/企业邮箱
- Gmail REST API 适配器（`@mail-agent/provider-gmail-api`），OAuth2 浏览器授权 + Token 自动刷新
- Agently Mail 适配器（`@mail-agent/provider-agently`），通过 agently-cli 零凭证接入
- 飞书企业邮箱适配器（`@mail-agent/provider-lark`），通过 lark-cli 零凭证接入，原生线程支持
- CLI 命令行工具（`@mail-agent/cli`），12 个子命令：send/list/read/search/reply/forward/trash/download/thread/+me/account/init/mode
- MCP Server 集成，10 个工具供 AI Agent 调用
- 附件发送与下载：Gmail/163/QQ/Agently/Lark 全部支持
- Human Mode / AI Mode：破坏性操作（send/reply/forward/trash）二次确认，`--json` 隐式 AI 模式
- 连接池（`ProviderPool`）：MCP Server 长驻进程内复用 provider 连接，5 分钟空闲超时
- Gmail API 错误码映射完善：`mapGmailApiError()` 返回 `MailErrorClass`，区分 403 配额/禁用/权限、429 限流类型，含 retryable/retryAfter
- CLI 入口拆分：从 716 行单文件拆分为 12 个命令子模块（`registerXxxCommand` 模式）
- 凭据加密存储（AES-256-GCM + PBKDF2）
- 文档站点（Astro + Starlight）
- 全自动发版流水线（版本提升 + npm 可信发布）

### Fixed

- Gmail `reply()` 缺少获取原始邮件代码，导致回复始终报 "Invalid To header"
- Gmail `parseAddressList()` 解析逻辑矛盾，`"Name <addr>"` 格式无法正确解析
- Gmail `providerId` 使用内部 hex ID 而非 RFC 2822 Message-ID，导致 In-Reply-To 头格式错误
- Gmail `send()` 未传递 `attachmentContents` 给 `encodeRawEmail`，附件发送失败
- Gmail `read()` 当 `format: 'full'` 不返回 multipart parts 时，增加 `format: 'raw'` 回退解析附件
- Agently `send()` 未传递 `attachmentContents` 给 agently-cli `--attachment`，附件发送失败
- Agently `fetchAttachment()` 使用 `os.tmpdir()` 路径被 agently-cli 安全策略拒绝，改用 cwd 内临时目录

--

## English Changelog

All changes listed in the Chinese section above apply equally to the English version.

<!-- LINKS -->

[0.1.0]: https://github.com/jadepam/mail-agent/releases/tag/v0.1.0
