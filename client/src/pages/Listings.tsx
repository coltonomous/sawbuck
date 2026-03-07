import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Listing } from '../api';
import { useBackgroundEnrich } from '../hooks/useBackgroundEnrich';
import { SkeletonTable } from '../components/Skeleton';
import BulkActionBar from '../components/BulkActionBar';
import { PlatformBadge, DealScoreBadge, StatusPill, EmptyState, SearchIcon } from '../components/ui';
import { PLATFORMS, LISTING_STATUSES } from '@shared/constants';

type SortKey = 'title' | 'platform' | 'askingPrice' | 'furnitureType' | 'dealScore' | 'status' | 'scrapedAt';
type SortDir = 'asc' | 'desc';
const PER_PAGE = 50;

export default function Listings() {
  const navigate = useNavigate();
  const [listings, setListings] = useState<Listing[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('scrapedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [platformFilter, setPlatformFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const fetchListings = useCallback(() => {
    setLoading(true);
    const params: Record<string, string> = {
      page: String(page),
      limit: String(PER_PAGE),
      sort: sortKey,
      sort_dir: sortDir,
    };
    if (platformFilter) params.platform = platformFilter;
    if (statusFilter) params.status = statusFilter;

    api.getListings(params)
      .then(({ listings: data, total: t }) => {
        setListings(data);
        setTotal(t);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [page, sortKey, sortDir, platformFilter, statusFilter]);

  useEffect(() => { fetchListings(); }, [fetchListings]);

  const handleEnriched = useCallback((id: number, data: Partial<Listing>) => {
    setListings(prev => prev.map(l => l.id === id ? { ...l, ...data } : l));
  }, []);

  useBackgroundEnrich(listings, handleEnriched);

  const totalPages = Math.ceil(total / PER_PAGE);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'dealScore' || key === 'askingPrice' || key === 'scrapedAt' ? 'desc' : 'asc');
    }
    setPage(1);
  };

  const SortHeader = ({ label, field, className = '' }: { label: string; field: SortKey; className?: string }) => (
    <th
      onClick={() => handleSort(field)}
      className={`px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-900 select-none transition-colors ${className}`}
    >
      <span className="flex items-center gap-1">
        {label}
        {sortKey === field && (
          <span className="text-blue-600">{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>
        )}
      </span>
    </th>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-2xl font-bold text-gray-900">All Listings</h2>
      </div>
      <p className="text-sm text-gray-500 mb-5">
        {total} listing{total !== 1 ? 's' : ''}
        {(platformFilter || statusFilter) && ' (filtered)'}
      </p>

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        <select
          value={platformFilter}
          onChange={e => { setPlatformFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white"
        >
          <option value="">All platforms</option>
          {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white"
        >
          <option value="">All statuses</option>
          {LISTING_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {(platformFilter || statusFilter) && (
          <button
            onClick={() => { setPlatformFilter(''); setStatusFilter(''); setPage(1); }}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {loading ? (
        <SkeletonTable rows={8} />
      ) : total === 0 ? (
        <EmptyState
          icon={<SearchIcon />}
          title="No listings found"
          subtitle={<>Run a scraper from the <a href="/" className="text-blue-600 hover:underline">Dashboard</a> or configure searches in Settings.</>}
        />
      ) : (
        <>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50/80">
                <tr>
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={listings.length > 0 && listings.every(l => selected.has(l.id))}
                      onChange={(e) => {
                        const next = new Set(selected);
                        listings.forEach(l => e.target.checked ? next.add(l.id) : next.delete(l.id));
                        setSelected(next);
                      }}
                      className="rounded border-gray-300"
                    />
                  </th>
                  <th className="px-2 py-3 w-14"></th>
                  <SortHeader label="Title" field="title" />
                  <SortHeader label="Platform" field="platform" className="w-28" />
                  <SortHeader label="Price" field="askingPrice" className="w-24" />
                  <SortHeader label="Type" field="furnitureType" className="w-32" />
                  <SortHeader label="Score" field="dealScore" className="w-20" />
                  <SortHeader label="Status" field="status" className="w-24" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {listings.map((listing) => (
                  <tr
                    key={listing.id}
                    onClick={() => navigate(`/listings/${listing.id}`)}
                    className="hover:bg-blue-50/40 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(listing.id)}
                        onChange={() => {
                          const next = new Set(selected);
                          next.has(listing.id) ? next.delete(listing.id) : next.add(listing.id);
                          setSelected(next);
                        }}
                        className="rounded border-gray-300"
                      />
                    </td>
                    <td className="px-2 py-2.5">
                      {listing.primaryImage ? (
                        <img
                          src={listing.primaryImage.startsWith('http') ? listing.primaryImage : `/images/resized/${listing.primaryImage.replace('resized/', '')}`}
                          alt=""
                          loading="lazy"
                          className="w-10 h-10 rounded-md object-cover"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-md bg-gray-100" />
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-sm text-gray-900 line-clamp-1">{listing.title}</span>
                    </td>
                    <td className="px-4 py-2.5"><PlatformBadge platform={listing.platform} /></td>
                    <td className="px-4 py-2.5 text-sm font-medium text-gray-900 tabular-nums">
                      {listing.askingPrice != null ? `$${listing.askingPrice}` : <span className="text-gray-300">-</span>}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-gray-500">{listing.furnitureType || <span className="text-gray-300">-</span>}</td>
                    <td className="px-4 py-2.5 text-sm">
                      {listing.dealScore != null ? (
                        <DealScoreBadge score={listing.dealScore} />
                      ) : <span className="text-gray-300">-</span>}
                    </td>
                    <td className="px-4 py-2.5"><StatusPill status={listing.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-sm text-gray-500">
                {(page - 1) * PER_PAGE + 1}-{Math.min(page * PER_PAGE, total)} of {total}
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm disabled:opacity-30 hover:bg-gray-50 transition-colors"
                >
                  Prev
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`px-3 py-1.5 border rounded-lg text-sm transition-colors ${
                      p === page ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {p}
                  </button>
                ))}
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm disabled:opacity-30 hover:bg-gray-50 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {selected.size > 0 && (
        <BulkActionBar
          selected={selected}
          onClear={() => setSelected(new Set())}
          onDone={fetchListings}
        />
      )}
    </div>
  );
}
