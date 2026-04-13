/**
 * Visual representation of the agent pipeline graph.
 * Shows the fan-out from dispatch into platform x region scrape tasks,
 * then the linear flow through triage/evaluate/plan/render/summarize.
 */

import type { AgentRun, PlatformSetting, Region } from '../api';

// ── Layout constants ──────────────────────────────────────────────────
const NW = 100;   // node width
const NH = 32;    // node height
const FNW = 88;   // fan-out node width (smaller)
const FNH = 28;   // fan-out node height
const GAP_Y = 52; // vertical gap between rows
const FAN_GAP = 36; // vertical gap between fan-out nodes

const STATUS_STYLES = {
  idle:   { fill: '#f9fafb', stroke: '#d1d5db', text: '#6b7280' },
  active: { fill: '#eff6ff', stroke: '#3b82f6', text: '#1d4ed8' },
  done:   { fill: '#f0fdf4', stroke: '#22c55e', text: '#15803d' },
  error:  { fill: '#fef2f2', stroke: '#ef4444', text: '#b91c1c' },
};

type Status = keyof typeof STATUS_STYLES;

function nodeStatus(statKey: keyof AgentRun | undefined, run: AgentRun | null, nodeId?: string): Status {
  if (!run) return 'idle';
  if (run.status === 'failed' && run.errorDetails?.some((e) => e.node === nodeId)) return 'error';
  if (statKey && run[statKey] != null && (run[statKey] as number) > 0) return 'done';
  if (run.status === 'running') return 'active';
  if (run.status === 'completed') return 'done';
  return 'idle';
}

// ── Render helpers ────────────────────────────────────────────────────
function RNode({ x, y, w, h, label, subtitle, status }: {
  x: number; y: number; w: number; h: number;
  label: string; subtitle?: string | null; status: Status;
}) {
  const s = STATUS_STYLES[status];
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={5} fill={s.fill} stroke={s.stroke} strokeWidth={1.5} />
      {status === 'active' && (
        <rect x={x} y={y} width={w} height={h} rx={5} fill="none" stroke="#3b82f6" strokeWidth={2} opacity={0.4}>
          <animate attributeName="opacity" values="0.4;0;0.4" dur="2s" repeatCount="indefinite" />
        </rect>
      )}
      <text x={x + w / 2} y={y + (subtitle ? h / 2 - 3 : h / 2 + 1)} textAnchor="middle" dominantBaseline="middle" fontSize={10} fontWeight={500} fill={s.text}>{label}</text>
      {subtitle && <text x={x + w / 2} y={y + h / 2 + 9} textAnchor="middle" dominantBaseline="middle" fontSize={8} fill={s.text} opacity={0.6}>{subtitle}</text>}
    </g>
  );
}

function Arrow({ x1, y1, x2, y2, dashed }: { x1: number; y1: number; x2: number; y2: number; dashed?: boolean }) {
  return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={dashed ? '#d1d5db' : '#9ca3af'} strokeWidth={dashed ? 1 : 1.5} strokeDasharray={dashed ? '4 3' : undefined} markerEnd={dashed ? 'url(#ag)' : 'url(#a)'} />;
}

function CurveArrow({ x1, y1, x2, y2, cpx, label }: { x1: number; y1: number; x2: number; y2: number; cpx: number; label?: string }) {
  return (
    <g>
      <path d={`M ${x1} ${y1} C ${cpx} ${y1}, ${cpx} ${y2}, ${x2} ${y2}`} fill="none" stroke="#d1d5db" strokeWidth={1} strokeDasharray="4 3" markerEnd="url(#ag)" />
      {label && <text x={cpx - 10} y={(y1 + y2) / 2} fontSize={7} fill="#9ca3af" textAnchor="middle">{label}</text>}
    </g>
  );
}

// ── Main component ────────────────────────────────────────────────────
interface Props {
  latestRun: AgentRun | null;
  platforms: PlatformSetting[];
  regions: Region[];
  onTriggerRun: () => void;
  triggerDisabled?: boolean;
}

export default function PipelineGraph({ latestRun, platforms, regions, onTriggerRun, triggerDisabled }: Props) {
  const isRunning = latestRun?.status === 'running';
  const enabledPlatforms = platforms.filter((p) => p.enabled);
  const enabledRegions = regions.filter((r) => r.enabled);

  // Build fan-out labels: one node per platform showing its regions
  const fanOutItems = enabledPlatforms.flatMap((p) =>
    enabledRegions.map((r) => ({ key: `${p.platform}-${r.name}`, platform: p.platform, region: r.name }))
  );
  const fanCount = Math.max(fanOutItems.length, 1);

  // Dynamic layout calculations
  const centerX = 160;
  const fanStartY = 40 + NH + GAP_Y; // below dispatch
  const fanHeight = fanCount * FNH + (fanCount - 1) * (FAN_GAP - FNH);
  const mergeY = fanStartY + fanHeight + GAP_Y * 0.6;

  // Pipeline nodes after merge
  const pipelineNodes: { id: string; label: string; statKey?: keyof AgentRun }[] = [
    { id: 'triage', label: 'Triage', statKey: 'triaged' },
    { id: 'enrich', label: 'Enrich', statKey: 'passedTriage' },
    { id: 'reconcile', label: 'Reconcile' },
    { id: 'evaluate', label: 'Evaluate', statKey: 'evaluated' },
    { id: 'knowledge', label: 'Knowledge Gap', statKey: 'qualified' },
    { id: 'plan', label: 'Plan Options' },
    { id: 'render', label: 'Render', statKey: 'rendered' },
    { id: 'summarize', label: 'Summarize' },
  ];

  const pipeStartY = mergeY + NH + GAP_Y * 0.7;
  const totalH = pipeStartY + pipelineNodes.length * (NH + GAP_Y * 0.7) + 10;
  const svgW = centerX * 2 + 80;

  // Dispatch position
  const dispatchX = centerX - NW / 2;
  const dispatchY = 40;

  // Merge position
  const mergeX = centerX - NW / 2;

  return (
    <div className="border border-gray-200 rounded-lg bg-white p-4 overflow-x-auto">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Pipeline</h4>
        <div className="flex items-center gap-3">
          {isRunning && (
            <span className="inline-flex items-center gap-1.5 text-xs text-blue-600">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
              </span>
              Running
            </span>
          )}
          <button
            onClick={onTriggerRun}
            disabled={triggerDisabled || isRunning}
            className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {isRunning ? 'Running...' : 'Run Now'}
          </button>
        </div>
      </div>

      <svg viewBox={`0 0 ${svgW} ${totalH}`} className="w-full mx-auto" style={{ maxWidth: 420, minHeight: Math.min(totalH, 500) }}>
        <defs>
          <marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth={5} markerHeight={5} orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#9ca3af" /></marker>
          <marker id="ag" viewBox="0 0 10 10" refX="9" refY="5" markerWidth={4} markerHeight={4} orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#d1d5db" /></marker>
        </defs>

        {/* ── Dispatch node ── */}
        <RNode x={dispatchX} y={dispatchY} w={NW} h={NH} label="Dispatch"
          subtitle={`${enabledPlatforms.length}p x ${enabledRegions.length}r`}
          status={nodeStatus(undefined, latestRun, 'dispatch')} />

        {/* ── Fan-out edges + scrape nodes ── */}
        {fanOutItems.length > 0 ? fanOutItems.map((item, i) => {
          const fanY = fanStartY + i * FAN_GAP;
          const fanX = centerX - FNW / 2;
          const dcx = dispatchX + NW / 2;
          const dcy = dispatchY + NH;
          const fnCx = fanX + FNW / 2;
          const fnCy = fanY + FNH / 2;

          // Capitalize platform name
          const pLabel = item.platform.charAt(0).toUpperCase() + item.platform.slice(1, 3);
          const label = `${pLabel}/${item.region}`;

          return (
            <g key={item.key}>
              {/* Edge from dispatch to fan node */}
              <path
                d={`M ${dcx} ${dcy} C ${dcx} ${dcy + 20}, ${fnCx} ${fnCy - 20}, ${fnCx} ${fanY}`}
                fill="none" stroke="#9ca3af" strokeWidth={1} markerEnd="url(#a)"
              />
              {/* Fan-out scrape node */}
              <RNode x={fanX} y={fanY} w={FNW} h={FNH}
                label={label}
                status={nodeStatus('scraped', latestRun, 'scrapeOne')} />
              {/* Edge from fan node to merge */}
              <path
                d={`M ${fnCx} ${fanY + FNH} C ${fnCx} ${fanY + FNH + 20}, ${mergeX + NW / 2} ${mergeY - 20}, ${mergeX + NW / 2} ${mergeY}`}
                fill="none" stroke="#9ca3af" strokeWidth={1} markerEnd="url(#a)"
              />
            </g>
          );
        }) : (
          <g>
            <Arrow x1={centerX} y1={dispatchY + NH} x2={centerX} y2={mergeY} />
          </g>
        )}

        {/* ── Merge node ── */}
        <RNode x={mergeX} y={mergeY} w={NW} h={NH} label="Merge"
          subtitle={latestRun?.scraped != null ? `${latestRun.scraped} listings` : null}
          status={nodeStatus('scraped', latestRun, 'mergeScrapes')} />

        {/* ── Linear pipeline nodes ── */}
        {pipelineNodes.map((node, i) => {
          const ny = pipeStartY + i * (NH + GAP_Y * 0.7);
          const nx = centerX - NW / 2;
          const status = nodeStatus(node.statKey, latestRun, node.id);
          const count = node.statKey && latestRun ? (latestRun[node.statKey] as number | null) : null;

          return (
            <g key={node.id}>
              {/* Edge from previous node */}
              <Arrow
                x1={centerX}
                y1={i === 0 ? mergeY + NH : pipeStartY + (i - 1) * (NH + GAP_Y * 0.7) + NH}
                x2={centerX}
                y2={ny}
              />
              <RNode x={nx} y={ny} w={NW} h={NH} label={node.label}
                subtitle={count != null ? String(count) : null}
                status={status} />
            </g>
          );
        })}

        {/* ── Retry edges ── */}
        {(() => {
          // Triage retry -> dispatch
          const triageY = pipeStartY + 0 * (NH + GAP_Y * 0.7) + NH / 2;
          const evalY = pipeStartY + 3 * (NH + GAP_Y * 0.7) + NH / 2;
          const rightEdge = centerX + NW / 2 + 30;
          return (
            <g>
              <CurveArrow x1={centerX + NW / 2} y1={triageY} x2={dispatchX + NW} y2={dispatchY + NH / 2} cpx={rightEdge + 30} label="retry" />
              <CurveArrow x1={centerX + NW / 2} y1={evalY} x2={dispatchX + NW} y2={dispatchY + NH / 2} cpx={rightEdge + 50} label="retry" />
            </g>
          );
        })()}
      </svg>
    </div>
  );
}
