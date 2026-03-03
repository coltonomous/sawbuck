import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useToast } from '../components/Toast';
import { SkeletonDetail } from '../components/Skeleton';
import ComparablesList from '../components/ComparablesList';
import { PlatformBadge, DealScoreBadge, Spinner, EmptyState, BackButton, ExternalLinkIcon, NotFoundIcon, Card, CardHeader } from '../components/ui';

export default function ListingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [listing, setListing] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [projectForm, setProjectForm] = useState({ name: '', purchasePrice: '' });
  const { toast } = useToast();

  useEffect(() => {
    if (!id) return;
    api.getListing(parseInt(id))
      .then(setListing)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const handleAnalyze = async () => {
    if (!listing) return;
    setAnalyzing(true);
    try {
      const result = await api.analyzeListing(listing.id);
      setListing({ ...listing, ...result });
      toast('success', 'Analysis complete');
    } catch (err: any) {
      toast('error', `Analysis failed: ${err.message}`);
    }
    setAnalyzing(false);
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
    } catch (err: any) {
      alert(`Failed to create project: ${err.message}`);
    }
  };

  // Parse analysis verdict from raw JSON
  let analysisData: any = null;
  try { analysisData = listing?.analysisRaw ? JSON.parse(listing.analysisRaw) : null; } catch {}
  const rec = analysisData?.flip_recommendation;
  const recStyle = rec === 'strong_buy' ? 'bg-green-100 text-green-700' :
    rec === 'buy' ? 'bg-blue-100 text-blue-700' :
    rec === 'maybe' ? 'bg-yellow-100 text-yellow-700' :
    rec === 'pass' ? 'bg-red-100 text-red-700' : '';
  const recLabel = rec === 'strong_buy' ? 'Strong Buy' :
    rec === 'buy' ? 'Buy' :
    rec === 'maybe' ? 'Maybe' :
    rec === 'pass' ? 'Pass' : null;

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

      <div className="flex items-start justify-between mb-6">
        <div className="flex-1 min-w-0 mr-6">
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
          {listing.images.map((img: any) => (
            <img
              key={img.id}
              src={img.localPathResized ? `/images/resized/${img.localPathResized.replace('resized/', '')}` : img.sourceUrl}
              alt=""
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
            {recLabel && (
              <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${recStyle}`}>{recLabel}</span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
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
          {listing.conditionNotes && (
            <p className="mt-4 pt-3 border-t text-sm text-gray-600 leading-relaxed">{listing.conditionNotes}</p>
          )}
          {analysisData?.refinishing_profit_verdict && (
            <p className="mt-3 pt-3 border-t text-sm text-gray-700 leading-relaxed font-medium">{analysisData.refinishing_profit_verdict}</p>
          )}
        </Card>
      ) : (
        <button
          onClick={handleAnalyze}
          disabled={analyzing}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors mb-4 flex items-center gap-2"
        >
          {analyzing && <Spinner />}
          {analyzing ? 'Analyzing...' : 'Analyze with Claude'}
        </button>
      )}

      {/* Comparables */}
      {listing.furnitureType && <ComparablesList listingId={listing.id} />}

      {/* Actions */}
      <div className="flex gap-2.5 mb-6">
        <a
          href={listing.url}
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors inline-flex items-center gap-2"
        >
          View Original
          <ExternalLinkIcon />
        </a>
        {listing.status !== 'acquired' && (
          <button
            onClick={() => {
              setProjectForm({ name: listing.title, purchasePrice: listing.askingPrice?.toString() || '' });
              setShowProjectForm(true);
            }}
            className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
          >
            Start Project
          </button>
        )}
        {listing.status !== 'dismissed' && (
          <button
            onClick={() => api.updateListing(listing.id, { status: 'dismissed' }).then(() => setListing({ ...listing, status: 'dismissed' }))}
            className="px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            Dismiss
          </button>
        )}
      </div>

      {/* Project creation form */}
      {showProjectForm && (
        <div className="bg-white rounded-lg shadow-sm border-2 border-green-200 p-5 mb-4">
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
