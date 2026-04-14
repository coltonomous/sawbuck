import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api, type Listing } from '../api';
import { useBackgroundEnrich } from '../hooks/useBackgroundEnrich';
import { useToast } from '../components/Toast';
import { SkeletonCard } from '../components/Skeleton';
import ListingsMap from '../components/ListingsMap';
import { PlatformBadge, Spinner, EmptyState, SearchIcon } from '../components/ui';
import { FLIP_REC_COLORS, type FlipRecommendation } from '@shared/constants';
import { resolveImageUrl } from '../utils';

function getRecBadge(listing: Listing): { label: string; bg: string } | null {
  if (!listing.analysisRaw) return null;
  try {
    const data = JSON.parse(listing.analysisRaw);
    const rec = data?.flip_recommendation as FlipRecommendation | undefined;
    return rec ? FLIP_REC_COLORS[rec] : null;
  } catch { return null; }
}

type SortOption = 'newest' | 'price_low' | 'price_high';

const PAGE_SIZE = 24;

const SORT_TO_API: Record<SortOption, { sort: string; sort_dir: string }> = {
  newest: { sort: 'scrapedAt', sort_dir: 'desc' },
  price_low: { sort: 'askingPrice', sort_dir: 'asc' },
  price_high: { sort: 'askingPrice', sort_dir: 'desc' },
};

export default function Dashboard() {
  const [allListings, setAllListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const pageRef = useRef(1);
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [platformFilter, setPlatformFilter] = useState<string>('');
  const [maxPrice, setMaxPrice] = useState<string>('');
  const [viewMode, setViewMode] = useState<'grid' | 'map'>('grid');
  const sentinelRef = useRef<HTMLDivElement>(null);

  const { toast } = useToast();

  const handleEnriched = useCallback((id: number, data: Partial<Listing>) => {
    setAllListings(prev => prev.map(l => l.id === id ? { ...l, ...data } : l));
  }, []);

  const listings = allListings;

  useBackgroundEnrich(allListings, handleEnriched);

  const buildParams = useCallback((page: number) => {
    const { sort, sort_dir } = SORT_TO_API[sortBy];
    const params: Record<string, string> = { page: String(page), limit: String(PAGE_SIZE), sort, sort_dir };
    if (platformFilter) params.platform = platformFilter;
    if (maxPrice) params.maxPrice = maxPrice;
    return params;
  }, [sortBy, platformFilter, maxPrice]);

  const loadListings = useCallback(async () => {
    setLoading(true);
    pageRef.current = 1;
    try {
      const { listings: batch, total: t } = await api.getListings(buildParams(1));
      setAllListings(batch);
      setTotal(t);
      setHasMore(batch.length < t);
    } catch (err) {
      toast('error', `Failed to load listings: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  }, [buildParams, toast]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const nextPage = pageRef.current + 1;
    try {
      const { listings: batch, total: t } = await api.getListings(buildParams(nextPage));
      pageRef.current = nextPage;
      setAllListings(prev => {
        const seen = new Set(prev.map(l => l.id));
        return [...prev, ...batch.filter(l => !seen.has(l.id))];
      });
      setTotal(t);
      setHasMore(nextPage * PAGE_SIZE < t);
    } catch {
      // Non-critical — user can scroll again to retry
    } finally {
      setLoadingMore(false);
    }
  }, [buildParams, loadingMore, hasMore]);

  useEffect(() => { loadListings(); }, [loadListings]);

  // Infinite scroll — load next page when sentinel enters viewport
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMore(); },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  const platforms = useMemo(() =>
    [...new Set(allListings.map(l => l.platform))].sort(),
    [allListings]
  );

  const enrichingCount = allListings.filter(l => !l.primaryImage).length;

  const hasActiveFilters = !!(platformFilter || maxPrice);

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Top Deals</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {total} listing{total !== 1 ? 's' : ''}
            {enrichingCount > 0 && (
              <span className="text-gray-400 ml-1">({enrichingCount} loading...)</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">Auto-discovered by agent</span>
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
        </select>
        <select
          value={platformFilter}
          onChange={e => setPlatformFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white"
        >
          <option value="">All platforms</option>
          {platforms.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <input
          type="number"
          placeholder="Max price"
          value={maxPrice}
          onChange={e => setMaxPrice(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-28"
        />
        {hasActiveFilters && (
          <button
            onClick={() => { setPlatformFilter(''); setMaxPrice(''); }}
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

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : allListings.length === 0 ? (
        <EmptyState
          icon={<SearchIcon />}
          title="No listings yet"
          subtitle="The agent is searching for deals. Check back soon!"
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
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {listings.map((listing) => (
              <Link
                key={listing.id}
                to={`/listings/${listing.id}`}
                className="group block bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md hover:border-gray-300 transition-all"
              >
                <div className="aspect-[4/3] overflow-hidden bg-gray-100 relative">
                  {listing.primaryImage ? (
                    <img
                      src={resolveImageUrl(listing.primaryImage)}
                      alt={listing.title}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full animate-pulse bg-gray-200" />
                  )}
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      api.dismissListing(listing.id).then(() => {
                        setAllListings((prev) => prev.filter((l) => l.id !== listing.id));
                      }).catch(() => {});
                    }}
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/40 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60"
                    title="Not interested"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
                <div className="p-3.5">
                  <h3 className="font-medium text-gray-900 text-sm leading-snug line-clamp-2">{listing.title}</h3>
                  <div className="mt-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <PlatformBadge platform={listing.platform} />
                      {(() => {
                        const badge = getRecBadge(listing);
                        return badge ? <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold ${badge.bg}`}>{badge.label}</span> : null;
                      })()}
                      {Date.now() - new Date(listing.scrapedAt).getTime() < 6 * 60 * 60 * 1000 && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold bg-blue-100 text-blue-700">New</span>
                      )}
                    </div>
                    {listing.askingPrice != null && (
                      <span className="font-semibold text-gray-900">${listing.askingPrice}</span>
                    )}
                  </div>
                  {listing.analysisError && (
                    <div className="mt-2 text-xs text-red-500">Analysis failed</div>
                  )}
                </div>
              </Link>
            ))}
          </div>
          {hasMore && (
            <div ref={sentinelRef} className="flex justify-center py-6">
              {loadingMore && <Spinner />}
            </div>
          )}
        </>
      )}
    </div>
  );
}
