import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useBackgroundEnrich } from '../hooks/useBackgroundEnrich';
import { SkeletonTable } from '../components/Skeleton';
import BulkActionBar from '../components/BulkActionBar';

type SortKey = 'title' | 'platform' | 'askingPrice' | 'furnitureType' | 'dealScore' | 'status' | 'scrapedAt';
type SortDir = 'asc' | 'desc';

export default function Listings() {
  const navigate = useNavigate();
  const [listings, setListings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('scrapedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [platformFilter, setPlatformFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const perPage = 100;

  useEffect(() => {
    api.getListings({ limit: '500' })
      .then(setListings)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let result = listings;
    if (platformFilter) result = result.filter(l => l.platform === platformFilter);
    if (statusFilter) result = result.filter(l => l.status === statusFilter);
    return result;
  }, [listings, platformFilter, statusFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av = a[sortKey];
      let bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.ceil(sorted.length / perPage);
  const paginated = sorted.slice((page - 1) * perPage, page * perPage);

  const handleEnriched = useCallback((id: number, data: any) => {
    setListings(prev => prev.map(l => l.id === id ? { ...l, ...data } : l));
  }, []);

  useBackgroundEnrich(paginated, handleEnriched);

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

  const platforms = [...new Set(listings.map(l => l.platform))].sort();
  const statuses = [...new Set(listings.map(l => l.status))].sort();

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-2xl font-bold text-gray-900">All Listings</h2>
      </div>
      <p className="text-sm text-gray-500 mb-5">
        {sorted.length} listing{sorted.length !== 1 ? 's' : ''}
        {(platformFilter || statusFilter) && ` (filtered from ${listings.length})`}
      </p>

      {/* Filters */}
      <div className="flex gap-2 mb-4">
        <select
          value={platformFilter}
          onChange={e => { setPlatformFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white"
        >
          <option value="">All platforms</option>
          {platforms.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white"
        >
          <option value="">All statuses</option>
          {statuses.map(s => <option key={s} value={s}>{s}</option>)}
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
      ) : listings.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
          </div>
          <p className="text-gray-900 font-medium">No listings found</p>
          <p className="text-sm text-gray-500 mt-1">
            Run a scraper from the <a href="/" className="text-blue-600 hover:underline">Dashboard</a> or configure searches in Settings.
          </p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50/80">
                <tr>
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={paginated.length > 0 && paginated.every(l => selected.has(l.id))}
                      onChange={(e) => {
                        const next = new Set(selected);
                        paginated.forEach(l => e.target.checked ? next.add(l.id) : next.delete(l.id));
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
                {paginated.map((listing) => (
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
                        <div className="w-10 h-10 rounded-md bg-gray-100 flex items-center justify-center">
                          <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v13.5A1.5 1.5 0 003.75 21z" />
                          </svg>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-sm text-gray-900 line-clamp-1">{listing.title}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${
                        listing.platform === 'craigslist' ? 'bg-purple-100 text-purple-700' :
                        listing.platform === 'offerup' ? 'bg-teal-100 text-teal-700' :
                        listing.platform === 'ebay' ? 'bg-blue-100 text-blue-700' :
                        'bg-orange-100 text-orange-700'
                      }`}>
                        {listing.platform}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-sm font-medium text-gray-900 tabular-nums">
                      {listing.askingPrice != null ? `$${listing.askingPrice}` : <span className="text-gray-300">-</span>}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-gray-500">{listing.furnitureType || <span className="text-gray-300">-</span>}</td>
                    <td className="px-4 py-2.5 text-sm">
                      {listing.dealScore != null ? (
                        <span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${
                          listing.dealScore >= 2 ? 'bg-green-100 text-green-700' :
                          listing.dealScore >= 1.5 ? 'bg-yellow-100 text-yellow-700' :
                          'bg-gray-100 text-gray-500'
                        }`}>
                          {listing.dealScore.toFixed(1)}x
                        </span>
                      ) : <span className="text-gray-300">-</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                        listing.status === 'new' ? 'bg-blue-50 text-blue-600' :
                        listing.status === 'analyzed' ? 'bg-green-50 text-green-600' :
                        listing.status === 'watching' ? 'bg-amber-50 text-amber-600' :
                        listing.status === 'acquired' ? 'bg-purple-50 text-purple-600' :
                        listing.status === 'dismissed' ? 'bg-gray-100 text-gray-400' :
                        'bg-gray-100 text-gray-500'
                      }`}>
                        {listing.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-sm text-gray-500">
                {(page - 1) * perPage + 1}-{Math.min(page * perPage, sorted.length)} of {sorted.length}
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
          onDone={() => {
            api.getListings({ limit: '500' }).then(setListings).catch(console.error);
          }}
        />
      )}
    </div>
  );
}
