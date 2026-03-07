import { useEffect, useState } from 'react';
import { api, type SearchConfig, type ScrapeRun } from '../api';
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
    await api.addSearchConfig({
      searchTerm: form.searchTerm,
      location: form.location || undefined,
      minPrice: form.minPrice ? parseFloat(form.minPrice) : undefined,
      maxPrice: form.maxPrice ? parseFloat(form.maxPrice) : undefined,
    });
    toast('success', `Search "${form.searchTerm}" added`);
    setForm({ searchTerm: '', location: '', minPrice: '', maxPrice: '' });
    await reload();
  };

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold text-gray-900 mb-1">Settings</h2>
      <p className="text-sm text-gray-500 mb-6">Configure platforms and search criteria for scraping.</p>

      {/* Platform toggles */}
      <Card className="mb-5">
        <CardHeader>Platforms</CardHeader>
        <div className="grid grid-cols-3 gap-3">
          {platforms.map((p) => (
            <button
              key={p.platform}
              type="button"
              onClick={async () => {
                const next = !p.enabled;
                setPlatforms((prev) => prev.map((x) => x.platform === p.platform ? { ...x, enabled: next } : x));
                await api.togglePlatform(p.platform, next);
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
          <div className="grid grid-cols-3 gap-3">
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
                await api.clearAllSearchConfigs();
                toast('success', 'All search configs cleared');
                await reload();
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
                      await api.deleteSearchConfig(config.id);
                      toast('success', 'Search config deleted');
                      await reload();
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
