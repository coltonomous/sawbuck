import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type AdminUser, type AgentRun, type PlatformSetting, type Region } from '../api';
import { useSession } from '../lib/auth';
import { useToast } from '../components/Toast';
import { Card, CardHeader } from '../components/ui';
import PipelineGraph from '../components/PipelineGraph';

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

type Tab = 'preferences' | 'users' | 'platforms' | 'agent' | 'runs';

const ADMIN_TABS: { key: Tab; label: string }[] = [
  { key: 'preferences', label: 'Preferences' },
  { key: 'users', label: 'Users' },
  { key: 'platforms', label: 'Platforms & Regions' },
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
  const [platforms, setPlatforms] = useState<PlatformSetting[]>([]);
  const [regionsData, setRegionsData] = useState<Region[]>([]);
  const [newRegion, setNewRegion] = useState({ name: '', latitude: '', longitude: '', radiusMiles: '30', clSubdomain: '' });
  const [configChangedDuringRun, setConfigChangedDuringRun] = useState(false);
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
    api.getPlatforms().then(setPlatforms).catch(() => {});
    api.getRegions().then(setRegionsData).catch(() => {});
  };

  useEffect(() => {
    api.getPreferences()
      .then(setPrefs)
      .catch((err) => toast('error', `Failed to load settings: ${err instanceof Error ? err.message : 'Unknown error'}`))
      .finally(() => setLoading(false));
    loadAdmin();
  }, []);

  // Poll agent runs every 5s while a run is in progress and the runs tab is active
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const shouldPoll = tab === 'runs' && isAdmin && agentRuns[0]?.status === 'running';
    if (shouldPoll && !pollRef.current) {
      pollRef.current = setInterval(() => {
        api.getAgentRuns().then((data) => setAgentRuns(data.recentRuns)).catch(() => {});
        api.getPlatforms().then(setPlatforms).catch(() => {});
        api.getRegions().then(setRegionsData).catch(() => {});
      }, 5_000);
    } else if (!shouldPoll && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [tab, isAdmin, agentRuns[0]?.status]);

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
        <div className="flex gap-1 mb-6 border-b border-gray-200 overflow-x-auto overflow-y-hidden -mx-1 px-1">
          {ADMIN_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setSearchParams(t.key === 'preferences' ? {} : { tab: t.key })}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap shrink-0 ${
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
              <div className="flex flex-col sm:flex-row gap-2">
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
                    <div className="flex flex-col items-end gap-0.5">
                      <span className="text-xs text-gray-400">{u.projectCount} projects{u.soldCount > 0 ? `, ${u.soldCount} sold` : ''}{u.clickCount > 0 ? ` / ${u.clickCount} clicks` : ''}</span>
                      <span className="text-[10px] text-gray-300">Joined {new Date(u.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
                    </div>
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

      {/* Platforms & Regions tab (admin) */}
      {tab === 'platforms' && isAdmin && (
        <div className="space-y-6">
          <Card>
            <CardHeader>Platforms</CardHeader>
            <p className="text-xs text-gray-500 mb-3">Enable or disable platforms for the agent pipeline.</p>
            {platforms.length === 0 ? (
              <p className="text-sm text-gray-400">No platforms configured.</p>
            ) : (
              <div className="space-y-2">
                {platforms.map((p) => (
                  <div key={p.platform} className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3">
                    <span className="text-sm font-medium text-gray-900 capitalize">{p.platform}</span>
                    <button
                      onClick={async () => {
                        try {
                          await api.updatePlatform(p.platform, !p.enabled);
                          setPlatforms((prev) => prev.map((x) => x.platform === p.platform ? { ...x, enabled: !x.enabled } : x));
                          if (agentRuns[0]?.status === 'running') setConfigChangedDuringRun(true);
                          toast('success', `${p.platform} ${!p.enabled ? 'enabled' : 'disabled'}`);
                        } catch (err) {
                          toast('error', err instanceof Error ? err.message : 'Failed');
                        }
                      }}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                        p.enabled ? 'bg-blue-600' : 'bg-gray-200'
                      }`}
                    >
                      <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
                        p.enabled ? 'translate-x-5' : 'translate-x-0'
                      }`} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader>Regions</CardHeader>
            <p className="text-xs text-gray-500 mb-3">The agent scrapes every enabled region for each enabled platform.</p>
            {regionsData.length > 0 && (
              <div className="space-y-2 mb-4">
                {regionsData.map((r) => (
                  <div key={r.id} className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3">
                    <div>
                      <span className="text-sm font-medium text-gray-900">{r.name}</span>
                      <span className="text-xs text-gray-400 ml-2">
                        {r.latitude.toFixed(2)}, {r.longitude.toFixed(2)} / {r.radiusMiles}mi
                        {r.clSubdomain ? ` (CL: ${r.clSubdomain})` : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={async () => {
                          try {
                            await api.updateRegion(r.id, { enabled: !r.enabled });
                            setRegionsData((prev) => prev.map((x) => x.id === r.id ? { ...x, enabled: !x.enabled } : x));
                            if (agentRuns[0]?.status === 'running') setConfigChangedDuringRun(true);
                          } catch (err) {
                            toast('error', err instanceof Error ? err.message : 'Failed');
                          }
                        }}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                          r.enabled ? 'bg-blue-600' : 'bg-gray-200'
                        }`}
                      >
                        <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
                          r.enabled ? 'translate-x-5' : 'translate-x-0'
                        }`} />
                      </button>
                      <button
                        onClick={async () => {
                          if (!confirm(`Delete region "${r.name}"?`)) return;
                          try {
                            await api.deleteRegion(r.id);
                            setRegionsData((prev) => prev.filter((x) => x.id !== r.id));
                            toast('success', 'Region deleted');
                          } catch (err) {
                            toast('error', err instanceof Error ? err.message : 'Failed');
                          }
                        }}
                        className="text-xs text-red-400 hover:text-red-600"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="border-t border-gray-100 pt-4">
              <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">Add Region</h4>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <input type="text" placeholder="Name (e.g. seattle)" value={newRegion.name}
                  onChange={(e) => setNewRegion({ ...newRegion, name: e.target.value })}
                  className="border border-gray-300 rounded px-2.5 py-1.5 text-sm" />
                <input type="text" placeholder="CL subdomain (optional)" value={newRegion.clSubdomain}
                  onChange={(e) => setNewRegion({ ...newRegion, clSubdomain: e.target.value })}
                  className="border border-gray-300 rounded px-2.5 py-1.5 text-sm" />
                <input type="number" step="any" placeholder="Latitude" value={newRegion.latitude}
                  onChange={(e) => setNewRegion({ ...newRegion, latitude: e.target.value })}
                  className="border border-gray-300 rounded px-2.5 py-1.5 text-sm" />
                <input type="number" step="any" placeholder="Longitude" value={newRegion.longitude}
                  onChange={(e) => setNewRegion({ ...newRegion, longitude: e.target.value })}
                  className="border border-gray-300 rounded px-2.5 py-1.5 text-sm" />
                <input type="number" placeholder="OfferUp search radius (mi)" value={newRegion.radiusMiles}
                  onChange={(e) => setNewRegion({ ...newRegion, radiusMiles: e.target.value })}
                  className="border border-gray-300 rounded px-2.5 py-1.5 text-sm" />
              </div>
              <button
                onClick={async () => {
                  if (!newRegion.name || !newRegion.latitude || !newRegion.longitude) {
                    toast('error', 'Name, latitude, and longitude are required');
                    return;
                  }
                  try {
                    const created = await api.createRegion({
                      name: newRegion.name,
                      latitude: parseFloat(newRegion.latitude),
                      longitude: parseFloat(newRegion.longitude),
                      radiusMiles: parseInt(newRegion.radiusMiles) || 30,
                      clSubdomain: newRegion.clSubdomain || null,
                    });
                    setRegionsData((prev) => [...prev, created]);
                    setNewRegion({ name: '', latitude: '', longitude: '', radiusMiles: '30', clSubdomain: '' });
                    toast('success', `Region "${created.name}" added`);
                  } catch (err) {
                    toast('error', err instanceof Error ? err.message : 'Failed to create region');
                  }
                }}
                className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                Add Region
              </button>
            </div>
          </Card>
        </div>
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
        <div className="space-y-4">
        <PipelineGraph
          latestRun={agentRuns[0] ?? null}
          platforms={platforms}
          regions={regionsData}
          configChanged={configChangedDuringRun}
          onTriggerRun={async () => {
            setConfigChangedDuringRun(false);
            try {
              await api.triggerAgentRun();
              toast('success', 'Agent pipeline run started');
              api.getAgentRuns().then((data) => setAgentRuns(data.recentRuns)).catch(() => {});
            } catch (err) {
              toast('error', err instanceof Error ? err.message : 'Failed to start run');
            }
          }}
        />
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Agent Run History</h3>
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
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      {run.completedAt && (
                        <span>{Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)}s</span>
                      )}
                      <span>{new Date(run.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                    </div>
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
        </div>
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
  { key: 'agent.fal_model', configKey: 'falModel', label: 'fal.ai model (text-to-image)', type: 'text', group: 'Models' },
  { key: 'agent.concept_edit_model', configKey: 'conceptEditModel', label: 'Concept edit model (Kontext)', type: 'text', group: 'Models' },
  { key: 'agent.max_triages', configKey: 'maxTriages', label: 'Max triages per run', type: 'number', group: 'Per-Run Caps' },
  { key: 'agent.max_evals', configKey: 'maxEvals', label: 'Max evaluations per run', type: 'number', group: 'Per-Run Caps' },
  { key: 'agent.triage_threshold', configKey: 'triageConfidenceThreshold', label: 'Triage confidence threshold', type: 'number', group: 'Quality Gates' },
  { key: 'agent.deal_score_threshold', configKey: 'dealScoreThreshold', label: 'Deal score threshold', type: 'number', group: 'Quality Gates' },
  { key: 'agent.run_interval_ms', configKey: 'runIntervalMs', label: 'Run interval (ms)', type: 'number', group: 'Scheduling' },
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
            <h4 className="text-xs font-semibold text-gray-900 uppercase tracking-wide mb-2 mt-1 pb-1 border-b border-gray-100">{group}</h4>
            <div className="space-y-2">
              {fields.map((field) => {
                const resolved = String(config[field.configKey] ?? '');
                const hasOverride = field.key in overrides;
                const value = field.key in draft ? draft[field.key] : resolved;

                return (
                  <div key={field.key} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                    <label className="text-sm text-gray-700 sm:w-56 sm:shrink-0">{field.label}</label>
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        type={field.type}
                        value={value}
                        onChange={(e) => setDraft((prev) => ({ ...prev, [field.key]: e.target.value }))}
                        className={`flex-1 min-w-0 border rounded px-2.5 py-1.5 text-sm font-mono ${
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
