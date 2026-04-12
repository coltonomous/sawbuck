import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, type Listing } from '../api';
import type { FormEvent } from 'react';
import { useBackgroundEnrich } from '../hooks/useBackgroundEnrich';
import { SkeletonTable } from '../components/Skeleton';
import BulkActionBar from '../components/BulkActionBar';
import { PlatformBadge, DealScoreBadge, StatusPill, EmptyState, SearchIcon, Spinner } from '../components/ui';
import { resolveImageUrl } from '../utils';
import { PLATFORMS, LISTING_STATUSES } from '@shared/constants';
import MyListings from './MyListings';

type SortKey = 'title' | 'platform' | 'askingPrice' | 'furnitureType' | 'dealScore' | 'status' | 'scrapedAt';
type SortDir = 'asc' | 'desc';
const PER_PAGE = 50;

export default function Listings() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'mine' ? 'mine' : 'all';
  const [listings, setListings] = useState<Listing[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('scrapedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [platformFilter, setPlatformFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showImport, setShowImport] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const importInputRef = useRef<HTMLInputElement>(null);

  const handleImport = async (e: FormEvent) => {
    e.preventDefault();
    const url = importUrl.trim();
    if (!url) return;
    setImporting(true);
    setImportError('');
    try {
      const { listing, alreadyExists } = await api.importListing(url);
      setImportUrl('');
      setShowImport(false);
      if (alreadyExists) {
        navigate(`/listings/${listing.id}`);
      } else {
        navigate(`/listings/${listing.id}`);
      }
    } catch (err: any) {
      setImportError(err.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  useEffect(() => {
    if (showImport) importInputRef.current?.focus();
  }, [showImport]);

  const fetchListings = useCallback(() => {
    setLoading(true);
    setSelected(new Set());
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

  if (tab === 'mine') {
    return (
      <div>
        <div className="flex gap-4 border-b border-gray-200 mb-5">
          <button onClick={() => setSearchParams({})} className="px-1 pb-2.5 text-sm font-medium text-gray-400 hover:text-gray-700 transition-colors">All Listings</button>
          <button className="px-1 pb-2.5 text-sm font-medium text-amber-600 border-b-2 border-amber-500">My Listings</button>
        </div>
        <MyListings />
      </div>
    );
  }

  return (
    <div>
      <div className="flex gap-4 border-b border-gray-200 mb-5">
        <button className="px-1 pb-2.5 text-sm font-medium text-gray-900 border-b-2 border-gray-900">All Listings</button>
        <button onClick={() => setSearchParams({ tab: 'mine' })} className="px-1 pb-2.5 text-sm font-medium text-gray-400 hover:text-gray-700 transition-colors">My Listings</button>
      </div>

      <div className="flex items-center justify-between mb-1 gap-3">
        <h2 className="text-2xl font-bold text-gray-900">All Listings</h2>
        <button
          onClick={() => { setShowImport(!showImport); setImportError(''); }}
          className={`text-sm px-3 py-1.5 rounded-lg transition-colors shrink-0 ${
            showImport
              ? 'text-gray-500 hover:text-gray-700'
              : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
          }`}
        >
          {showImport ? 'Cancel' : 'Import'}
        </button>
      </div>

      {showImport && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-5 animate-in fade-in slide-in-from-top-1">
          <form onSubmit={handleImport} className="flex gap-2">
            <div className="relative flex-1">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
                </svg>
              </div>
              <input
                ref={importInputRef}
                type="url"
                value={importUrl}
                onChange={(e) => { setImportUrl(e.target.value); setImportError(''); }}
                placeholder="https://..."
                className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-gray-400"
                disabled={importing}
              />
            </div>
            <button
              type="submit"
              disabled={importing || !importUrl.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              {importing ? (
                <>
                  <Spinner size="xs" />
                  Importing
                </>
              ) : 'Import Listing'}
            </button>
          </form>
          {importError ? (
            <p className="text-sm text-red-600 mt-2">{importError}</p>
          ) : (
            <p className="text-xs text-gray-400 mt-2">
              Craigslist, OfferUp, Mercari, eBay, or Facebook Marketplace
            </p>
          )}
        </div>
      )}

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
          subtitle="The agent is searching for deals. Check back soon!"
        />
      ) : (
        <>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-x-auto">
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
                          src={resolveImageUrl(listing.primaryImage)}
                          alt={listing.title}
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
