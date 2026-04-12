import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type AdminUser, type AgentRun } from '../api';
import { useSession } from '../lib/auth';
import { useToast } from '../components/Toast';
import { Card, CardHeader } from '../components/ui';

interface Preferences {
  preferredLatitude: number | null;
  preferredLongitude: number | null;
  preferredRadiusMiles: number | null;
  maxBudget: number | null;
  shopSpace: string | null;
  experienceLevel: string | null;
  stylePreferences: string[] | null;
}

const STYLES = [
  'mid-century', 'farmhouse', 'industrial', 'victorian', 'art deco',
  'danish modern', 'colonial', 'craftsman', 'rustic', 'modern',
];

type Tab = 'preferences' | 'users' | 'agent' | 'runs';

const ADMIN_TABS: { key: Tab; label: string }[] = [
  { key: 'preferences', label: 'Preferences' },
  { key: 'users', label: 'Users' },
  { key: 'agent', label: 'Agent Config' },
  { key: 'runs', label: 'Agent Runs' },
];

export default function Settings() {
  const { data: session } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const [agentConfig, setAgentConfig] = useState<Record<string, unknown> | null>(null);
  const [agentOverrides, setAgentOverrides] = useState<Record<string, string>>({});
  const [agentDraft, setAgentDraft] = useState<Record<string, string>>({});
  const [savingAgent, setSavingAgent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { toast } = useToast();

  const isAdmin = session?.user?.role === 'admin';
  const rawTab = searchParams.get('tab') as Tab | null;
  const tab: Tab = isAdmin && rawTab && ADMIN_TABS.some((t) => t.key === rawTab) ? rawTab : 'preferences';

  const loadAdmin = () => {
    if (!isAdmin) return;
    api.getUsers().then(setAdminUsers).catch(() => {});
    api.getAgentRuns().then((data) => setAgentRuns(data.recentRuns)).catch(() => {});
    api.getAgentSettings().then(({ resolved, overrides }) => {
      setAgentConfig(resolved);
      setAgentOverrides(overrides);
      setAgentDraft({});
    }).catch(() => {});
  };

  useEffect(() => {
    api.getPreferences()
      .then(setPrefs)
      .catch((err) => toast('error', `Failed to load settings: ${err instanceof Error ? err.message : 'Unknown error'}`))
      .finally(() => setLoading(false));
    loadAdmin();
  }, []);

  const detectLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      setPrefs((prev) => prev ? { ...prev, preferredLatitude: pos.coords.latitude, preferredLongitude: pos.coords.longitude } : prev);
    });
  };

  const handleSave = async () => {
    if (!prefs) return;
    setSaving(true);
    setErrors({});
    try {
      const res = await fetch('/api/user/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          preferredLatitude: prefs.preferredLatitude,
          preferredLongitude: prefs.preferredLongitude,
          preferredRadiusMiles: prefs.preferredRadiusMiles,
          maxBudget: prefs.maxBudget,
          shopSpace: prefs.shopSpace,
          experienceLevel: prefs.experienceLevel,
          stylePreferences: prefs.stylePreferences,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.fields) {
          const fieldErrors: Record<string, string> = {};
          data.fields.forEach((f: { field: string; message: string }) => { fieldErrors[f.field] = f.message; });
          setErrors(fieldErrors);
        }
        toast('error', data.error || 'Failed to save preferences');
      } else {
        toast('success', 'Preferences saved');
      }
    } catch (err) {
      toast('error', `Failed to save: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  const toggleStyle = (style: string) => {
    setPrefs((prev) => {
      if (!prev) return prev;
      const current = prev.stylePreferences || [];
      const next = current.includes(style)
        ? current.filter((s) => s !== style)
        : [...current, style];
      return { ...prev, stylePreferences: next.length > 0 ? next : null };
    });
  };

  if (loading) return <div className="text-gray-500 text-sm">Loading...</div>;

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Settings</h2>
      <p className="text-sm text-gray-500 mb-4">
        {isAdmin ? 'Manage preferences, users, and agent configuration.' : 'Set your preferences to filter agent-discovered deals.'}
      </p>

      {/* Tab bar (admin only) */}
      {isAdmin && (
        <div className="flex gap-1 mb-6 border-b border-gray-200">
          {ADMIN_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setSearchParams(t.key === 'preferences' ? {} : { tab: t.key })}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === t.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Preferences tab */}
      {tab === 'preferences' && prefs && (
        <Card>
          <CardHeader>Deal Preferences</CardHeader>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  step="any"
                  placeholder="Latitude"
                  value={prefs.preferredLatitude ?? ''}
                  onChange={(e) => setPrefs({ ...prefs, preferredLatitude: e.target.value ? parseFloat(e.target.value) : null })}
                  className={`flex-1 border rounded-lg px-3 py-2 text-sm ${errors.preferredLatitude ? 'border-red-400' : 'border-gray-300'}`}
                />
                <input
                  type="number"
                  step="any"
                  placeholder="Longitude"
                  value={prefs.preferredLongitude ?? ''}
                  onChange={(e) => setPrefs({ ...prefs, preferredLongitude: e.target.value ? parseFloat(e.target.value) : null })}
                  className={`flex-1 border rounded-lg px-3 py-2 text-sm ${errors.preferredLongitude ? 'border-red-400' : 'border-gray-300'}`}
                />
                <button
                  type="button"
                  onClick={detectLocation}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
                >
                  Detect
                </button>
              </div>
              {(errors.preferredLatitude || errors.preferredLongitude) && (
                <p className="text-xs text-red-500 mt-1">{errors.preferredLatitude || errors.preferredLongitude}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Search radius: {prefs.preferredRadiusMiles ?? 25} miles
              </label>
              <input
                type="range"
                min={5}
                max={100}
                value={prefs.preferredRadiusMiles ?? 25}
                onChange={(e) => setPrefs({ ...prefs, preferredRadiusMiles: parseInt(e.target.value) })}
                className="w-full"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max budget</label>
              <input
                type="number"
                placeholder="e.g. 200"
                value={prefs.maxBudget ?? ''}
                onChange={(e) => setPrefs({ ...prefs, maxBudget: e.target.value ? parseFloat(e.target.value) : null })}
                className={`w-full border rounded-lg px-3 py-2 text-sm ${errors.maxBudget ? 'border-red-400' : 'border-gray-300'}`}
              />
              {errors.maxBudget && <p className="text-xs text-red-500 mt-1">{errors.maxBudget}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Workshop space</label>
              <select
                value={prefs.shopSpace ?? ''}
                onChange={(e) => setPrefs({ ...prefs, shopSpace: e.target.value || null })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">No preference</option>
                <option value="small_workshop">Small workshop</option>
                <option value="one_car_garage">1-car garage</option>
                <option value="two_car_garage">2-car garage</option>
                <option value="full_shop">Full shop</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Experience level</label>
              <select
                value={prefs.experienceLevel ?? ''}
                onChange={(e) => setPrefs({ ...prefs, experienceLevel: e.target.value || null })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">No preference</option>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Preferred styles</label>
              <div className="flex flex-wrap gap-2">
                {STYLES.map((style) => (
                  <button
                    key={style}
                    type="button"
                    onClick={() => toggleStyle(style)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      prefs.stylePreferences?.includes(style)
                        ? 'bg-blue-100 text-blue-700 border border-blue-300'
                        : 'bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200'
                    }`}
                  >
                    {style}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Save Preferences'}
            </button>
          </div>
        </Card>
      )}

      {/* Users tab (admin) */}
      {tab === 'users' && isAdmin && (
        <Card>
          <CardHeader>User Management</CardHeader>
          {adminUsers.length === 0 ? (
            <p className="text-sm text-gray-500">Loading users...</p>
          ) : (
            <div className="divide-y divide-gray-100">
              {adminUsers.map((u) => (
                <div key={u.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {u.image ? (
                      <img src={u.image} alt="" className="w-8 h-8 rounded-full shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-500 shrink-0">
                        {(u.name || u.email)[0]?.toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{u.name || u.email}</p>
                      <p className="text-xs text-gray-400 truncate">{u.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-gray-400">{u.listingCount} listings</span>
                    {u.id === session?.user?.id ? (
                      <span className="text-xs text-amber-600 font-medium px-2 py-1">Admin</span>
                    ) : (
                      <select
                        value={u.role}
                        onChange={async (e) => {
                          const role = e.target.value as 'user' | 'admin';
                          try {
                            await api.updateUserRole(u.id, role);
                            toast('success', `${u.name || u.email} set to ${role}`);
                            loadAdmin();
                          } catch (err) {
                            toast('error', err instanceof Error ? err.message : 'Failed');
                          }
                        }}
                        className="text-xs border border-gray-200 rounded px-2 py-1"
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    )}
                    {u.id !== session?.user?.id && (
                      <button
                        onClick={async () => {
                          if (!confirm(`Delete ${u.name || u.email}? This removes all their data.`)) return;
                          try {
                            await api.deleteUser(u.id);
                            toast('success', 'User deleted');
                            loadAdmin();
                          } catch (err) {
                            toast('error', err instanceof Error ? err.message : 'Failed');
                          }
                        }}
                        className="text-xs text-red-400 hover:text-red-600 transition-colors"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Agent Config tab (admin) */}
      {tab === 'agent' && isAdmin && agentConfig && (
        <AgentConfigCard
          config={agentConfig}
          overrides={agentOverrides}
          draft={agentDraft}
          setDraft={setAgentDraft}
          saving={savingAgent}
          onSave={async () => {
            const changed = Object.fromEntries(
              Object.entries(agentDraft).filter(([k, v]) => v !== String(agentConfig[k] ?? '')),
            );
            if (Object.keys(changed).length === 0) return;
            setSavingAgent(true);
            try {
              const { resolved } = await api.updateAgentSettings(changed);
              setAgentConfig(resolved);
              setAgentDraft({});
              toast('success', 'Agent settings saved');
            } catch (err) {
              toast('error', err instanceof Error ? err.message : 'Failed to save settings');
            } finally {
              setSavingAgent(false);
            }
          }}
          onReset={async (key: string) => {
            setSavingAgent(true);
            try {
              await api.updateAgentSettings({ [key]: '' });
              const { resolved, overrides } = await api.getAgentSettings();
              setAgentConfig(resolved);
              setAgentOverrides(overrides);
              setAgentDraft((prev) => { const next = { ...prev }; delete next[key]; return next; });
              toast('success', 'Reset to default');
            } catch (err) {
              toast('error', err instanceof Error ? err.message : 'Failed');
            } finally {
              setSavingAgent(false);
            }
          }}
        />
      )}

      {/* Agent Runs tab (admin) */}
      {tab === 'runs' && isAdmin && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Agent Run History</h3>
            <button
              onClick={async () => {
                try {
                  await api.triggerAgentRun();
                  toast('success', 'Agent pipeline run started');
                  setTimeout(loadAdmin, 3000);
                } catch (err) {
                  toast('error', err instanceof Error ? err.message : 'Failed to start run');
                }
              }}
              className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 transition-colors"
            >
              Run Now
            </button>
          </div>
          {agentRuns.length === 0 ? (
            <p className="text-sm text-gray-500">No agent runs yet.</p>
          ) : (
            <div className="space-y-3">
              {agentRuns.map((run) => (
                <div
                  key={run.id}
                  className={`rounded-lg border px-4 py-3 text-sm ${
                    run.status === 'failed'
                      ? 'border-red-200 bg-red-50'
                      : run.status === 'running'
                      ? 'border-yellow-200 bg-yellow-50'
                      : 'border-gray-200 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block w-2 h-2 rounded-full ${
                        run.status === 'failed' ? 'bg-red-500'
                          : run.status === 'running' ? 'bg-yellow-500'
                          : 'bg-green-500'
                      }`} />
                      <span className="font-medium text-gray-900">{run.status}</span>
                    </div>
                    <span className="text-xs text-gray-400">
                      {new Date(run.startedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                    <span>Scraped: {run.scraped ?? 0}</span>
                    <span>Triaged: {run.triaged ?? 0}</span>
                    <span>Passed: {run.passedTriage ?? 0}</span>
                    <span>Evaluated: {run.evaluated ?? 0}</span>
                    <span>Qualified: {run.qualified ?? 0}</span>
                    <span>Rendered: {run.rendered ?? 0}</span>
                  </div>
                  {run.errorsCount != null && run.errorsCount > 0 && (
                    <details className="mt-2">
                      <summary className="text-xs text-red-600 cursor-pointer">
                        {run.errorsCount} error{run.errorsCount !== 1 ? 's' : ''}
                      </summary>
                      <div className="mt-1 space-y-1">
                        {run.errorDetails?.map((err, i) => (
                          <div key={i} className="text-xs text-red-500 bg-red-50 rounded px-2 py-1">
                            <span className="font-medium">[{err.node}]</span> {err.message}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ─── Agent Config Card ──────────────────────────────────────────────

interface ConfigField {
  key: string;
  configKey: string;
  label: string;
  type: 'text' | 'number';
  group: string;
}

const CONFIG_FIELDS: ConfigField[] = [
  { key: 'agent.triage_model', configKey: 'triageModel', label: 'Triage model', type: 'text', group: 'Models' },
  { key: 'agent.eval_model', configKey: 'evaluationModel', label: 'Evaluation model (vision)', type: 'text', group: 'Models' },
  { key: 'agent.fal_model', configKey: 'falModel', label: 'fal.ai model', type: 'text', group: 'Models' },
  { key: 'agent.max_triages', configKey: 'maxTriages', label: 'Max triages per run', type: 'number', group: 'Per-Run Caps' },
  { key: 'agent.max_evals', configKey: 'maxEvals', label: 'Max evaluations per run', type: 'number', group: 'Per-Run Caps' },
  { key: 'agent.max_renders', configKey: 'maxListingsRendered', label: 'Max concept renders per run', type: 'number', group: 'Per-Run Caps' },
  { key: 'agent.concepts_per_listing', configKey: 'conceptsPerListing', label: 'Concepts per listing', type: 'number', group: 'Per-Run Caps' },
  { key: 'agent.triage_threshold', configKey: 'triageConfidenceThreshold', label: 'Triage confidence threshold', type: 'number', group: 'Quality Gates' },
  { key: 'agent.deal_score_threshold', configKey: 'dealScoreThreshold', label: 'Deal score threshold', type: 'number', group: 'Quality Gates' },
  { key: 'agent.run_interval_ms', configKey: 'runIntervalMs', label: 'Run interval (ms)', type: 'number', group: 'Scheduling' },
  { key: 'agent.target_city', configKey: 'targetCity', label: 'Target city', type: 'text', group: 'Scheduling' },
  { key: 'agent.min_delay_ms', configKey: 'minDelayBetweenRequestsMs', label: 'Min delay between requests (ms)', type: 'number', group: 'Anti-Blocking' },
  { key: 'agent.max_delay_ms', configKey: 'maxDelayBetweenRequestsMs', label: 'Max delay between requests (ms)', type: 'number', group: 'Anti-Blocking' },
  { key: 'agent.daily_request_cap', configKey: 'dailyRequestCap', label: 'Daily request cap', type: 'number', group: 'Anti-Blocking' },
  { key: 'agent.concept_size', configKey: 'conceptRenderSize', label: 'Concept render size (px)', type: 'number', group: 'Images' },
  { key: 'agent.image_retention_days', configKey: 'agentImageRetentionDays', label: 'Image retention (days)', type: 'number', group: 'Images' },
];

function AgentConfigCard({
  config,
  overrides,
  draft,
  setDraft,
  saving,
  onSave,
  onReset,
}: {
  config: Record<string, unknown>;
  overrides: Record<string, string>;
  draft: Record<string, string>;
  setDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  saving: boolean;
  onSave: () => void;
  onReset: (key: string) => void;
}) {
  const groups = CONFIG_FIELDS.reduce<Record<string, ConfigField[]>>((acc, f) => {
    if (!acc[f.group]) acc[f.group] = [];
    acc[f.group].push(f);
    return acc;
  }, {});

  const hasDraft = Object.entries(draft).some(([k, v]) => {
    const field = CONFIG_FIELDS.find((f) => f.key === k);
    return field && v !== String(config[field.configKey] ?? '');
  });

  return (
    <Card>
      <CardHeader>Agent Configuration</CardHeader>
      <p className="text-xs text-gray-400 mb-4">
        Override agent defaults. Changes take effect on the next pipeline run. Clear a field to reset to default.
      </p>
      <div className="space-y-5">
        {Object.entries(groups).map(([group, fields]) => (
          <div key={group}>
            <h4 className="text-xs font-medium text-gray-500 uppercase mb-2">{group}</h4>
            <div className="space-y-2">
              {fields.map((field) => {
                const resolved = String(config[field.configKey] ?? '');
                const hasOverride = field.key in overrides;
                const value = field.key in draft ? draft[field.key] : resolved;

                return (
                  <div key={field.key} className="flex items-center gap-2">
                    <label className="text-sm text-gray-700 w-56 shrink-0">{field.label}</label>
                    <input
                      type={field.type}
                      value={value}
                      onChange={(e) => setDraft((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      className={`flex-1 border rounded px-2.5 py-1.5 text-sm font-mono ${
                        hasOverride ? 'border-blue-300 bg-blue-50/50' : 'border-gray-300'
                      }`}
                    />
                    {hasOverride && (
                      <button
                        onClick={() => onReset(field.key)}
                        disabled={saving}
                        className="text-xs text-gray-400 hover:text-red-500 transition-colors shrink-0"
                        title="Reset to default"
                      >
                        reset
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t border-gray-100">
        <button
          onClick={onSave}
          disabled={saving || !hasDraft}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>
    </Card>
  );
}
