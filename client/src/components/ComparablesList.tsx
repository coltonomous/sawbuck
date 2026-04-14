import { useState, useEffect } from 'react';
import { api, type Comparable } from '../api';
import { useToast } from './Toast';
import { Spinner, ExternalLinkIcon, Card, CardHeader } from './ui';

export default function ComparablesList({ listingId }: { listingId: number }) {
  const [comps, setComps] = useState<Comparable[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    api.getComparables(listingId).then((results) => {
      if (results.length > 0) {
        setComps(results);
        setSearched(true);
      }
    }).catch(() => {});
  }, [listingId]);

  const handleSearch = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await api.searchComparables(listingId);
      const arr = Array.isArray(response) ? response : (response.comps ?? []);
      setComps(arr);
      setSearched(true);
      toast('success', `Found ${arr.length} comparable${arr.length !== 1 ? 's' : ''}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
    setLoading(false);
  };

  const activeComps = comps.filter(c => c.source === 'ebay_active' || !c.source);

  const activePrices = activeComps.map(c => c.soldPrice).filter(Boolean);
  const calcMedian = (prices: number[]) => {
    if (prices.length === 0) return 0;
    const sorted = [...prices].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const calcAvg = (prices: number[]) =>
    prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;

  return (
    <Card className="mb-4">
      <div className="flex items-center justify-between mb-3">
        <CardHeader>eBay Comparables</CardHeader>
        <button
          onClick={handleSearch}
          disabled={loading}
          className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
        >
          {loading && <Spinner size="xs" />}
          {loading ? 'Searching...' : searched ? 'Refresh Comps' : 'Search eBay Comps'}
        </button>
      </div>

      {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
      {comps.length > 0 && (
        <>
          <div className="flex gap-4 mb-4 p-3 bg-gray-50 rounded-lg flex-wrap">
            {activePrices.length > 0 && (
              <>
                <div>
                  <span className="text-[11px] text-gray-500 uppercase">Avg price</span>
                  <p className="text-lg font-semibold text-green-700">${calcAvg(activePrices).toFixed(0)}</p>
                </div>
                <div>
                  <span className="text-[11px] text-gray-500 uppercase">Median price</span>
                  <p className="text-lg font-semibold text-green-700">${calcMedian(activePrices).toFixed(0)}</p>
                </div>
              </>
            )}
            <div>
              <span className="text-[11px] text-gray-500 uppercase">Results</span>
              <p className="text-lg font-semibold text-gray-900">{comps.length}</p>
            </div>
          </div>

          <div className="space-y-2 max-h-80 overflow-y-auto">
            {comps.map((comp) => {
              const isActive = comp.source === 'ebay_active';
              return (
                <div key={comp.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                  <div className="flex-1 min-w-0 mr-3">
                    <div className="flex items-center gap-1.5">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        isActive
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-green-100 text-green-700'
                      }`}>
                        {isActive ? 'Active' : 'Sold'}
                      </span>
                      <p className="text-sm text-gray-900 truncate">{comp.title}</p>
                    </div>
                    <div className="flex gap-2 mt-0.5">
                      {comp.condition && (
                        <span className="text-[11px] text-gray-400">{comp.condition}</span>
                      )}
                      {comp.soldDate && (
                        <span className="text-[11px] text-gray-400">
                          {new Date(comp.soldDate).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-semibold text-sm text-gray-900">
                      ${comp.soldPrice}{isActive ? ' (asking)' : ''}
                    </span>
                    {comp.sourceUrl && (
                      <a
                        href={comp.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:text-blue-700"
                      >
                        <ExternalLinkIcon />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {searched && comps.length === 0 && !loading && (
        <p className="text-sm text-gray-400">No comparable sales found.</p>
      )}
    </Card>
  );
}
