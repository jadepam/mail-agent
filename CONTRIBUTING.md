# 参与贡献指南

感谢你对 Mail Agent 的关注！本文档帮助你快速了解如何参与开发与发版。

## 开发环境

**前置要求**：Node.js ≥ 20、pnpm ≥ 9

## 项目结构

```
mail-agent/
├── packages/
│   ├── core/              # @mail-agent/core — 统一数据模型与适配器接口
│   ├── cli/               # @mail-agent/cli — CLI 命令行工具（bin: ma）
│   ├── provider-smtp/     # @mail-agent/provider-smtp — SMTP/IMAP 适配器
│   ├── provider-agently/  # @mail-agent/provider-agently — Agently Mail 适配器
│   └── provider-gmail-api/# @mail-agent/provider-gmail-api — Gmail API 适配器
├── site/                  # 文档站点（Astro + Starlight）
├── scripts/               # 工具脚本
│   ├── sync-version.mjs   # 版本号同步
│   └── bump.mjs           # 本地版本提升（备用）
└── SKILL.md               # Claude Code Skill 定义
```

## 开发流程

### 1. Fork 仓库

点击 GitHub 页面右上角的 **Fork** 按钮，将仓库 fork 到你的账户。

### 2. 克隆并设置上游

```bash
# 克隆你的 fork
git clone https://github.com/<你的用户名>/mail-agent.git
cd mail-agent

# 添加上游仓库（用于同步最新代码）
git remote add upstream https://github.com/jadepam/mail-agent.git

# 拉取上游所有分支
git fetch upstream
```

### 3. 从 dev 分支创建功能分支

```bash
# 基于最新的 dev 分支创建功能分支
git checkout -b feat/your-feature upstream/dev
```

> 项目采用双分支协作：`dev` 为开发集成分支，`main` 为稳定发布分支。所有 PR 的目标分支均为 `dev`。

### 4. 开发 & 测试

```bash
# 监听模式开发
pnpm dev

# 运行受影响包的测试
pnpm --filter @mail-agent/core run test
```

**测试要求**：

- 单元测试不依赖外网，使用 mock
- 集成测试无账号时自动 skip
- 改完代码需考虑影响与关联部分的测试覆盖

### 5. 同步上游最新代码

在提交 PR 之前，务必同步上游仓库的最新代码以避免冲突：

```bash
git fetch upstream
git rebase upstream/dev
```

### 6. 提交 & PR

```bash
git add .
git commit -m "feat: 添加 XXX 功能"
git push origin feat/your-feature
```

然后在 GitHub 上创建 Pull Request，目标分支为 `jadepam/mail-agent` 的 `dev`。

### 7. Code Review & 合并

PR 提交后，CI 会自动运行构建和测试。等待管理员审核通过后合并到 `dev`。

### 7. 发版（仅维护者）

维护者将 `dev` 合并到 `main` 后，CI 自动完成发版流程，详见下方「发版流程」。

## 分支策略

| 分支   | 用途                                                       |
| ------ | ---------------------------------------------------------- |
| `dev`  | 开发集成分支。所有功能 PR 的目标分支，包含最新开发中的代码 |
| `main` | 稳定发布分支。仅由维护者从 `dev` 合并，合并后自动触发发版  |

## 发版流程（维护者）

合并到 `main` 后，CI 自动完成以下步骤：

```
PR 合并到 main
  ↓
CI: 自动 bump patch 版本号（0.0.1 → 0.0.2）
  ↓
CI: sync-version 同步到所有位置
  ↓
CI: 构建 + 测试
  ↓
CI: commit 版本变更 + 打 tag（v0.0.2）+ push
  ↓
CI: pnpm publish 发包到 npm
```

**无需手动改版本号或发包** — 本节面向维护者。外部贡献者请参考上方的开发流程。

### 版本号同步位置

bump 后以下位置的版本号会自动同步：

| 位置                        | 说明                 |
| --------------------------- | -------------------- |
| `package.json`（根）        | 主版本号源头         |
| `packages/*/package.json`   | 所有子包             |
| `packages/cli/src/index.ts` | CLI `--version` 输出 |
| `SKILL.md`                  | Skill frontmatter    |
| `cli-setup.md`              | 安装指南 frontmatter |

### 手动触发（可选）

在 GitHub Actions 页面可以手动触发 Release workflow，支持：

- **Bump 类型**：`patch`（默认）/ `minor` / `major`
- **Dry run**：只跑流程不发包，用于验证

### 本地 bump（备用）

如果需要在本地提前 bump（比如测试发版流程）：

```bash
pnpm bump patch    # 0.0.1 → 0.0.2
pnpm bump minor    # 0.0.1 → 0.1.0
pnpm bump major    # 0.0.1 → 1.0.0
pnpm bump 1.2.3    # 指定版本号
```

> ⚠️ 本地 bump 后 push 到 main，CI 检测到版本号已更新（tag 已存在），会跳过发版。通常不需要本地 bump。

## 代码规范

- **协议**：代码 MIT / 文档 CC BY 4.0，版权声明只在根 LICENSE
- **package.json**：新子包加 `"license": "MIT"` + `"author": "jadepam"`
- **版本号**：SemVer 统一发版，不硬编码
- **一致性**：改动全局统一，不出现前后矛盾
- **决策沉淀**：被采纳的决策写到 `LESSONS.md`，不写 `CLAUDE.md`

## 仓库配置

无需配置任何 Secret — CI 使用 npm 可信发布（OIDC）自动认证：

```bash
# 首次配置：在本地运行一次即可
npm login
npm trusted-publish add github
```

这会将 GitHub 仓库注册到 npm，之后 CI 每次发布时自动通过 OIDC 认证，无需存储长期令牌。
