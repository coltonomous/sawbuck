import { useEffect, useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useBackgroundEnrich } from '../hooks/useBackgroundEnrich';
import { useToast } from '../components/Toast';
import { SkeletonCard } from '../components/Skeleton';
import ListingsMap from '../components/ListingsMap';
import { PlatformBadge, Spinner, EmptyState, SearchIcon, dealScoreColor, dealScoreTextColor } from '../components/ui';

interface ScrapeProgress {
  type: 'start' | 'config_start' | 'config_done' | 'done';
  total?: number;
  current?: number;
  platform?: string;
  searchTerm?: string;
  result?: { found: number; relevant?: number; filtered?: number; new: number; error?: string };
  results?: { found: number; relevant?: number; filtered?: number; new: number; error?: string }[];
}

type SortOption = 'newest' | 'price_low' | 'price_high' | 'score';

export default function Dashboard() {
  const [allListings, setAllListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [progress, setProgress] = useState<ScrapeProgress | null>(null);
  const [completedSteps, setCompletedSteps] = useState<ScrapeProgress[]>([]);
  const [scrapeResult, setScrapeResult] = useState<string | null>(null);

  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [platformFilter, setPlatformFilter] = useState<string>('');
  const [maxPrice, setMaxPrice] = useState<string>('');
  const [searchTermFilter, setSearchTermFilter] = useState<string>('');
  const [viewMode, setViewMode] = useState<'grid' | 'map'>('grid');

  const { toast } = useToast();

  const handleEnriched = useCallback((id: number, data: any) => {
    setAllListings(prev => prev.map(l => l.id === id ? { ...l, ...data } : l));
  }, []);

  // Only show listings that have images
  const listings = useMemo(() => {
    let result = allListings.filter(l => l.primaryImage);
    if (platformFilter) result = result.filter(l => l.platform === platformFilter);
    if (maxPrice) {
      const max = parseFloat(maxPrice);
      if (!isNaN(max)) result = result.filter(l => l.askingPrice != null && l.askingPrice <= max);
    }
    if (searchTermFilter) {
      result = result.filter(l => {
        try {
          const terms: string[] = l.matchedSearchTerms ? JSON.parse(l.matchedSearchTerms) : [];
          return terms.includes(searchTermFilter);
        } catch { return false; }
      });
    }
    result.sort((a, b) => {
      switch (sortBy) {
        case 'price_low':
          return (a.askingPrice ?? Infinity) - (b.askingPrice ?? Infinity);
        case 'price_high':
          return (b.askingPrice ?? 0) - (a.askingPrice ?? 0);
        case 'score':
          if (a.dealScore != null && b.dealScore != null) return b.dealScore - a.dealScore;
          if (a.dealScore != null) return -1;
          if (b.dealScore != null) return 1;
          return b.id - a.id;
        case 'newest':
        default:
          return b.id - a.id;
      }
    });
    return result;
  }, [allListings, sortBy, platformFilter, maxPrice, searchTermFilter]);

  useBackgroundEnrich(allListings, handleEnriched);

  const loadListings = async () => {
    try {
      const [cl, ou, mc, eb] = await Promise.all([
        api.getListings({ limit: '50', platform: 'craigslist', sort: 'scrapedAt', sort_dir: 'desc' }),
        api.getListings({ limit: '50', platform: 'offerup', sort: 'scrapedAt', sort_dir: 'desc' }),
        api.getListings({ limit: '50', platform: 'mercari', sort: 'scrapedAt', sort_dir: 'desc' }).catch(() => ({ listings: [], total: 0 })),
        api.getListings({ limit: '50', platform: 'ebay', sort: 'scrapedAt', sort_dir: 'desc' }).catch(() => ({ listings: [], total: 0 })),
      ]);
      const seen = new Set<number>();
      const all = [...cl.listings, ...ou.listings, ...mc.listings, ...eb.listings]
        .filter(l => { if (seen.has(l.id)) return false; seen.add(l.id); return true; });
      setAllListings(all);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadListings(); }, []);

  const platforms = useMemo(() =>
    [...new Set(allListings.map(l => l.platform))].sort(),
    [allListings]
  );

  const searchTerms = useMemo(() => {
    const terms = new Set<string>();
    allListings.forEach(l => {
      try {
        const t: string[] = l.matchedSearchTerms ? JSON.parse(l.matchedSearchTerms) : [];
        t.forEach(s => terms.add(s));
      } catch {}
    });
    return [...terms].sort();
  }, [allListings]);

  const enrichingCount = allListings.filter(l => !l.primaryImage).length;

  const handleScrape = () => {
    setScraping(true);
    setScrapeResult(null);
    setProgress(null);
    setCompletedSteps([]);

    const eventSource = new EventSource('/api/scrapers/run/stream');

    eventSource.addEventListener('start', (e) => {
      setProgress(JSON.parse(e.data));
    });

    eventSource.addEventListener('config_start', (e) => {
      setProgress(JSON.parse(e.data));
    });

    eventSource.addEventListener('config_done', (e) => {
      const data = JSON.parse(e.data);
      setProgress(data);
      setCompletedSteps((prev) => [...prev, data]);
    });

    eventSource.addEventListener('done', (e) => {
      const data = JSON.parse(e.data);
      const results = data.results || [];
      const totalNew = results.reduce((sum: number, r: any) => sum + (r.new || 0), 0);
      const totalRelevant = results.reduce((sum: number, r: any) => sum + (r.relevant || r.found || 0), 0);
      const totalFiltered = results.reduce((sum: number, r: any) => sum + (r.filtered || 0), 0);
      const msg = results.length === 0
        ? 'No search configs found. Add some in Settings first.'
        : `${totalRelevant} relevant listings${totalFiltered ? ` (${totalFiltered} irrelevant filtered)` : ''}, ${totalNew} new.`;
      setScrapeResult(msg);
      toast(results.length === 0 ? 'info' : 'success', msg);
      setScraping(false);
      setProgress(null);
      loadListings();
      eventSource.close();
    });

    eventSource.addEventListener('close', () => {
      eventSource.close();
    });

    eventSource.onerror = () => {
      setScraping(false);
      setProgress(null);
      setScrapeResult('Connection lost during scrape.');
      toast('error', 'Connection lost during scrape.');
      eventSource.close();
    };
  };

  const hasActiveFilters = !!(platformFilter || maxPrice || searchTermFilter);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Top Deals</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {listings.length} listing{listings.length !== 1 ? 's' : ''}
            {enrichingCount > 0 && (
              <span className="text-gray-400 ml-1">({enrichingCount} loading...)</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {scrapeResult && !scraping && (
            <span className={`text-sm ${scrapeResult.startsWith('Error') || scrapeResult.includes('No search') || scrapeResult.includes('lost') ? 'text-amber-600' : 'text-green-600'}`}>
              {scrapeResult}
            </span>
          )}
          <button
            onClick={handleScrape}
            disabled={scraping}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {scraping && <Spinner />}
            {scraping ? 'Scraping...' : 'Run Scraper'}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as SortOption)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white"
        >
          <option value="newest">Newest first</option>
          <option value="price_low">Price: low to high</option>
          <option value="price_high">Price: high to low</option>
          <option value="score">Best deals</option>
        </select>
        <select
          value={platformFilter}
          onChange={e => setPlatformFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white"
        >
          <option value="">All platforms</option>
          {platforms.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        {searchTerms.length > 1 && (
          <select
            value={searchTermFilter}
            onChange={e => setSearchTermFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            <option value="">All searches</option>
            {searchTerms.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <input
          type="number"
          placeholder="Max price"
          value={maxPrice}
          onChange={e => setMaxPrice(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-28"
        />
        {hasActiveFilters && (
          <button
            onClick={() => { setPlatformFilter(''); setMaxPrice(''); setSearchTermFilter(''); }}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            Clear filters
          </button>
        )}
        <div className="flex border border-gray-300 rounded-lg overflow-hidden ml-auto">
          <button
            onClick={() => setViewMode('grid')}
            className={`px-2.5 py-1.5 ${viewMode === 'grid' ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'} transition-colors`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 16a1 1 0 011-1h4a1 1 0 011 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-3zm10-2a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1h-4a1 1 0 01-1-1v-5z" />
            </svg>
          </button>
          <button
            onClick={() => setViewMode('map')}
            className={`px-2.5 py-1.5 ${viewMode === 'map' ? 'bg-gray-900 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'} transition-colors`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Progress panel */}
      {scraping && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 mb-6">
          <div className="flex items-center gap-3 mb-3">
            <Spinner size="md" color="blue" />
            <span className="text-sm font-medium text-gray-700">
              {progress?.type === 'config_start'
                ? `Scraping ${progress.platform} "${progress.searchTerm}" (${progress.current}/${progress.total})...`
                : progress?.type === 'start'
                ? `Starting scraper (${progress.total} search${progress.total === 1 ? '' : 'es'})...`
                : 'Preparing...'}
            </span>
          </div>

          {progress?.total && (
            <div className="w-full bg-gray-100 rounded-full h-1.5 mb-3">
              <div
                className="bg-blue-600 h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${(completedSteps.length / progress.total) * 100}%` }}
              />
            </div>
          )}

          {completedSteps.length > 0 && (
            <div className="space-y-1.5">
              {completedSteps.map((step, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className={`flex items-center gap-1.5 ${step.result?.error ? 'text-red-500' : 'text-gray-500'}`}>
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
                      step.result?.error ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'
                    }`}>
                      {step.result?.error ? '\u2717' : '\u2713'}
                    </span>
                    {step.platform} "{step.searchTerm}"
                  </span>
                  <span className={step.result?.error ? 'text-red-500' : 'text-green-600'}>
                    {step.result?.error
                      ? 'failed'
                      : `${step.result?.relevant ?? step.result?.found} relevant${step.result?.filtered ? ` (${step.result.filtered} filtered)` : ''}, ${step.result?.new} new`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : allListings.length === 0 ? (
        <EmptyState
          icon={<SearchIcon />}
          title="No listings yet"
          subtitle={<>Configure search terms in <Link to="/settings" className="text-blue-600 hover:underline">Settings</Link>, then run the scraper.</>}
        />
      ) : listings.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-sm">No listings match your filters.</p>
          {enrichingCount > 0 && (
            <p className="text-xs mt-1">Still loading details for {enrichingCount} listings...</p>
          )}
        </div>
      ) : viewMode === 'map' ? (
        <ListingsMap listings={listings} />
      ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {listings.map((listing) => (
              <Link
                key={listing.id}
                to={`/listings/${listing.id}`}
                className="group block bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md hover:border-gray-300 transition-all"
              >
                <div className="aspect-[4/3] overflow-hidden bg-gray-100">
                  <img
                    src={listing.primaryImage.startsWith('http') ? listing.primaryImage : `/images/${listing.primaryImage}`}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                </div>
                <div className="p-3.5">
                  <h3 className="font-medium text-gray-900 text-sm leading-snug line-clamp-2">{listing.title}</h3>
                  <div className="mt-2.5 flex items-center justify-between">
                    <PlatformBadge platform={listing.platform} />
                    {listing.askingPrice != null && (
                      <span className="font-semibold text-gray-900">${listing.askingPrice}</span>
                    )}
                  </div>
                  {listing.dealScore != null && (
                    <div className="mt-2">
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${dealScoreColor(listing.dealScore)}`}
                            style={{ width: `${Math.min(listing.dealScore / 3 * 100, 100)}%` }}
                          />
                        </div>
                        <span className={`text-[11px] font-semibold ${dealScoreTextColor(listing.dealScore)}`}>
                          {listing.dealScore.toFixed(1)}x
                        </span>
                      </div>
                    </div>
                  )}
                  {listing.matchedSearchTerms && (() => {
                    try {
                      const terms: string[] = JSON.parse(listing.matchedSearchTerms);
                      return terms.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {terms.map(t => (
                            <span key={t} className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 text-[11px]">
                              {t}
                            </span>
                          ))}
                        </div>
                      ) : null;
                    } catch { return null; }
                  })()}
                </div>
              </Link>
            ))}
          </div>
      )}
    </div>
  );
}
