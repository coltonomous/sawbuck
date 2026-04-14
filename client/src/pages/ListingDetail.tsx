import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, type ListingDetail as ListingDetailType, type ListingImage, type RagSource } from '../api';
import { FLIP_REC_COLORS, type FlipRecommendation } from '@shared/constants';
import { useSession } from '../lib/auth';
import { useToast } from '../components/Toast';
import { SkeletonDetail } from '../components/Skeleton';
import ComparablesList from '../components/ComparablesList';
import RefinishingPlan from '../components/RefinishingPlan';
import type { RefinishingPlan as RefinishingPlanType } from '../api';
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
  const [previewPlan, setPreviewPlan] = useState<RefinishingPlanType | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [selectedConcept, setSelectedConcept] = useState<string | null>(null);
  const [generatingConcepts, setGeneratingConcepts] = useState(false);
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

  // Auto-select concept based on user's experience level and load plan
  useEffect(() => {
    if (!listing?.conceptImages?.length || selectedConcept || previewPlan) return;
    const expMap: Record<string, string> = { beginner: 'simple', intermediate: 'moderate', advanced: 'full' };
    const preferredDifficulty = expMap[session?.user?.experienceLevel ?? ''] ?? 'moderate';
    const moderate = listing.conceptImages.find((c) => c.difficulty === preferredDifficulty) ?? listing.conceptImages.find((c) => c.difficulty === 'moderate') ?? listing.conceptImages[0];
    setSelectedConcept(moderate.difficulty);
    setLoadingPlan(true);
    api.previewPlan(listing.id, {
      difficulty: moderate.difficulty,
      label: moderate.label,
      summary: moderate.summary,
      estimatedHours: moderate.estimatedHours ?? undefined,
      estimatedMaterialCost: moderate.estimatedMaterialCost ?? undefined,
      estimatedResalePrice: moderate.estimatedResalePrice ?? undefined,
    }).then(({ plan }) => setPreviewPlan(plan))
      .catch(() => {})
      .finally(() => setLoadingPlan(false));
  }, [listing?.conceptImages?.length]);

  const handleAnalyze = async () => {
    if (!listing || analyzing) return;
    setAnalyzing(true);
    try {
      await api.analyzeListing(listing.id);
      // Poll until analysis completes or fails
      let settled = false;
      const poll = setInterval(async () => {
        if (settled) return;
        try {
          const updated = await api.getListing(listing.id);
          if (updated.furnitureType) {
            settled = true;
            clearInterval(poll);
            setListing(updated);
            setAnalyzing(false);
            toast('success', 'Analysis complete');
          } else if (updated.analysisError) {
            settled = true;
            clearInterval(poll);
            setListing(updated);
            setAnalyzing(false);
            toast('error', updated.analysisError);
          }
        } catch {}
      }, 3000);
      // Stop polling after 5 minutes
      setTimeout(() => {
        if (settled) return;
        settled = true;
        clearInterval(poll);
        setAnalyzing(false);
        toast('error', 'Analysis timed out — check server logs');
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
      navigate(`/projects/${project.id}?tab=plan`);
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
          {analyzing ? 'Analyzing...' : 'Analyze'}
        </button>
      ) : null}

      {/* eBay Comparables */}
      {listing.furnitureType && (
        <div className="mb-4">
          <ComparablesList listingId={listing.id} />
        </div>
      )}

      {/* Refinishing Options (from agent pipeline) */}
      {listing.conceptImages && listing.conceptImages.length > 0 && (
        <Card className="mb-4">
          <CardHeader>Refinishing Options</CardHeader>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {listing.conceptImages.map((opt) => (
              <div
                key={opt.difficulty}
                onClick={async () => {
                  setSelectedConcept(opt.difficulty);
                  setPreviewPlan(null); // clear stale plan immediately
                  setLoadingPlan(true);
                  try {
                    const { plan } = await api.previewPlan(listing.id, {
                      difficulty: opt.difficulty,
                      label: opt.label,
                      summary: opt.summary,
                      estimatedHours: opt.estimatedHours ?? undefined,
                      estimatedMaterialCost: opt.estimatedMaterialCost ?? undefined,
                      estimatedResalePrice: opt.estimatedResalePrice ?? undefined,
                    });
                    setPreviewPlan(plan);
                  } catch (err) {
                    toast('error', err instanceof Error ? err.message : 'Failed to generate plan');
                  }
                  setLoadingPlan(false);
                }}
                className={`border rounded-lg overflow-hidden cursor-pointer transition-all ${
                  selectedConcept === opt.difficulty
                    ? 'border-blue-500 ring-2 ring-blue-200'
                    : 'border-gray-200 hover:border-gray-300'
                }`}>
                {opt.localPath ? (
                  <div className="relative">
                    <img
                      src={resolveImageUrl(opt.localPath)}
                      alt={opt.label}
                      className="w-full h-40 object-cover bg-gray-100"
                    />
                    <span className="absolute top-1.5 left-1.5 text-[9px] font-medium bg-black/50 text-white px-1.5 py-0.5 rounded">AI Concept</span>
                  </div>
                ) : (
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (loadingPlan || generatingConcepts) return;
                      try {
                        const { render } = await api.generateConceptRender(listing.id, opt.difficulty as 'simple' | 'moderate' | 'full');
                        if (render?.localPath) {
                          setListing((prev) => prev ? {
                            ...prev,
                            conceptImages: prev.conceptImages?.map((c) =>
                              c.difficulty === opt.difficulty ? { ...c, localPath: render.localPath } : c
                            ) ?? null,
                          } : prev);
                        }
                      } catch {}
                    }}
                    className="w-full h-40 bg-gray-50 flex flex-col items-center justify-center gap-1.5 hover:bg-gray-100 transition-colors"
                  >
                    <svg className="w-6 h-6 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a2.25 2.25 0 002.25-2.25V5.25a2.25 2.25 0 00-2.25-2.25H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" /></svg>
                    <span className="text-[10px] text-gray-400 font-medium">Generate concept</span>
                  </button>
                )}
                <div className="p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-semibold text-gray-900">{opt.label}</span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                      opt.difficulty === 'simple' ? 'bg-green-100 text-green-700'
                        : opt.difficulty === 'moderate' ? 'bg-amber-100 text-amber-700'
                        : 'bg-red-100 text-red-700'
                    }`}>{opt.difficulty}</span>
                  </div>
                  <p className="text-xs text-gray-500 mb-2 line-clamp-2">{opt.summary}</p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    {opt.estimatedHours != null && (
                      <>
                        <span className="text-gray-400">Time</span>
                        <span className="text-right font-medium text-gray-700">{opt.estimatedHours}h</span>
                      </>
                    )}
                    {opt.estimatedMaterialCost != null && (
                      <>
                        <span className="text-gray-400">Materials</span>
                        <span className="text-right font-medium text-gray-700">${opt.estimatedMaterialCost}</span>
                      </>
                    )}
                    {opt.estimatedResalePrice != null && (
                      <>
                        <span className="text-gray-400">Resale est.</span>
                        <span className="text-right font-medium text-green-700">${opt.estimatedResalePrice}</span>
                      </>
                    )}
                    {opt.estimatedResalePrice != null && listing.askingPrice != null && opt.estimatedMaterialCost != null && (
                      <>
                        <span className="text-gray-400">Profit est.</span>
                        <span className="text-right font-medium text-green-700">
                          ${Math.round(opt.estimatedResalePrice - listing.askingPrice - opt.estimatedMaterialCost)}
                        </span>
                      </>
                    )}
                  </div>
                  <button
                    onClick={async () => {
                      try {
                        const { project } = await api.createProjectFromConcept({
                          listingId: listing.id,
                          difficulty: opt.difficulty,
                          label: opt.label,
                          summary: opt.summary,
                          estimatedHours: opt.estimatedHours ?? undefined,
                          estimatedMaterialCost: opt.estimatedMaterialCost ?? undefined,
                          estimatedResalePrice: opt.estimatedResalePrice ?? undefined,
                        });
                        navigate(`/projects/${project.id}?tab=plan`);
                      } catch (err) {
                        toast('error', err instanceof Error ? err.message : 'Failed to create project');
                      }
                    }}
                    className="mt-2 w-full py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded hover:bg-blue-100 transition-colors"
                  >
                    Use this plan
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Plan Preview */}
      {listing.furnitureType && (
        <div className="mb-4">
          {(loadingPlan || generatingConcepts) && (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
              <Spinner /> {generatingConcepts ? 'Generating refinishing options...' : 'Generating refinishing plan...'}
            </div>
          )}
          {previewPlan && !loadingPlan && (
            <RefinishingPlan plan={previewPlan} />
          )}
          {!previewPlan && !loadingPlan && !generatingConcepts && (!listing.conceptImages || listing.conceptImages.length === 0) && (
            <button
              onClick={async () => {
                if (generatingConcepts || loadingPlan) return;
                setGeneratingConcepts(true);
                try {
                  // Generate concepts first, then auto-select moderate and generate plan
                  const { concepts } = await api.generateConcepts(listing.id);
                  if (concepts.length > 0) {
                    setListing((prev) => prev ? { ...prev, conceptImages: concepts } : prev);
                    const moderate = concepts.find((c) => c.difficulty === 'moderate') ?? concepts[0];
                    setSelectedConcept(moderate.difficulty);
                    setGeneratingConcepts(false);
                    setLoadingPlan(true);
                    const { plan } = await api.previewPlan(listing.id, {
                      difficulty: moderate.difficulty,
                      label: moderate.label,
                      summary: moderate.summary,
                      estimatedHours: moderate.estimatedHours ?? undefined,
                      estimatedMaterialCost: moderate.estimatedMaterialCost ?? undefined,
                      estimatedResalePrice: moderate.estimatedResalePrice ?? undefined,
                    });
                    setPreviewPlan(plan);
                  }
                } catch (err) {
                  toast('error', err instanceof Error ? err.message : 'Failed to generate refinishing plan');
                }
                setGeneratingConcepts(false);
                setLoadingPlan(false);
              }}
              disabled={generatingConcepts || loadingPlan}
              className="px-4 py-2 bg-white border border-blue-300 text-blue-700 text-sm font-medium rounded-lg hover:bg-blue-50 disabled:opacity-50 transition-colors inline-flex items-center gap-2"
            >
              Generate Refinishing Plan
            </button>
          )}
          {!previewPlan && !loadingPlan && !generatingConcepts && listing.conceptImages && listing.conceptImages.length > 0 && (
            <p className="text-xs text-gray-400">Select a refinishing option above to see the detailed plan.</p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2.5 mb-6">
        {listing.platform !== 'sawbuck' && listing.url && (
          <a
            href={listing.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => api.trackListingClick(listing.id).catch(() => {})}
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
            onClick={() => api.dismissListing(listing.id).then(() => navigate(-1)).catch((err) => toast('error', `Failed to dismiss: ${err instanceof Error ? err.message : 'Unknown error'}`))}
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

      {/* Admin actions (separated from user actions) */}
      {listing.userId === null && session?.user?.role === 'admin' && (
        <div className="flex items-center gap-2 mb-4 pt-2 border-t border-dashed border-gray-200">
          <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Admin</span>
          <button
            onClick={async () => {
              if (!confirm('Delete this agent-discovered listing?')) return;
              try {
                await api.deleteAgentListings([listing.id]);
                toast('success', 'Listing deleted');
                navigate(-1);
              } catch (err) {
                toast('error', err instanceof Error ? err.message : 'Failed to delete');
              }
            }}
            className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded hover:bg-red-100 transition-colors"
          >
            Delete Listing
          </button>
        </div>
      )}

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
