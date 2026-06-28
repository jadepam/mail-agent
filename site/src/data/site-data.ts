/**
 * 站点内容数据层
 *
 * 所有文案和拓扑数据都在这个文件里定义，组件从这里读取，不硬编码
 * 改了这里，站点自动更新
 */

// ===== 类型 =====

export type Locale = 'zh' | 'en'

export interface TopologyColumn {
  icon: string
  title: string
  protocol: string
  providers: string[]
  auth: string
  color: string
}

export interface FeatureCard {
  icon: string
  title: string
  description: string
  color: string
}

// ===== Agent Terminal 类型 =====

export interface ToolCallData {
  type: 'bash' | 'mcp'
  command?: string
  toolName?: string
  params?: Record<string, string>
  annotation?: string
}

export interface MailListItem {
  unread: boolean
  sender: string
  subject: string
  date: string
}

export interface TerminalStepData {
  userInput: string
  toolCalls?: ToolCallData[]
  cliOutputLines?: string[]
  agentReply: string
  mailList?: { account: string; mails: MailListItem[] }
}

export interface AgentTerminalData {
  mcpSteps: TerminalStepData[]
  skillSteps: TerminalStepData[]
  mcpPrompt: string
  skillPrompt: string
  mcpSupport: string
  skillSupport: string
  copyLabel: string
  copiedLabel: string
}

// ===== 站点数据类型 =====

export interface SiteData {
  title: string
  subtitle: string
  description: string
  slogans: string[]
  heroTitle: string
  heroDesc: string
  ctaQuickstart: string
  ctaDocs: string
  agentTitle: string
  agentDesc: string
  agentCopy: string
  agentCopied: string
  agentSupport: string
  agentTerminal: AgentTerminalData
  topologyColumns: TopologyColumn[]
  featureCards: FeatureCard[]
  consumerLabel: string
  consumerDesc: string
}

// ===== 中文 =====

const zh: SiteData = {
  title: 'Mail Agent — AI 时代人机一体化多邮箱聚合客户端',
  subtitle: 'AI 时代人机一体化多邮箱聚合客户端',
  description:
    '纯客户端直连、无自建邮件网关、无中转转发、不篡改原始邮件。业内首批同时兼容传统人类邮箱与新一代 Agent 智能体邮箱。',
  heroTitle: '让 AI 操作邮箱',
  heroDesc: '兼容 QQ/Gmail/163/企业邮 + Agent 原生邮箱。自然语言驱动，MCP/Skill 一键接入Agent。',
  ctaQuickstart: '快速开始',
  ctaDocs: '文档',
  slogans: [
    '海纳百川来信，一人一 Agent，共治所有邮件',
    '兼容传统邮箱与 Agent 原生邮箱，一行命令接入 AI',
    '面向 AI 时代的下一代人机统一收件中枢',
  ],
  agentTitle: 'Agent 一键接入',
  agentDesc: '复制下方提示词，发送到 Agent 对话窗口，自动完成安装和配置',
  agentCopy: '复制',
  agentCopied: '已复制 ✓',
  agentSupport: '支持 Claude Code / Cursor / Windsurf 等支持工具调用的 AI 工具',
  agentTerminal: {
    mcpSteps: [
      {
        userInput: '请按照 mcp 方式为我安装并配置 Mail Agent',
        toolCalls: [
          { type: 'bash', command: 'npm install -g @mail-agent/cli' },
          { type: 'bash', command: 'claude mcp add mail-agent -- ma mcp', annotation: '添加 MCP Server' },
        ],
        agentReply: '✅ Mail Agent MCP Server 已配置，CLI 已安装',
      },
      {
        userInput: 'ma account add gmail',
        cliOutputLines: ['🔑 选择邮箱类型: Gmail', '🌐 正在打开 OAuth2 授权页面...'],
        agentReply: '✅ Gmail 账号已添加 (me@gmail.com)',
      },
      {
        userInput: '查看我的 Gmail 最近邮件',
        toolCalls: [{ type: 'mcp', toolName: 'list_mails', params: { account_alias: '"gmail"', limit: '3' } }],
        agentReply: '',
        mailList: {
          account: 'Gmail',
          mails: [
            { unread: true, sender: 'Alice', subject: 'Meeting Notice', date: '2026-06-25' },
            { unread: false, sender: 'Bob', subject: 'Q3 Report', date: '2026-06-24' },
            { unread: false, sender: 'Agent', subject: 'Task Complete', date: '2026-06-24' },
          ],
        },
      },
    ],
    skillSteps: [
      {
        userInput: '请按照 skill 方式为我安装并配置 Mail Agent',
        toolCalls: [
          { type: 'bash', command: 'npm install -g @mail-agent/cli' },
          {
            type: 'bash',
            command: 'claude install-skill https://raw.githubusercontent.com/jadepam/mail-agent/main/cli-setup.md',
          },
        ],
        agentReply: '✅ Mail Agent Skill 已安装，CLI 已就绪',
      },
      {
        userInput: 'ma account add qq',
        cliOutputLines: ['🔑 选择邮箱类型: QQ邮箱', '📝 请输入授权码: ********'],
        agentReply: '✅ QQ邮箱账号已添加 (1234@qq.com)',
      },
      {
        userInput: '帮我查看 QQ 邮箱最近的邮件',
        toolCalls: [{ type: 'bash', command: 'ma list -a qq -n 3 --json' }],
        agentReply: '',
        mailList: {
          account: 'QQ邮箱',
          mails: [
            { unread: true, sender: '张三', subject: '会议通知', date: '2026-06-25' },
            { unread: false, sender: '李四', subject: 'Q3 报告', date: '2026-06-24' },
            { unread: false, sender: 'Agent', subject: '任务完成通知', date: '2026-06-24' },
          ],
        },
      },
    ],
    mcpPrompt:
      '请阅读 https://raw.githubusercontent.com/jadepam/mail-agent/main/cli-setup.md 文档，按照 mcp 方式为我安装并配置 Mail Agent。',
    skillPrompt:
      '请阅读 https://raw.githubusercontent.com/jadepam/mail-agent/main/cli-setup.md 文档，按照 skill 方式为我安装并配置 Mail Agent。',
    mcpSupport: '适用于 Claude Code / Cursor / Windsurf — Agent 通过 MCP 工具调用操作邮箱',
    skillSupport: '适用于 Claude Code — Agent 通过 CLI 命令操作邮箱',
    copyLabel: '复制',
    copiedLabel: '已复制 ✓',
  },
  topologyColumns: [
    {
      icon: '📧',
      title: '通用协议邮箱',
      protocol: 'IMAP / SMTP',
      providers: ['QQ 邮箱', '163 邮箱', '企业邮'],
      auth: '授权码认证',
      color: 'blue',
    },
    {
      icon: '🔑',
      title: '开放平台邮箱',
      protocol: '官方 API',
      providers: ['Gmail'],
      auth: 'OAuth2 授权',
      color: 'purple',
    },
    {
      icon: '🤖',
      title: 'Agent 原生邮箱',
      protocol: 'HTTP API',
      providers: ['Agently', '更多接入中'],
      auth: 'Token / CLI',
      color: 'emerald',
    },
  ],
  featureCards: [
    {
      icon: '🌐',
      title: '全网全量兼容',
      description: '直连 QQ/Gmail/163/企业邮，适配通用协议、官方 API 与 Agent 原生协议，一个客户端收尽所有邮件。',
      color: 'blue',
    },
    {
      icon: '🤖',
      title: '首发 Agent 原生邮箱',
      description: '业内首批兼容 Agently Mail 等智能体专属邮箱，统一归集个人邮件与 AI 通信。',
      color: 'emerald',
    },
    {
      icon: '🔒',
      title: '纯直连无损安全',
      description: '不建网关、不做中转、不改报文，100% 保留邮件原始数据，隐私安全可控。',
      color: 'purple',
    },
  ],
  consumerLabel: '你 / AI',
  consumerDesc: '自然语言 · Agent 驱动',
}

// ===== English =====

const en: SiteData = {
  title: 'Mail Agent — AI-Powered Unified Multi-Mailbox Client',
  subtitle: 'AI-Powered Unified Multi-Mailbox Client',
  description:
    'Direct client connection, no self-hosted gateway, no relay, no email modification. First to support both traditional human mailboxes and next-gen Agent-native mail.',
  heroTitle: 'One command, AI handles your email',
  heroDesc:
    'Compatible with QQ/Gmail/163/Corporate + Agent-native mail. Natural language driven, MCP/Skill one-click integration.',
  ctaQuickstart: 'Get Started',
  ctaDocs: 'Docs',
  slogans: [
    'All your mail in one place — you and your AI, together',
    'Traditional mailboxes + Agent-native mail, one command to AI',
    'The next-gen unified inbox for the AI era',
  ],
  agentTitle: 'Agent Quick Setup',
  agentDesc: 'Copy the prompt below and send it to your Agent chat window to auto-install and configure',
  agentCopy: 'Copy',
  agentCopied: 'Copied ✓',
  agentSupport: 'Works with Claude Code / Cursor / Windsurf and other tool-calling AI tools',
  agentTerminal: {
    mcpSteps: [
      {
        userInput: 'Install and configure Mail Agent using MCP mode',
        toolCalls: [
          { type: 'bash', command: 'npm install -g @mail-agent/cli' },
          { type: 'bash', command: 'claude mcp add mail-agent -- ma mcp', annotation: 'Add MCP Server' },
        ],
        agentReply: '✅ Mail Agent MCP Server configured, CLI installed',
      },
      {
        userInput: 'ma account add gmail',
        cliOutputLines: ['🔑 Select email type: Gmail', '🌐 Opening OAuth2 authorization page...'],
        agentReply: '✅ Gmail account added (me@gmail.com)',
      },
      {
        userInput: 'Show me my recent Gmail emails',
        toolCalls: [{ type: 'mcp', toolName: 'list_mails', params: { account_alias: '"gmail"', limit: '3' } }],
        agentReply: '',
        mailList: {
          account: 'Gmail',
          mails: [
            { unread: true, sender: 'Alice', subject: 'Meeting Notice', date: '2026-06-25' },
            { unread: false, sender: 'Bob', subject: 'Q3 Report', date: '2026-06-24' },
            { unread: false, sender: 'Agent', subject: 'Task Complete', date: '2026-06-24' },
          ],
        },
      },
    ],
    skillSteps: [
      {
        userInput: 'Install and configure Mail Agent using Skill mode',
        toolCalls: [
          { type: 'bash', command: 'npm install -g @mail-agent/cli' },
          {
            type: 'bash',
            command: 'claude install-skill https://raw.githubusercontent.com/jadepam/mail-agent/main/cli-setup.md',
          },
        ],
        agentReply: '✅ Mail Agent Skill installed, CLI ready',
      },
      {
        userInput: 'ma account add qq',
        cliOutputLines: ['🔑 Select email type: QQ Mail', '📝 Enter authorization code: ********'],
        agentReply: '✅ QQ Mail account added (1234@qq.com)',
      },
      {
        userInput: 'Show me my recent QQ Mail emails',
        toolCalls: [{ type: 'bash', command: 'ma list -a qq -n 3 --json' }],
        agentReply: '',
        mailList: {
          account: 'QQ Mail',
          mails: [
            { unread: true, sender: 'Alice', subject: 'Meeting Notice', date: '2026-06-25' },
            { unread: false, sender: 'Bob', subject: 'Q3 Report', date: '2026-06-24' },
            { unread: false, sender: 'Agent', subject: 'Task Complete', date: '2026-06-24' },
          ],
        },
      },
    ],
    mcpPrompt:
      'Please read https://raw.githubusercontent.com/jadepam/mail-agent/main/cli-setup.md and follow the mcp mode steps to install and configure Mail Agent.',
    skillPrompt:
      'Please read https://raw.githubusercontent.com/jadepam/mail-agent/main/cli-setup.md and follow the skill mode steps to install and configure Mail Agent.',
    mcpSupport: 'For Claude Code / Cursor / Windsurf — Agent operates email via MCP tools',
    skillSupport: 'For Claude Code — Agent operates email via CLI commands',
    copyLabel: 'Copy',
    copiedLabel: 'Copied ✓',
  },
  topologyColumns: [
    {
      icon: '📧',
      title: 'Standard Protocol',
      protocol: 'IMAP / SMTP',
      providers: ['QQ Mail', '163 Mail', 'Corporate'],
      auth: 'Auth Code',
      color: 'blue',
    },
    {
      icon: '🔑',
      title: 'Platform API',
      protocol: 'Official API',
      providers: ['Gmail'],
      auth: 'OAuth2',
      color: 'purple',
    },
    {
      icon: '🤖',
      title: 'Agent-Native',
      protocol: 'HTTP API',
      providers: ['Agently', 'More coming'],
      auth: 'Token / CLI',
      color: 'emerald',
    },
  ],
  featureCards: [
    {
      icon: '🌐',
      title: 'Universal Compatibility',
      description:
        'Direct connect to QQ/Gmail/163/Corporate via standard protocols, official APIs, and Agent-native protocols — one client for all.',
      color: 'blue',
    },
    {
      icon: '🤖',
      title: 'First Agent-Native Mail',
      description:
        'First to support Agently Mail and other agent-native mailboxes. Unified inbox for personal and AI communication.',
      color: 'emerald',
    },
    {
      icon: '🔒',
      title: 'Direct & Lossless Security',
      description:
        'No gateway, no relay, no modification. 100% original email data preserved. Privacy and security under your control.',
      color: 'purple',
    },
  ],
  consumerLabel: 'You / AI',
  consumerDesc: 'Natural Language · Agent Driven',
}

// ===== 导出 =====

const dataByLocale: Record<Locale, SiteData> = { zh, en }

export function getSiteData(locale: Locale = 'zh'): SiteData {
  return dataByLocale[locale]
}
