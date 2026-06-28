import { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// ===== i18n text maps =====

const texts = {
  zh: {
    generic: { title: '通用协议邮箱', protocol: 'IMAP / SMTP', providers: ['QQ 邮箱', '163 邮箱', '企业邮'], auth: '授权码认证' },
    platform: { title: '开放平台邮箱', protocol: '官方 API', providers: ['Gmail'], auth: 'OAuth2 授权' },
    agent: { title: 'Agent 原生邮箱', protocol: 'HTTP API', providers: ['Agently', '更多接入中'], auth: 'Token / CLI' },
    mailAgentTitle: 'Mail Agent 统一适配层',
    mailAgentDesc: '直连各类邮箱，统一交互体验',
    consumerLabel: '你 / AI',
    consumerDesc: '自然语言 · Agent 驱动',
  },
  en: {
    generic: { title: 'Standard Protocol', protocol: 'IMAP / SMTP', providers: ['QQ Mail', '163 Mail', 'Corporate'], auth: 'Auth Code' },
    platform: { title: 'Platform API', protocol: 'Official API', providers: ['Gmail'], auth: 'OAuth2' },
    agent: { title: 'Agent-Native', protocol: 'HTTP API', providers: ['Agently', 'More coming'], auth: 'Token / CLI' },
    mailAgentTitle: 'Mail Agent Unified Adapter',
    mailAgentDesc: 'Direct connect to all mailboxes, unified experience, one command to AI',
    consumerLabel: 'You / AI',
    consumerDesc: 'Natural Language · Agent Driven',
  },
} as const;

type Locale = 'zh' | 'en';

// ===== Node dimensions =====
const SOURCE_W = 200;
const SOURCE_H = 200;
const MAIL_AGENT_W = 320;
const MAIL_AGENT_H = 64;
const CONSUMER_W = 240;
const CONSUMER_H = 48;

const ROW_GAP = 80;
const ROW1_Y = 0;
const ROW2_Y = ROW1_Y + SOURCE_H + ROW_GAP;
const ROW3_Y = ROW2_Y + MAIL_AGENT_H + ROW_GAP;
const TOTAL_H = ROW3_Y + CONSUMER_H;

const nodesData = [
  { id: 'generic',  x: -280 - SOURCE_W / 2, y: ROW1_Y },
  { id: 'platform', x:    0 - SOURCE_W / 2, y: ROW1_Y },
  { id: 'agent',    x:  280 - SOURCE_W / 2, y: ROW1_Y },
  { id: 'mail-agent', x: 0 - MAIL_AGENT_W / 2,     y: ROW2_Y },
  { id: 'consumer', x: 0 - CONSUMER_W / 2,  y: ROW3_Y },
];

// ===== Custom Node Components =====

interface SourceNodeData {
  icon: string;
  title: string;
  protocol: string;
  providers: string[];
  auth: string;
  color: string;
  [key: string]: unknown;
}

function SourceNode({ data }: { data: SourceNodeData }) {
  const colors: Record<string, { border: string; bg: string; text: string; tagBg: string; tagText: string; authText: string; glow: string }> = {
    blue:    { border: 'rgba(59,130,246,0.4)',  bg: 'rgba(59,130,246,0.08)',  text: '#60a5fa', tagBg: 'rgba(59,130,246,0.15)',  tagText: '#93bbfd', authText: 'rgba(96,165,250,0.5)',  glow: '0 4px 24px rgba(59,130,246,0.2)' },
    purple:  { border: 'rgba(139,92,246,0.4)',  bg: 'rgba(139,92,246,0.08)',  text: '#a78bfa', tagBg: 'rgba(139,92,246,0.15)',  tagText: '#c4b5fd', authText: 'rgba(167,139,250,0.5)', glow: '0 4px 24px rgba(139,92,246,0.2)' },
    emerald: { border: 'rgba(16,185,129,0.4)', bg: 'rgba(16,185,129,0.08)', text: '#34d399', tagBg: 'rgba(16,185,129,0.15)', tagText: '#6ee7b7', authText: 'rgba(52,211,153,0.5)', glow: '0 4px 24px rgba(16,185,129,0.2)' },
  };
  const c = colors[data.color] || colors.blue;

  return (
    <div style={{
      background: c.bg,
      border: `1px solid ${c.border}`,
      borderRadius: 14,
      padding: '16px 20px',
      textAlign: 'center',
      width: SOURCE_W,
      height: SOURCE_H,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: c.glow,
      backdropFilter: 'blur(8px)',
    }}>
      <div style={{ fontSize: 28, marginBottom: 6 }}>{data.icon}</div>
      <div style={{ color: c.text, fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{data.title}</div>
      <div style={{ color: '#8b8fa3', fontSize: 12, marginBottom: 8 }}>{data.protocol}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 4 }}>
        {data.providers.map((name: string) => (
          <span key={name} style={{
            background: c.tagBg, color: c.tagText,
            borderRadius: 999, padding: '2px 10px', fontSize: 11, fontWeight: 500,
          }}>{name}</span>
        ))}
      </div>
      <div style={{ color: c.authText, fontSize: 12, marginTop: 8 }}>{data.auth}</div>
    </div>
  );
}

interface MailAgentNodeData {
  title: string;
  desc: string;
  [key: string]: unknown;
}

function MailAgentNode({ data }: { data: MailAgentNodeData }) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(99,102,241,0.10), rgba(99,102,241,0.20), rgba(99,102,241,0.10))',
      border: '1px solid rgba(99,102,241,0.45)',
      borderRadius: 16,
      padding: '18px 40px',
      textAlign: 'center',
      width: MAIL_AGENT_W,
      boxShadow: '0 0 60px rgba(99,102,241,0.25), inset 0 1px 0 rgba(255,255,255,0.05)',
      backdropFilter: 'blur(12px)',
    }}>
      <div style={{ color: '#a5b4fc', fontWeight: 600, fontSize: 14, letterSpacing: 2 }}>
        {data.title}
      </div>
      <div style={{ color: '#8b8fa3', fontSize: 12, marginTop: 4 }}>
        {data.desc}
      </div>
    </div>
  );
}

interface ConsumerNodeData {
  label: string;
  desc: string;
  [key: string]: unknown;
}

function ConsumerNode({ data }: { data: ConsumerNodeData }) {
  return (
    <div style={{
      background: 'rgba(18,18,26,0.9)',
      border: '1px solid rgba(99,102,241,0.3)',
      borderRadius: 14,
      padding: '14px 28px',
      textAlign: 'center',
      width: CONSUMER_W,
      boxShadow: '0 4px 24px rgba(0,0,0,0.4), 0 0 20px rgba(99,102,241,0.1)',
      backdropFilter: 'blur(8px)',
    }}>
      <div style={{ color: '#e4e4e7', fontWeight: 600, fontSize: 14 }}>{data.label}</div>
      <div style={{ color: '#8b8fa3', fontSize: 12, marginTop: 4 }}>{data.desc}</div>
    </div>
  );
}

// ===== Main Component =====

const nodeTypes = {
  source: SourceNode,
  'mail-agent': MailAgentNode,
  consumer: ConsumerNode,
};

interface TopologyFlowProps {
  locale?: Locale;
  /** When true, the diagram spans the full viewport width (homepage style).
   *  When false, it fits within its parent container (docs content style). */
  fullWidth?: boolean;
}

export default function TopologyFlow({ locale = 'zh', fullWidth = true }: TopologyFlowProps) {
  const t = texts[locale];

  const nodes: Node[] = useMemo(() => [
    {
      id: 'generic', type: 'source',
      position: { x: nodesData[0].x, y: nodesData[0].y },
      data: {
        icon: '📧', title: t.generic.title, protocol: t.generic.protocol,
        providers: t.generic.providers, auth: t.generic.auth, color: 'blue',
      },
    },
    {
      id: 'platform', type: 'source',
      position: { x: nodesData[1].x, y: nodesData[1].y },
      data: {
        icon: '🔑', title: t.platform.title, protocol: t.platform.protocol,
        providers: t.platform.providers, auth: t.platform.auth, color: 'purple',
      },
    },
    {
      id: 'agent', type: 'source',
      position: { x: nodesData[2].x, y: nodesData[2].y },
      data: {
        icon: '🤖', title: t.agent.title, protocol: t.agent.protocol,
        providers: t.agent.providers, auth: t.agent.auth, color: 'emerald',
      },
    },
    {
      id: 'mail-agent', type: 'mail-agent',
      position: { x: nodesData[3].x, y: nodesData[3].y },
      data: { title: t.mailAgentTitle, desc: t.mailAgentDesc },
    },
    {
      id: 'consumer', type: 'consumer',
      position: { x: nodesData[4].x, y: nodesData[4].y },
      data: { label: t.consumerLabel, desc: t.consumerDesc },
    },
  ], [t]);

  const edges: Edge[] = useMemo(() => [
    {
      id: 'e-generic-mail-agent', source: 'generic', target: 'mail-agent',
      sourceHandle: 'bottom', targetHandle: 'top',
      style: { stroke: '#3b82f6', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' },
    },
    {
      id: 'e-platform-mail-agent', source: 'platform', target: 'mail-agent',
      sourceHandle: 'bottom', targetHandle: 'top',
      style: { stroke: '#8b5cf6', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#8b5cf6' },
    },
    {
      id: 'e-agent-mail-agent', source: 'agent', target: 'mail-agent',
      sourceHandle: 'bottom', targetHandle: 'top',
      style: { stroke: '#10b981', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#10b981' },
    },
    {
      id: 'e-mail-agent-consumer', source: 'mail-agent', target: 'consumer',
      sourceHandle: 'bottom', targetHandle: 'top',
      style: { stroke: '#6366f1', strokeWidth: 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' },
    },
  ], []);

  const [currentNodes, , onNodesChange] = useNodesState(nodes);
  const [currentEdges, , onEdgesChange] = useEdgesState(edges);

  const wrapperStyle = fullWidth
    ? {
        width: '100vw',
        position: 'relative' as const,
        left: '50%',
        right: '50%',
        marginLeft: '-50vw',
        marginRight: '-50vw',
        height: TOTAL_H + 60,
        overflow: 'hidden',
      }
    : {
        width: '100%',
        height: TOTAL_H + 60,
        overflow: 'hidden',
      };

  return (
    <div style={wrapperStyle}>
      <div style={{
        maxWidth: 1200,
        margin: '0 auto',
        height: '100%',
      }}>
      <ReactFlow
        nodes={currentNodes}
        edges={currentEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        defaultEdgeOptions={{
          animated: true,
          type: 'smoothstep',
        }}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.5}
        maxZoom={2}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        panOnScroll={false}
        panOnDrag={false}
        preventScrolling={false}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        style={{ background: 'transparent' }}
      >
        <Background color="rgba(99,102,241,0.06)" gap={10} size={1} />
      </ReactFlow>
      </div>
    </div>
  );
}
