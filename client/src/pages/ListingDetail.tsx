import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, type ListingDetail as ListingDetailType, type ListingImage, type RagSource } from '../api';
import { FLIP_REC_COLORS, type FlipRecommendation } from '@shared/constants';
import { useSession } from '../lib/auth';
import { useToast } from '../components/Toast';
import { SkeletonDetail } from '../components/Skeleton';
import ComparablesList from '../components/ComparablesList';
import { PlatformBadge, DealScoreBadge, Spinner, EmptyState, BackButton, ExternalLinkIcon, NotFoundIcon, Card, CardHeader } from '../components/ui';
import { resolveImageUrl } from '../utils';

export default function ListingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: session } = useSession();
  const [listing, setListing] = useState<ListingDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [showRagSources, setShowRagSources] = useState(false);
  const [projectForm, setProjectForm] = useState({ name: '', purchasePrice: '' });
  const projectFormRef = useRef<HTMLDivElement>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState({ title: '', description: '', askingPrice: '', location: '' });
  const [savingEdit, setSavingEdit] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (!id) return;
    api.getListing(parseInt(id))
      .then(setListing)
      .catch((err) => toast('error', `Failed to load listing: ${err instanceof Error ? err.message : 'Unknown error'}`))
      .finally(() => setLoading(false));
  }, [id]);

  const handleAnalyze = async () => {
    if (!listing) return;
    setAnalyzing(true);
    try {
      await api.analyzeListing(listing.id);
      // Poll until analysis completes or fails
      const poll = setInterval(async () => {
        try {
          const updated = await api.getListing(listing.id);
          if (updated.furnitureType) {
            clearInterval(poll);
            setListing(updated);
            setAnalyzing(false);
            toast('success', 'Analysis complete');
          } else if (updated.analysisError) {
            clearInterval(poll);
            setListing(updated);
            setAnalyzing(false);
            toast('error', updated.analysisError);
          }
        } catch {}
      }, 3000);
      // Stop polling after 5 minutes
      setTimeout(() => {
        clearInterval(poll);
        if (analyzing) {
          setAnalyzing(false);
          toast('error', 'Analysis timed out — check server logs');
        }
      }, 300_000);
    } catch (err) {
      toast('error', `Analysis failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setAnalyzing(false);
    }
  };

  const handleCreateProject = async () => {
    if (!listing || !projectForm.name || !projectForm.purchasePrice) return;
    try {
      const project = await api.createProject({
        listingId: listing.id,
        name: projectForm.name,
        purchasePrice: parseFloat(projectForm.purchasePrice),
      });
      navigate(`/projects/${project.id}`);
    } catch (err) {
      toast('error', `Failed to create project: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  // Parse analysis verdict from raw JSON
  let analysisData: Record<string, unknown> | null = null;
  try { analysisData = listing?.analysisRaw ? JSON.parse(listing.analysisRaw) : null; } catch {}
  const rec = analysisData?.flip_recommendation as FlipRecommendation | undefined;
  const recMeta = rec ? FLIP_REC_COLORS[rec] : null;
  const recStyle = recMeta?.bg ?? '';
  const recLabel = recMeta?.label ?? null;

  if (loading) return <SkeletonDetail />;
  if (!listing) return (
    <EmptyState
      icon={<NotFoundIcon />}
      title="Listing not found"
      subtitle="It may have been removed or the link is incorrect."
      action={
        <button onClick={() => navigate('/listings')} className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors">
          Back to Listings
        </button>
      }
    />
  );

  return (
    <div className="max-w-4xl">
      <BackButton onClick={() => navigate(-1)} />

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-bold text-gray-900">{listing.title}</h2>
          <div className="flex items-center gap-2 mt-1.5">
            <PlatformBadge platform={listing.platform} />
            <span className="text-sm text-gray-500">{listing.location || 'No location'}</span>
          </div>
          {listing.matchedSearchTerms && (() => {
            try {
              const terms: string[] = JSON.parse(listing.matchedSearchTerms);
              return terms.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {terms.map((t: string) => (
                    <span key={t} className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs">{t}</span>
                  ))}
                </div>
              ) : null;
            } catch { return null; }
          })()}
        </div>
        <div className="text-right shrink-0">
          {listing.askingPrice != null && (
            <p className="text-3xl font-bold text-gray-900">${listing.askingPrice}</p>
          )}
          {listing.dealScore != null && (
            <DealScoreBadge score={listing.dealScore} className="inline-block mt-1.5 px-2.5 py-1 rounded-lg text-xs" />
          )}
        </div>
      </div>

      {/* Images */}
      {listing.images?.length > 0 && (
        <div className="flex gap-2 overflow-x-auto mb-6 pb-2 -mx-1 px-1">
          {listing.images.map((img: ListingImage) => (
            <img
              key={img.id}
              src={resolveImageUrl(img.localPathResized || img.localPathOriginal || img.sourceUrl || '')}
              alt={listing.title}
              loading="lazy"
              className="h-52 rounded-lg object-cover shrink-0 bg-gray-100"
            />
          ))}
        </div>
      )}

      {/* Description */}
      {listing.description && (
        <Card className="mb-4">
          <CardHeader>Description</CardHeader>
          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{listing.description}</p>
        </Card>
      )}

      {/* Analysis */}
      {listing.furnitureType ? (
        <Card className="mb-4">
          <div className="flex items-center justify-between mb-4">
            <CardHeader>Analysis</CardHeader>
            <div className="flex items-center gap-2">
              {analysisData?.rag_sources_used ? (
                <button
                  onClick={() => setShowRagSources((v) => !v)}
                  className="px-2 py-0.5 rounded-lg text-xs font-medium bg-purple-100 text-purple-700 hover:bg-purple-200 transition-colors cursor-pointer"
                >
                  {String(analysisData.rag_sources_used)} sources
                  <svg className={`inline-block w-3 h-3 ml-0.5 transition-transform ${showRagSources ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                </button>
              ) : null}
              {recLabel && (
                <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${recStyle}`}>{recLabel}</span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Type</span>
              <span className="font-medium text-gray-900">{listing.furnitureType}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Style</span>
              <span className="font-medium text-gray-900">{listing.furnitureStyle}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Condition</span>
              <span className="font-medium text-gray-900">{listing.conditionScore}/10</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Wood</span>
              <span className="font-medium text-gray-900">{listing.woodSpecies || 'Unknown'}</span>
            </div>
            {listing.estimatedValue && (
              <div className="flex justify-between">
                <span className="text-gray-500">Est. value (as-is)</span>
                <span className="font-medium text-green-700">${listing.estimatedValue}</span>
              </div>
            )}
            {listing.estimatedRefinishedValue && (
              <div className="flex justify-between">
                <span className="text-gray-500">Est. value (refinished)</span>
                <span className="font-medium text-green-700">${listing.estimatedRefinishedValue}</span>
              </div>
            )}
          </div>
          {showRagSources && Array.isArray(analysisData?.rag_sources) ? (
            <AnalysisRagSources sources={analysisData.rag_sources as RagSource[]} />
          ) : null}
          {listing.conditionNotes && (
            <p className="mt-4 pt-3 border-t text-sm text-gray-600 leading-relaxed">{listing.conditionNotes}</p>
          )}
          {typeof analysisData?.refinishing_profit_verdict === 'string' && (
            <p className="mt-3 pt-3 border-t text-sm text-gray-700 leading-relaxed font-medium">{String(analysisData.refinishing_profit_verdict)}</p>
          )}
        </Card>
      ) : listing.userId === session?.user?.id || listing.platform === 'sawbuck' ? (
        <button
          onClick={handleAnalyze}
          disabled={analyzing}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors mb-4 flex items-center gap-2"
        >
          {analyzing && <Spinner />}
          {analyzing ? 'Analyzing...' : 'Analyze with Claude'}
        </button>
      ) : null}

      {/* Comparables — hidden while transitioning away from eBay comps */}
      {/* {listing.furnitureType && <ComparablesList listingId={listing.id} />} */}

      {/* Actions */}
      <div className="flex flex-wrap gap-2.5 mb-6">
        {listing.platform !== 'sawbuck' && listing.url && (
          <a
            href={listing.url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors inline-flex items-center gap-2"
          >
            View Original
            <ExternalLinkIcon />
          </a>
        )}
        {listing.status !== 'acquired' && (
          <button
            onClick={() => {
              setProjectForm({ name: listing.title, purchasePrice: listing.askingPrice?.toString() || '' });
              setShowProjectForm(true);
              setTimeout(() => projectFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
            }}
            className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
          >
            Start Project
          </button>
        )}
        {listing.status !== 'dismissed' && (
          <button
            onClick={() => api.updateListing(listing.id, { status: 'dismissed' }).then(() => setListing({ ...listing, status: 'dismissed' })).catch((err) => toast('error', `Failed to dismiss: ${err instanceof Error ? err.message : 'Unknown error'}`))}
            className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            Dismiss
          </button>
        )}
        {listing.platform === 'sawbuck' && listing.userId === session?.user?.id && (
          <>
            <button
              onClick={() => {
                setEditForm({
                  title: listing.title,
                  description: listing.description || '',
                  askingPrice: listing.askingPrice?.toString() || '',
                  location: listing.location || '',
                });
                setShowEdit(!showEdit);
              }}
              className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
            >
              {showEdit ? 'Cancel Edit' : 'Edit'}
            </button>
            <button
              onClick={async () => {
                if (!confirm('Delete this listing? This cannot be undone.')) return;
                try {
                  await api.deleteListing(listing.id);
                  toast('success', 'Listing deleted');
                  navigate('/listings?tab=mine');
                } catch (err) {
                  toast('error', err instanceof Error ? err.message : 'Failed to delete');
                }
              }}
              className="px-4 py-2 bg-white border border-red-300 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 transition-colors"
            >
              Delete
            </button>
          </>
        )}
      </div>

      {/* Edit form for own sawbuck listings */}
      {showEdit && (
        <div className="bg-white rounded-lg shadow-sm border-2 border-amber-200 p-5 mb-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Edit Listing</h3>
          <div className="space-y-3">
            <input
              type="text" value={editForm.title}
              onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              placeholder="Title"
            />
            <textarea
              value={editForm.description}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
              placeholder="Description (optional)"
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                type="number" value={editForm.askingPrice}
                onChange={(e) => setEditForm({ ...editForm, askingPrice: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                placeholder="Price" min="0" step="0.01"
              />
              <input
                type="text" value={editForm.location}
                onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                placeholder="Location (optional)"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  setSavingEdit(true);
                  try {
                    const updated = await api.editSawbuckListing(listing.id, {
                      title: editForm.title,
                      description: editForm.description || null,
                      askingPrice: parseFloat(editForm.askingPrice),
                      location: editForm.location || null,
                    });
                    setListing({ ...listing, ...updated });
                    setShowEdit(false);
                    toast('success', 'Listing updated');
                  } catch (err) {
                    toast('error', err instanceof Error ? err.message : 'Failed to update');
                  } finally {
                    setSavingEdit(false);
                  }
                }}
                disabled={savingEdit}
                className="px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 disabled:opacity-50 transition-colors"
              >
                {savingEdit ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => setShowEdit(false)}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Project creation form */}
      {showProjectForm && (
        <div ref={projectFormRef} className="bg-white rounded-lg shadow-sm border-2 border-green-200 p-5 mb-4">
          <CardHeader>Create Project</CardHeader>
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Project name"
              value={projectForm.name}
              onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="number"
              step="0.01"
              placeholder="Purchase price"
              value={projectForm.purchasePrice}
              onChange={(e) => setProjectForm({ ...projectForm, purchasePrice: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <button
                onClick={handleCreateProject}
                className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
              >
                Create & Go to Project
              </button>
              <button
                onClick={() => setShowProjectForm(false)}
                className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const SOURCE_TYPE_LABELS: Record<string, string> = {
  project: 'Past Flip',
  product: 'Product Spec',
  guide: 'Guide',
};
const SOURCE_TYPE_COLORS: Record<string, string> = {
  project: 'bg-blue-50 text-blue-700',
  product: 'bg-amber-50 text-amber-700',
  guide: 'bg-green-50 text-green-700',
};

function AnalysisRagSources({ sources }: { sources: RagSource[] }) {
  if (!Array.isArray(sources) || sources.length === 0) return null;

  return (
    <div className="mt-3 pt-3 border-t border-purple-100">
      <h4 className="text-xs font-medium text-purple-600 uppercase mb-2">Knowledge base sources</h4>
      <div className="space-y-1">
        {sources.map((s, i) => {
          const isLink = s.source?.startsWith('http');
          return (
            <div key={i} className="flex items-center gap-2 text-xs text-gray-600">
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${SOURCE_TYPE_COLORS[s.type] || 'bg-gray-100 text-gray-600'}`}>
                {SOURCE_TYPE_LABELS[s.type] || s.type}
              </span>
              {isLink ? (
                <a href={s.source} target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline truncate">
                  {s.title}
                </a>
              ) : (
                <span className="truncate">{s.title}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
