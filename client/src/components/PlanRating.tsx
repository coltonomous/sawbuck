import { useState, useEffect } from 'react';
import { api, type PlanRating as PlanRatingType, type PlanRatingInput } from '../api';
import StarRating from './StarRating';

interface Props {
  planId: number;
}

export default function PlanRating({ planId }: Props) {
  const [rating, setRating] = useState<PlanRatingType | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<PlanRatingInput>({ overallRating: 0 });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.getPlanRating(planId)
      .then((r) => {
        if (r) {
          setRating(r);
          setDraft({
            overallRating: r.overallRating,
            stepClarity: r.stepClarity ?? undefined,
            timeAccuracy: r.timeAccuracy ?? undefined,
            materialAccuracy: r.materialAccuracy ?? undefined,
            resultQuality: r.resultQuality ?? undefined,
            feedback: r.feedback ?? undefined,
          });
        }
      })
      .finally(() => setLoaded(true));
  }, [planId]);

  const handleSubmit = async () => {
    if (draft.overallRating < 1) return;
    setSaving(true);
    try {
      const result = await api.submitPlanRating(planId, draft);
      setRating(result);
      setExpanded(false);
    } catch {
      // silently fail
    }
    setSaving(false);
  };

  if (!loaded) return null;

  if (!expanded) {
    return (
      <div className="flex items-center gap-2">
        {rating ? (
          <>
            <span className="text-xs text-gray-500">Your rating:</span>
            <StarRating value={rating.overallRating} size="sm" readonly />
            <button
              onClick={() => setExpanded(true)}
              className="text-xs text-blue-600 hover:underline ml-1"
            >
              Edit
            </button>
          </>
        ) : (
          <button
            onClick={() => setExpanded(true)}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
            Rate this plan
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 space-y-3">
      <h4 className="text-xs font-medium text-gray-500 uppercase">Rate Refinishing Plan</h4>

      <div className="space-y-2.5">
        <RatingRow label="Overall" value={draft.overallRating} onChange={(v) => setDraft({ ...draft, overallRating: v })} required />
        <RatingRow label="Step clarity" value={draft.stepClarity ?? 0} onChange={(v) => setDraft({ ...draft, stepClarity: v })} />
        <RatingRow label="Time estimate accuracy" value={draft.timeAccuracy ?? 0} onChange={(v) => setDraft({ ...draft, timeAccuracy: v })} />
        <RatingRow label="Material recommendations" value={draft.materialAccuracy ?? 0} onChange={(v) => setDraft({ ...draft, materialAccuracy: v })} />
        <RatingRow label="Result quality" value={draft.resultQuality ?? 0} onChange={(v) => setDraft({ ...draft, resultQuality: v })} />
      </div>

      <textarea
        value={draft.feedback ?? ''}
        onChange={(e) => setDraft({ ...draft, feedback: e.target.value || undefined })}
        placeholder="Optional feedback (e.g., time estimates were way off, great product recs...)"
        rows={2}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />

      <div className="flex gap-2">
        <button
          onClick={handleSubmit}
          disabled={saving || draft.overallRating < 1}
          className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving...' : rating ? 'Update Rating' : 'Submit Rating'}
        </button>
        <button
          onClick={() => setExpanded(false)}
          className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function RatingRow({ label, value, onChange, required }: { label: string; value: number; onChange: (v: number) => void; required?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-600">
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
      </span>
      <StarRating value={value} onChange={onChange} size="sm" />
    </div>
  );
}
