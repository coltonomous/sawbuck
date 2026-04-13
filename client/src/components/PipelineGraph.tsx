/**
 * Visual representation of the agent pipeline graph.
 * Shows nodes connected by edges with status indicators based on the latest run.
 */

import type { AgentRun } from '../api';

interface PipelineNode {
  id: string;
  label: string;
  x: number;
  y: number;
  statKey?: keyof AgentRun;
}

interface PipelineEdge {
  from: string;
  to: string;
  label?: string;
  conditional?: boolean;
}

const NODES: PipelineNode[] = [
  { id: 'dispatch',   label: 'Dispatch',       x: 80,  y: 40 },
  { id: 'scrape',     label: 'Scrape',         x: 80,  y: 110, statKey: 'scraped' },
  { id: 'triage',     label: 'Triage',         x: 80,  y: 180, statKey: 'triaged' },
  { id: 'enrich',     label: 'Enrich',         x: 80,  y: 250, statKey: 'passedTriage' },
  { id: 'reconcile',  label: 'Reconcile',      x: 80,  y: 320 },
  { id: 'evaluate',   label: 'Evaluate',       x: 80,  y: 390, statKey: 'evaluated' },
  { id: 'knowledge',  label: 'Knowledge Gap',  x: 80,  y: 460, statKey: 'qualified' },
  { id: 'plan',       label: 'Plan Options',   x: 80,  y: 530 },
  { id: 'render',     label: 'Render',         x: 80,  y: 600, statKey: 'rendered' },
  { id: 'summarize',  label: 'Summarize',      x: 80,  y: 670 },
];

const EDGES: PipelineEdge[] = [
  { from: 'dispatch', to: 'scrape' },
  { from: 'scrape', to: 'triage' },
  { from: 'triage', to: 'enrich' },
  { from: 'triage', to: 'dispatch', label: 'retry', conditional: true },
  { from: 'enrich', to: 'reconcile' },
  { from: 'reconcile', to: 'evaluate' },
  { from: 'evaluate', to: 'knowledge' },
  { from: 'evaluate', to: 'dispatch', label: 'retry', conditional: true },
  { from: 'knowledge', to: 'plan' },
  { from: 'plan', to: 'render' },
  { from: 'render', to: 'summarize' },
  { from: 'triage', to: 'summarize', conditional: true },
  { from: 'reconcile', to: 'summarize', conditional: true },
  { from: 'evaluate', to: 'summarize', conditional: true },
];

const NODE_W = 120;
const NODE_H = 36;

function getNodeCenter(node: PipelineNode): { cx: number; cy: number } {
  return { cx: node.x + NODE_W / 2, cy: node.y + NODE_H / 2 };
}

function getNodeStatus(node: PipelineNode, run: AgentRun | null): 'idle' | 'active' | 'done' | 'error' {
  if (!run) return 'idle';
  if (run.status === 'failed' && run.errorDetails?.some((e) => e.node === node.id)) return 'error';
  if (node.statKey && run[node.statKey] != null && (run[node.statKey] as number) > 0) return 'done';
  if (run.status === 'running') return 'active';
  if (run.status === 'completed') return 'done';
  return 'idle';
}

const STATUS_STYLES = {
  idle: { fill: '#f9fafb', stroke: '#d1d5db', text: '#6b7280' },
  active: { fill: '#eff6ff', stroke: '#3b82f6', text: '#1d4ed8' },
  done: { fill: '#f0fdf4', stroke: '#22c55e', text: '#15803d' },
  error: { fill: '#fef2f2', stroke: '#ef4444', text: '#b91c1c' },
};

export default function PipelineGraph({ latestRun }: { latestRun: AgentRun | null }) {
  const nodeMap = new Map(NODES.map((n) => [n.id, n]));

  return (
    <div className="border border-gray-200 rounded-lg bg-white p-4 mb-4 overflow-x-auto">
      <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">Pipeline Flow</h4>
      <svg viewBox="0 0 260 720" className="w-full max-w-[280px] mx-auto" style={{ minHeight: 400 }}>
        {/* Edges */}
        {EDGES.map((edge, i) => {
          const from = nodeMap.get(edge.from);
          const to = nodeMap.get(edge.to);
          if (!from || !to) return null;

          const { cx: x1, cy: y1 } = getNodeCenter(from);
          const { cx: x2, cy: y2 } = getNodeCenter(to);

          // Retry/conditional edges curve to the right
          if (edge.conditional && edge.to === 'dispatch') {
            const cpx = x1 + 130;
            return (
              <g key={i}>
                <path
                  d={`M ${x1 + NODE_W / 2} ${y1} C ${cpx} ${y1}, ${cpx} ${y2}, ${x2 + NODE_W / 2} ${y2}`}
                  fill="none"
                  stroke="#d1d5db"
                  strokeWidth={1}
                  strokeDasharray="4 3"
                  markerEnd="url(#arrow-gray)"
                />
                {edge.label && (
                  <text x={cpx - 15} y={(y1 + y2) / 2} fontSize={8} fill="#9ca3af" textAnchor="middle">{edge.label}</text>
                )}
              </g>
            );
          }

          // Summarize shortcut edges curve to the right
          if (edge.conditional && edge.to === 'summarize') {
            const cpx = x1 + 110;
            return (
              <path
                key={i}
                d={`M ${x1 + NODE_W / 2} ${y1} C ${cpx} ${y1}, ${cpx} ${y2}, ${x2 + NODE_W / 2} ${y2}`}
                fill="none"
                stroke="#e5e7eb"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            );
          }

          // Straight edges
          return (
            <line
              key={i}
              x1={x1} y1={y1 + NODE_H / 2}
              x2={x2} y2={y2 - NODE_H / 2}
              stroke="#9ca3af"
              strokeWidth={1.5}
              markerEnd="url(#arrow)"
            />
          );
        })}

        {/* Arrow markers */}
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth={6} markerHeight={6} orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#9ca3af" />
          </marker>
          <marker id="arrow-gray" viewBox="0 0 10 10" refX="9" refY="5" markerWidth={5} markerHeight={5} orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#d1d5db" />
          </marker>
        </defs>

        {/* Nodes */}
        {NODES.map((node) => {
          const status = getNodeStatus(node, latestRun);
          const style = STATUS_STYLES[status];
          const count = node.statKey && latestRun ? (latestRun[node.statKey] as number | null) : null;

          return (
            <g key={node.id}>
              <rect
                x={node.x}
                y={node.y}
                width={NODE_W}
                height={NODE_H}
                rx={6}
                fill={style.fill}
                stroke={style.stroke}
                strokeWidth={1.5}
              />
              <text
                x={node.x + NODE_W / 2}
                y={node.y + (count != null ? 14 : 20)}
                textAnchor="middle"
                fontSize={11}
                fontWeight={500}
                fill={style.text}
              >
                {node.label}
              </text>
              {count != null && (
                <text
                  x={node.x + NODE_W / 2}
                  y={node.y + 28}
                  textAnchor="middle"
                  fontSize={9}
                  fill={style.text}
                  opacity={0.7}
                >
                  {count}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
