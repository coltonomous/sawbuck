import { useState, useEffect } from 'react';
import { api } from '../api';
import { useToast } from './Toast';
import { Spinner, ExternalLinkIcon, Card, CardHeader } from './ui';

interface Comparable {
  id: number;
  title: string;
  soldPrice: number;
  soldDate: string | null;
  condition: string | null;
  sourceUrl: string | null;
  source: string | null;
}

export default function ComparablesList({ listingId }: { listingId: number }) {
  const [comps, setComps] = useState<Comparable[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
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
    setLoading(true);
    setError(null);
    setBlocked(false);
    try {
      const response = await api.searchComparables(listingId);
      // Handle both old array format and new { comps, blocked } format
      const arr = Array.isArray(response) ? response : (response.comps ?? []);
      setComps(arr);
      setSearched(true);
      setBlocked(response.blocked ?? false);
      toast('success', `Found ${arr.length} comparable${arr.length !== 1 ? 's' : ''}${response.blocked ? ' (scraper blocked, using active listings)' : ''}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
    setLoading(false);
  };

  const soldComps = comps.filter(c => c.source === 'ebay_sold' || c.source === 'ebay' || !c.source);
  const activeComps = comps.filter(c => c.source === 'ebay_active');

  const soldPrices = soldComps.map(c => c.soldPrice).filter(Boolean);
  const activePrices = activeComps.map(c => c.soldPrice).filter(Boolean);
  const allPrices = comps.map(c => c.soldPrice).filter(Boolean);

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
      {blocked && (
        <p className="text-xs text-amber-600 bg-amber-50 rounded px-2 py-1 mb-3">
          Sold listings scraper was blocked — showing active listing data instead.
        </p>
      )}

      {comps.length > 0 && (
        <>
          <div className="flex gap-4 mb-4 p-3 bg-gray-50 rounded-lg flex-wrap">
            {soldPrices.length > 0 && (
              <>
                <div>
                  <span className="text-[11px] text-gray-500 uppercase">Sold avg</span>
                  <p className="text-lg font-semibold text-green-700">${calcAvg(soldPrices).toFixed(0)}</p>
                </div>
                <div>
                  <span className="text-[11px] text-gray-500 uppercase">Sold median</span>
                  <p className="text-lg font-semibold text-green-700">${calcMedian(soldPrices).toFixed(0)}</p>
                </div>
              </>
            )}
            {activePrices.length > 0 && (
              <>
                <div>
                  <span className="text-[11px] text-gray-500 uppercase">Active avg</span>
                  <p className="text-lg font-semibold text-amber-600">${calcAvg(activePrices).toFixed(0)}</p>
                </div>
                <div>
                  <span className="text-[11px] text-gray-500 uppercase">Active median</span>
                  <p className="text-lg font-semibold text-amber-600">${calcMedian(activePrices).toFixed(0)}</p>
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
