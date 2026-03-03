import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useToast } from '../components/Toast';
import { SkeletonDetail } from '../components/Skeleton';
import RefinishingPlan from '../components/RefinishingPlan';
import MaterialsList from '../components/MaterialsList';
import ROICalculator from '../components/ROICalculator';
import PhotoGallery from '../components/PhotoGallery';
import ExportListingText from '../components/ExportListingText';

type Tab = 'overview' | 'plan' | 'materials' | 'photos' | 'financials';

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');
  const [showExport, setShowExport] = useState(false);
  const { toast } = useToast();

  const load = () => {
    if (!id) return;
    api.getProject(parseInt(id))
      .then(setProject)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(load, [id]);

  const handleGeneratePlan = async () => {
    if (!project) return;
    setGeneratingPlan(true);
    try {
      await api.generateRefinishingPlan(project.id);
      load();
      setTab('plan');
      toast('success', 'Refinishing plan generated');
    } catch (err: any) {
      toast('error', `Failed to generate plan: ${err.message}`);
    }
    setGeneratingPlan(false);
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!project) return;
    await api.updateProject(project.id, { status: newStatus });
    load();
  };

  const handleDelete = async () => {
    if (!project) return;
    if (!confirm('Delete this project? This will remove all plans, materials, and photos.')) return;
    try {
      await api.deleteProject(project.id);
      toast('success', 'Project deleted');
      navigate('/projects');
    } catch (err: any) {
      toast('error', `Failed to delete: ${err.message}`);
    }
  };

  const handleCostUpdate = async (field: string, value: string) => {
    if (!project) return;
    const numVal = parseFloat(value);
    if (isNaN(numVal)) return;
    await api.updateProjectCosts(project.id, { [field]: numVal });
    load();
  };

  if (loading) return <SkeletonDetail />;
  if (!project) return (
    <div className="text-center py-24">
      <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
        <svg className="w-7 h-7 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
        </svg>
      </div>
      <p className="text-gray-900 font-medium text-lg">Project not found</p>
      <p className="text-sm text-gray-500 mt-1">It may have been removed or the link is incorrect.</p>
      <button onClick={() => navigate('/projects')} className="mt-4 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors">
        Back to Projects
      </button>
    </div>
  );

  const purchasedMats = (project.materials ?? []).filter((m: any) => m.purchased);
  const materialsCostIsEstimate = purchasedMats.length === 0;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'plan', label: 'Refinishing Plan' },
    { key: 'materials', label: `Materials (${project.materials?.length || 0})` },
    { key: 'photos', label: `Photos (${project.photos?.length || 0})` },
    { key: 'financials', label: 'Financials' },
  ];

  return (
    <div className="max-w-4xl">
      <button onClick={() => navigate(-1)} className="text-sm text-gray-400 hover:text-gray-600 mb-4 inline-flex items-center gap-1 transition-colors">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{project.name}</h2>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[11px] font-semibold uppercase">
              {project.status}
            </span>
            {project.listing && (
              <a href={`/listings/${project.listing.id}`} className="text-sm text-blue-600 hover:underline">
                View listing
              </a>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {['refinishing', 'listed', 'sold'].includes(project.status) && (
            <button
              onClick={() => setShowExport(true)}
              className="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors inline-flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              Export Listing
            </button>
          )}
          {project.status === 'acquired' && (
            <button onClick={() => handleStatusChange('refinishing')} className="px-3 py-1.5 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600 transition-colors">
              Start Refinishing
            </button>
          )}
          {project.status === 'refinishing' && (
            <button onClick={() => handleStatusChange('listed')} className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
              Mark Listed
            </button>
          )}
          {project.status === 'listed' && (
            <button onClick={() => handleStatusChange('sold')} className="px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors">
              Mark Sold
            </button>
          )}
          <button
            onClick={handleDelete}
            className="px-3 py-1.5 bg-white border border-red-300 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-6">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-400 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview' && (
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3">Details</h3>
            <dl className="space-y-2 text-sm">
              {project.listing?.furnitureType && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Type</dt>
                  <dd>{project.listing.furnitureType}</dd>
                </div>
              )}
              {project.listing?.furnitureStyle && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Style</dt>
                  <dd>{project.listing.furnitureStyle}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-gray-500">Purchase price</dt>
                <dd className="font-medium">${project.purchasePrice}</dd>
              </div>
              {project.purchaseDate && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Purchase date</dt>
                  <dd>{project.purchaseDate}</dd>
                </div>
              )}
            </dl>
          </div>

          <ROICalculator
            purchasePrice={project.purchasePrice}
            materialCost={project.totalMaterialCost || 0}
            materialsCostIsEstimate={materialsCostIsEstimate}
            hoursInvested={project.hoursInvested || 0}
            hourlyRate={project.hourlyRate || 25}
            estimatedResalePrice={project.plan?.estimatedResalePrice || project.listing?.estimatedRefinishedValue || 0}
            sellingFees={project.sellingFees || 0}
            shippingCost={project.shippingCost || 0}
            soldPrice={project.soldPrice}
          />

          {/* Timeline */}
          <div className="col-span-2 bg-white rounded-lg shadow-sm border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4">Timeline</h3>
            <ProjectTimeline project={project} />
          </div>

          {!project.plan && (
            <div className="col-span-2 text-center py-10 bg-white rounded-lg shadow-sm border border-gray-200">
              <p className="text-gray-500 mb-3 text-sm">No refinishing plan yet</p>
              <button
                onClick={handleGeneratePlan}
                disabled={generatingPlan}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors inline-flex items-center gap-2"
              >
                {generatingPlan && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                {generatingPlan ? 'Generating plan...' : 'Generate Refinishing Plan'}
              </button>
            </div>
          )}
        </div>
      )}

      {tab === 'plan' && (
        project.plan ? (
          <RefinishingPlan plan={project.plan} />
        ) : (
          <div className="text-center py-16">
            <p className="text-gray-500 mb-3 text-sm">No refinishing plan yet</p>
            <button
              onClick={handleGeneratePlan}
              disabled={generatingPlan}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors inline-flex items-center gap-2"
            >
              {generatingPlan && <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              {generatingPlan ? 'Generating plan with Claude...' : 'Generate Refinishing Plan'}
            </button>
          </div>
        )
      )}

      {tab === 'materials' && (
        project.materials?.length > 0 ? (
          <MaterialsList
            materials={project.materials}
            projectId={project.id}
            onUpdate={load}
          />
        ) : (
          <div className="text-center py-12">
            <p className="text-gray-500">
              {project.plan
                ? 'No materials generated yet. This should happen automatically with the plan.'
                : 'Generate a refinishing plan first to see materials.'}
            </p>
          </div>
        )
      )}

      {tab === 'photos' && (
        <PhotoGallery
          projectId={project.id}
          photos={project.photos || []}
          onUpdate={load}
        />
      )}

      {tab === 'financials' && (
        <div className="space-y-4">
          <ROICalculator
            purchasePrice={project.purchasePrice}
            materialCost={project.totalMaterialCost || 0}
            materialsCostIsEstimate={materialsCostIsEstimate}
            hoursInvested={project.hoursInvested || 0}
            hourlyRate={project.hourlyRate || 25}
            estimatedResalePrice={project.plan?.estimatedResalePrice || 0}
            sellingFees={project.sellingFees || 0}
            shippingCost={project.shippingCost || 0}
            soldPrice={project.soldPrice}
          />

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
            <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4">Update Costs</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-gray-500 uppercase mb-1">Hours invested</label>
                <input
                  type="number"
                  step="0.5"
                  defaultValue={project.hoursInvested || ''}
                  onBlur={(e) => handleCostUpdate('hoursInvested', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-500 uppercase mb-1">Hourly rate ($)</label>
                <input
                  type="number"
                  step="1"
                  defaultValue={project.hourlyRate || 25}
                  onBlur={(e) => handleCostUpdate('hourlyRate', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-500 uppercase mb-1">Listed price ($)</label>
                <input
                  type="number"
                  step="0.01"
                  defaultValue={project.listedPrice || ''}
                  onBlur={(e) => handleCostUpdate('listedPrice', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-500 uppercase mb-1">Sold price ($)</label>
                <input
                  type="number"
                  step="0.01"
                  defaultValue={project.soldPrice || ''}
                  onBlur={(e) => handleCostUpdate('soldPrice', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-500 uppercase mb-1">Selling fees ($)</label>
                <input
                  type="number"
                  step="0.01"
                  defaultValue={project.sellingFees || ''}
                  onBlur={(e) => handleCostUpdate('sellingFees', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-gray-500 uppercase mb-1">Shipping ($)</label>
                <input
                  type="number"
                  step="0.01"
                  defaultValue={project.shippingCost || ''}
                  onBlur={(e) => handleCostUpdate('shippingCost', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {showExport && <ExportListingText project={project} onClose={() => setShowExport(false)} />}
    </div>
  );
}

const PIPELINE = ['acquired', 'refinishing', 'listed', 'sold'] as const;

function ProjectTimeline({ project }: { project: any }) {
  const events: { label: string; date: string | null; done: boolean }[] = [
    { label: 'Acquired', date: project.purchaseDate || project.createdAt, done: true },
    { label: 'Refinishing', date: PIPELINE.indexOf(project.status) >= 1 ? project.updatedAt : null, done: PIPELINE.indexOf(project.status) >= 1 },
    { label: 'Listed', date: project.listedDate, done: PIPELINE.indexOf(project.status) >= 2 },
    { label: 'Sold', date: project.soldDate, done: project.status === 'sold' },
  ];

  const currentIdx = PIPELINE.indexOf(project.status);

  return (
    <div className="flex items-center justify-between">
      {events.map((event, i) => (
        <div key={event.label} className="flex items-center flex-1 last:flex-none">
          <div className="flex flex-col items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium ${
                i === currentIdx
                  ? 'bg-blue-600 text-white ring-2 ring-blue-200'
                  : event.done
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-200 text-gray-400'
              }`}
            >
              {event.done && i !== currentIdx ? '\u2713' : i + 1}
            </div>
            <span className={`text-xs mt-1 ${i === currentIdx ? 'font-medium text-blue-600' : 'text-gray-500'}`}>
              {event.label}
            </span>
            {event.date && (
              <span className="text-[10px] text-gray-400">
                {new Date(event.date).toLocaleDateString()}
              </span>
            )}
          </div>
          {i < events.length - 1 && (
            <div className={`flex-1 h-0.5 mx-2 ${event.done ? 'bg-green-400' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  );
}
