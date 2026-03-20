import { useEffect, useState } from 'react';
import { api, type SearchConfig, type ScrapeRun, getStoredApiKey, setStoredApiKey, clearStoredApiKey } from '../api';
import { useToast } from '../components/Toast';
import { platformLabel, platformColor, Card, CardHeader, SearchIcon } from '../components/ui';

export default function Settings() {
  const [status, setStatus] = useState<{ recentRuns: ScrapeRun[]; configs: SearchConfig[] } | null>(null);
  const [platforms, setPlatforms] = useState<{ platform: string; enabled: boolean }[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    searchTerm: '',
    location: '',
    minPrice: '',
    maxPrice: '',
  });
  const { toast } = useToast();

  useEffect(() => {
    Promise.all([api.getScraperStatus(), api.getPlatformSettings()])
      .then(([s, p]) => { setStatus(s); setPlatforms(p); })
      .catch(console.error)
      .finally(() => setLoading(false));

    // Default location from browser geolocation
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&zoom=10`);
          const data = await res.json();
          const city = data.address?.city || data.address?.town || data.address?.county || '';
          if (city) {
            setForm((prev) => prev.location ? prev : { ...prev, location: city.toLowerCase().replace(/\s+/g, '') });
          }
        } catch {
          // Silent — location is optional
        }
      }, () => {
        // Denied or unavailable — no-op
      });
    }
  }, []);

  const reload = async () => {
    const updated = await api.getScraperStatus();
    setStatus(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.addSearchConfig({
        searchTerm: form.searchTerm,
        location: form.location || undefined,
        minPrice: form.minPrice ? parseFloat(form.minPrice) : undefined,
        maxPrice: form.maxPrice ? parseFloat(form.maxPrice) : undefined,
      });
      toast('success', `Search "${form.searchTerm}" added`);
      setForm({ searchTerm: '', location: '', minPrice: '', maxPrice: '' });
      await reload();
    } catch (err) {
      toast('error', `Failed to add search: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const [apiKey, setApiKey] = useState(getStoredApiKey() ?? '');
  const [keyVisible, setKeyVisible] = useState(false);
  const hasKey = !!getStoredApiKey();

  const handleSaveKey = () => {
    const trimmed = apiKey.trim();
    if (!trimmed) return;
    setStoredApiKey(trimmed);
    toast('success', 'API key saved');
  };

  const handleClearKey = () => {
    clearStoredApiKey();
    setApiKey('');
    toast('success', 'API key removed');
  };

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Settings</h2>
      <p className="text-sm text-gray-500 mb-6">Configure platforms and search criteria for scraping.</p>

      {/* Anthropic API key */}
      <Card className="mb-5">
        <CardHeader>Anthropic API Key</CardHeader>
        <p className="text-xs text-gray-500 mb-3">
          Required for vision analysis, pricing, and refinishing plans. Your key is stored in your browser only and never saved on the server.
        </p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={keyVisible ? 'text' : 'password'}
              placeholder="sk-ant-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm pr-10 font-mono"
            />
            <button
              type="button"
              onClick={() => setKeyVisible(!keyVisible)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              title={keyVisible ? 'Hide' : 'Show'}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                {keyVisible ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                ) : (
                  <>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </>
                )}
              </svg>
            </button>
          </div>
          <button
            onClick={handleSaveKey}
            disabled={!apiKey.trim()}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            Save
          </button>
          {hasKey && (
            <button
              onClick={handleClearKey}
              className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
        {hasKey && (
          <p className="text-xs text-green-600 mt-2">Key configured</p>
        )}
      </Card>

      {/* Platform toggles */}
      <Card className="mb-5">
        <CardHeader>Platforms</CardHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {platforms.map((p) => (
            <button
              key={p.platform}
              type="button"
              onClick={async () => {
                const next = !p.enabled;
                setPlatforms((prev) => prev.map((x) => x.platform === p.platform ? { ...x, enabled: next } : x));
                try {
                  await api.togglePlatform(p.platform, next);
                } catch (err) {
                  setPlatforms((prev) => prev.map((x) => x.platform === p.platform ? { ...x, enabled: !next } : x));
                  toast('error', `Failed to toggle platform: ${err instanceof Error ? err.message : 'Unknown error'}`);
                }
              }}
              className={`flex items-center justify-between rounded-lg border px-4 py-3 transition-all ${
                p.enabled
                  ? 'border-gray-200 bg-white shadow-sm'
                  : 'border-gray-100 bg-gray-50 opacity-60'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className={`w-2.5 h-2.5 rounded-full ${p.enabled ? platformColor(p.platform) : 'bg-gray-300'}`} />
                <span className={`text-sm font-medium ${p.enabled ? 'text-gray-900' : 'text-gray-400'}`}>
                  {platformLabel(p.platform)}
                </span>
              </div>
              <div
                className={`relative w-9 h-5 rounded-full transition-colors ${p.enabled ? 'bg-blue-600' : 'bg-gray-300'}`}
              >
                <div
                  className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                    p.enabled ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </div>
            </button>
          ))}
        </div>
      </Card>

      {/* Add search config */}
      <Card className="mb-5">
        <CardHeader>Add Search</CardHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="text"
            placeholder="Search term (e.g., mid century dresser)"
            value={form.searchTerm}
            onChange={(e) => setForm({ ...form, searchTerm: e.target.value })}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            required
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              type="text"
              placeholder="Location (e.g., seattle)"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="number"
              placeholder="Min price"
              value={form.minPrice}
              onChange={(e) => setForm({ ...form, minPrice: e.target.value })}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="number"
              placeholder="Max price"
              value={form.maxPrice}
              onChange={(e) => setForm({ ...form, maxPrice: e.target.value })}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <button type="submit" className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
            Add Search
          </button>
        </form>
      </Card>

      {/* Existing configs */}
      <Card className="mb-5">
        <div className="flex items-center justify-between mb-4">
          <CardHeader>Active Searches</CardHeader>
          {(status?.configs?.length ?? 0) > 0 && (
            <button
              onClick={async () => {
                if (!confirm('Delete all search configs?')) return;
                try {
                  await api.clearAllSearchConfigs();
                  toast('success', 'All search configs cleared');
                  await reload();
                } catch (err) {
                  toast('error', `Failed to clear configs: ${err instanceof Error ? err.message : 'Unknown error'}`);
                }
              }}
              className="text-xs text-red-500 hover:text-red-700 transition-colors"
            >
              Clear All
            </button>
          )}
        </div>
        {loading ? (
          <p className="text-gray-500 text-sm">Loading...</p>
        ) : status?.configs?.length === 0 ? (
          <div className="text-center py-6">
            <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
              <SearchIcon className="w-5 h-5 text-gray-400" />
            </div>
            <p className="text-gray-900 font-medium text-sm">No search configs yet</p>
            <p className="text-gray-400 text-xs mt-0.5">Add a search term above to start scraping.</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {status?.configs?.map((config) => (
              <li key={config.id} className="py-3 flex justify-between items-center text-sm">
                <span className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">{config.searchTerm}</span>
                  {config.location && <span className="text-gray-400">in {config.location}</span>}
                  {(config.minPrice || config.maxPrice) && (
                    <span className="text-gray-400">
                      {config.minPrice && config.maxPrice
                        ? `$${config.minPrice}–$${config.maxPrice}`
                        : config.minPrice ? `$${config.minPrice}+` : `up to $${config.maxPrice}`}
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-3">
                  {config.lastRunAt && (
                    <span className="text-xs text-gray-400">
                      Last: {new Date(config.lastRunAt).toLocaleDateString()}
                    </span>
                  )}
                  <button
                    onClick={async () => {
                      try {
                        await api.deleteSearchConfig(config.id);
                        toast('success', 'Search config deleted');
                        await reload();
                      } catch (err) {
                        toast('error', `Failed to delete config: ${err instanceof Error ? err.message : 'Unknown error'}`);
                      }
                    }}
                    className="text-xs text-red-400 hover:text-red-600 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Recent runs */}
      <Card>
        <CardHeader>Recent Scrape Runs</CardHeader>
        {status?.recentRuns?.length === 0 ? (
          <div className="text-center py-6">
            <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-gray-900 font-medium text-sm">No runs yet</p>
            <p className="text-gray-400 text-xs mt-0.5">Scraper history will appear here.</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {status?.recentRuns?.map((run) => (
              <li key={run.id} className="py-3 text-sm flex justify-between items-center">
                <span className="flex items-center gap-2">
                  <span className={`inline-block w-2 h-2 rounded-full ${platformColor(run.platform)}`} />
                  <span className="text-gray-700">{platformLabel(run.platform)}</span>
                  <span className="text-gray-400">{run.listingsNew} new / {run.listingsFound} total</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                    run.status === 'failed' ? 'bg-red-500' : run.status === 'completed' ? 'bg-green-500' : 'bg-yellow-500'
                  }`} />
                  <span className="text-xs text-gray-400">
                    {new Date(run.startedAt).toLocaleDateString()}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
