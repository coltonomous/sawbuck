import { useState } from 'react';
import { type RefinishingPlan as RefinishingPlanType, type RagSource } from '../api';

function parseRagSources(raw: string | null | undefined): RagSource[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s: unknown) => s && typeof s === 'object' && 'title' in (s as object));
  } catch {
    return [];
  }
}

export default function RefinishingPlan({ plan }: { plan: RefinishingPlanType }) {
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set([0]));
  const [showSources, setShowSources] = useState(false);

  const toggleStep = (index: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  };

  const totalMinutes = plan.steps.reduce((s, step) => s + step.duration_minutes, 0);
  const totalHours = Math.round(totalMinutes / 60 * 10) / 10;

  const difficultyColors: Record<string, string> = {
    beginner: 'bg-green-100 text-green-800',
    intermediate: 'bg-yellow-100 text-yellow-800',
    advanced: 'bg-red-100 text-red-800',
  };
  const difficultyColor = (plan.difficultyLevel && difficultyColors[plan.difficultyLevel]) || 'bg-gray-100 text-gray-800';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{plan.styleRecommendation}</h3>
            <p className="text-sm text-gray-600 mt-1">{plan.description}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {plan.ragSourcesUsed ? (
              <button
                onClick={() => setShowSources((v) => !v)}
                className="px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700 hover:bg-purple-200 transition-colors cursor-pointer"
              >
                {plan.ragSourcesUsed} sources
                <svg className={`inline-block w-3 h-3 ml-0.5 transition-transform ${showSources ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              </button>
            ) : null}
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${difficultyColor}`}>
              {plan.difficultyLevel}
            </span>
          </div>
        </div>

        {showSources && <RagSourceList sources={parseRagSources(plan.ragSources)} />}

        <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t text-center">
          <div>
            <p className="text-xs text-gray-500 uppercase">Time</p>
            <p className="text-lg font-semibold text-gray-900">{totalHours}h</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase">Materials</p>
            <p className="text-lg font-semibold text-gray-900">{plan.estimatedMaterialCost != null ? `$${plan.estimatedMaterialCost}` : '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase">Resale Est.</p>
            <p className="text-lg font-semibold text-green-600">{plan.estimatedResalePrice != null ? `$${plan.estimatedResalePrice}` : '—'}</p>
          </div>
        </div>
      </div>

      {/* Before/After */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
          <h4 className="text-xs font-medium text-gray-500 uppercase mb-1">Before</h4>
          <p className="text-sm text-gray-700">{plan.beforeDescription}</p>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
          <h4 className="text-xs font-medium text-gray-500 uppercase mb-1">After</h4>
          <p className="text-sm text-gray-700">{plan.afterDescription}</p>
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-2">
        {plan.steps.map((step, i) => (
          <div key={step.order} className="bg-white rounded-lg shadow-sm border border-gray-200">
            <button
              onClick={() => toggleStep(i)}
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50"
            >
              <div className="flex items-center gap-3">
                <span className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-sm font-medium">
                  {step.order}
                </span>
                <span className="font-medium text-gray-900">{step.title}</span>
              </div>
              <div className="flex items-center gap-3 text-sm text-gray-500">
                <span>{formatDuration(step.duration_minutes)}</span>
                <svg className={`w-3.5 h-3.5 transition-transform ${expandedSteps.has(i) ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              </div>
            </button>

            {expandedSteps.has(i) && (
              <div className="px-4 pb-4 border-t">
                <p className="text-sm text-gray-700 mt-3">{step.description}</p>

                {step.products.length > 0 && (
                  <div className="mt-3">
                    <h5 className="text-xs font-medium text-gray-500 uppercase mb-2">Products needed</h5>
                    <div className="space-y-1">
                      {step.products.map((p, j) => (
                        <div key={j} className="flex items-center justify-between text-sm bg-gray-50 rounded px-3 py-1.5">
                          <span>
                            <span className="font-medium">{p.brand}</span> {p.name}
                            <span className="text-gray-400 ml-1">({p.quantity} {p.unit})</span>
                          </span>
                          <span className="text-gray-600">${p.estimated_price.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {step.tips.length > 0 && (
                  <div className="mt-3">
                    <h5 className="text-xs font-medium text-gray-500 uppercase mb-1">Tips</h5>
                    <ul className="text-sm text-gray-600 space-y-1">
                      {step.tips.map((tip, j) => (
                        <li key={j} className="flex gap-2">
                          <span className="text-blue-400 shrink-0">*</span>
                          {tip}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function RagSourceList({ sources }: { sources: RagSource[] }) {
  if (sources.length === 0) return null;

  const typeLabels: Record<string, string> = {
    project: 'Past Flip',
    product: 'Product Spec',
    guide: 'Guide',
  };
  const typeColors: Record<string, string> = {
    project: 'bg-blue-50 text-blue-700',
    product: 'bg-amber-50 text-amber-700',
    guide: 'bg-green-50 text-green-700',
  };

  return (
    <div className="mt-3 pt-3 border-t border-purple-100">
      <h4 className="text-xs font-medium text-purple-600 uppercase mb-2">Knowledge base sources</h4>
      <div className="space-y-1">
        {sources.map((s, i) => {
          const isLink = s.source.startsWith('http');
          return (
            <div key={i} className="flex items-center gap-2 text-xs text-gray-600">
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${typeColors[s.type] || 'bg-gray-100 text-gray-600'}`}>
                {typeLabels[s.type] || s.type}
              </span>
              {isLink ? (
                <a href={s.source} target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline truncate">
                  {s.title}
                </a>
              ) : (
                <span className="truncate">{s.title}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
