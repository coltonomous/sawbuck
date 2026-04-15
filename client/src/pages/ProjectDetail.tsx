import { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { api, type Project, type ProjectDetail as ProjectDetailType, type Material } from '../api';
import { PROJECT_PIPELINE_STATUSES } from '@shared/constants';
import { useToast } from '../components/Toast';
import { SkeletonDetail } from '../components/Skeleton';
import RefinishingPlan from '../components/RefinishingPlan';
import MaterialsList from '../components/MaterialsList';
import ROICalculator from '../components/ROICalculator';
import PhotoGallery from '../components/PhotoGallery';
import ExportListingText from '../components/ExportListingText';
import { Spinner, EmptyState, BackButton, NotFoundIcon, Card, CardHeader } from '../components/ui';
import { resolveImageUrl, formatDate } from '../utils';

type Tab = 'overview' | 'plan' | 'materials' | 'photos' | 'financials';

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [project, setProject] = useState<ProjectDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const initialTab = (searchParams.get('tab') as Tab) || 'overview';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [showExport, setShowExport] = useState(false);
  const [selectedPlanIdx, setSelectedPlanIdx] = useState(0);
  const [selectedConceptDifficulty, setSelectedConceptDifficulty] = useState<string | null>(null);
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
    if (!project || generatingPlan) return;
    setGeneratingPlan(true);
    try {
      // Generate concepts first if they don't exist
      if (!project.concepts || project.concepts.length === 0) {
        try {
          await api.generateConcepts(project.listingId);
        } catch {
          // Non-fatal — continue with plan generation
        }
      }
      await api.generateRefinishingPlan(project.id);
      load();
      setTab('plan');
      toast('success', 'Refinishing plan generated');
    } catch (err) {
      toast('error', `Failed to generate plan: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
    setGeneratingPlan(false);
  };

  const handleStatusChange = async (newStatus: Project['status']) => {
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
    } catch (err) {
      toast('error', `Failed to delete: ${err instanceof Error ? err.message : 'Unknown error'}`);
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
    <EmptyState
      icon={<NotFoundIcon />}
      title="Project not found"
      subtitle="It may have been removed or the link is incorrect."
      action={
        <button onClick={() => navigate('/projects')} className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors">
          Back to Projects
        </button>
      }
    />
  );

  const purchasedMats = (project.materials ?? []).filter((m: Material) => m.purchased);
  const materialsCostIsEstimate = purchasedMats.length === 0;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'plan', label: 'Refinishing Plan' },
    { key: 'materials', label: `Materials (${project.materials?.length || 0})` },
    { key: 'photos', label: `Photos (${project.photos?.length || 0})` },
    { key: 'financials', label: 'Financials' },
  ];

  const GeneratePlanButton = () => (
    <button
      onClick={handleGeneratePlan}
      disabled={generatingPlan}
      className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors inline-flex items-center gap-2"
    >
      {generatingPlan && <Spinner />}
      {generatingPlan ? 'Generating plan...' : 'Generate Refinishing Plan'}
    </button>
  );

  return (
    <div className="max-w-4xl">
      <BackButton onClick={() => navigate(-1)} />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
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
        <div className="flex flex-wrap gap-2">
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
      <div className="flex overflow-x-auto md:overflow-x-visible border-b border-gray-200 mb-6 -mx-4 px-4 md:mx-0 md:px-0">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader>Details</CardHeader>
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
                  <dd>{formatDate(project.purchaseDate)}</dd>
                </div>
              )}
            </dl>
          </Card>

          <ROICalculator
            purchasePrice={project.purchasePrice}
            materialCost={project.totalMaterialCost || 0}
            materialsCostIsEstimate={materialsCostIsEstimate}
            totalMaterials={(project.materials ?? []).length}
            purchasedMaterials={purchasedMats.length}
            hoursInvested={project.hoursInvested || 0}
            hourlyRate={project.hourlyRate || 25}
            estimatedResalePrice={project.plan?.estimatedResalePrice || project.listing?.estimatedRefinishedValue || 0}
            sellingFees={project.sellingFees || 0}
            shippingCost={project.shippingCost || 0}
            soldPrice={project.soldPrice}
          />

          {/* Timeline */}
          <Card className="md:col-span-2">
            <CardHeader>Timeline</CardHeader>
            <ProjectTimeline project={project} />
          </Card>

          {(!project.plans || project.plans.length === 0) && (
            <div className="md:col-span-2 text-center py-10 bg-white rounded-lg shadow-sm border border-gray-200">
              <p className="text-gray-500 mb-3 text-sm">No refinishing plan yet</p>
              <GeneratePlanButton />
            </div>
          )}
        </div>
      )}

      {tab === 'plan' && (
        <div className="space-y-4">
          {/* Concept options from the agent pipeline */}
          {project.concepts && project.concepts.length > 0 && (
            <Card>
              <CardHeader>Refinishing Concepts</CardHeader>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[...project.concepts].sort((a, b) => {
                  const order = { simple: 0, moderate: 1, full: 2 };
                  return (order[a.difficulty as keyof typeof order] ?? 1) - (order[b.difficulty as keyof typeof order] ?? 1);
                }).map((opt) => {
                // Map concept difficulty to plan difficulty for matching
                const planDiffMap: Record<string, string> = { simple: 'beginner', moderate: 'intermediate', full: 'advanced' };
                const matchingPlanIdx = project.plans?.findIndex((p) => p.difficultyLevel === planDiffMap[opt.difficulty]);
                const isSelected = selectedConceptDifficulty === opt.difficulty;

                return (
                  <div
                    key={opt.difficulty}
                    onClick={() => {
                      if (generatingPlan) return;
                      setSelectedConceptDifficulty(opt.difficulty);
                      const matchingPlan = matchingPlanIdx != null && matchingPlanIdx >= 0
                        ? project.plans?.[matchingPlanIdx]
                        : null;
                      if (matchingPlan && matchingPlan.projectId === project.id) {
                        // Plan already claimed by this project — just switch display
                        setSelectedPlanIdx(matchingPlanIdx!);
                      } else {
                        // Claim existing listing-level plan or generate a new one
                        setGeneratingPlan(true);
                        api.generateRefinishingPlan(project.id, {
                          difficulty: opt.difficulty,
                          label: opt.label,
                          summary: opt.summary,
                          estimatedHours: opt.estimatedHours,
                          estimatedMaterialCost: opt.estimatedMaterialCost,
                          estimatedResalePrice: opt.estimatedResalePrice,
                        }).then(() => {
                          load();
                          toast('success', matchingPlan ? 'Plan selected' : 'Plan generated');
                        }).catch((err: Error) => {
                          toast('error', err.message || 'Failed');
                        }).finally(() => setGeneratingPlan(false));
                      }
                    }}
                    className={`rounded-lg overflow-hidden cursor-pointer transition-all ${
                      isSelected ? 'border-2 border-blue-500 ring-2 ring-blue-200' : 'border border-gray-200 hover:border-gray-300'
                    }`}>
                    {opt.localPath ? (
                      <div className="relative">
                        <img src={resolveImageUrl(opt.localPath)} alt={opt.label} className="w-full h-32 object-cover bg-gray-100" />
                        <span className="absolute top-1.5 left-1.5 text-[9px] font-medium bg-black/50 text-white px-1.5 py-0.5 rounded">AI Concept</span>
                      </div>
                    ) : (
                      <div className="w-full h-32 bg-gray-50 flex items-center justify-center">
                        <span className="text-[10px] text-gray-300">No render</span>
                      </div>
                    )}
                    <div className="p-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-semibold text-gray-900">{opt.label}</span>
                        <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${
                          opt.difficulty === 'simple' ? 'bg-green-100 text-green-700'
                            : opt.difficulty === 'moderate' ? 'bg-amber-100 text-amber-700'
                            : 'bg-red-100 text-red-700'
                        }`}>{opt.difficulty}</span>
                      </div>
                      <p className="text-[10px] text-gray-500 line-clamp-2 mb-1">{opt.summary}</p>
                      <div className="flex gap-3 text-[10px] text-gray-400">
                        {opt.estimatedHours != null && <span>{opt.estimatedHours}h</span>}
                        {opt.estimatedMaterialCost != null && <span>${opt.estimatedMaterialCost}</span>}
                        {opt.estimatedResalePrice != null && <span className="text-green-600">${opt.estimatedResalePrice}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
              </div>
            </Card>
          )}

          {/* Plan picker and display */}
          {generatingPlan && (
            <div className="flex items-center gap-2 text-sm text-gray-500 py-6">
              <Spinner /> Generating refinishing plan...
            </div>
          )}
          {!generatingPlan && project.plans && project.plans.length > 0 ? (
            <div>
              {project.plans.length > 1 && (
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs text-gray-500">Plan:</span>
                  <select
                    value={selectedPlanIdx}
                    onChange={(e) => setSelectedPlanIdx(parseInt(e.target.value))}
                    className="text-xs border border-gray-300 rounded px-2 py-1"
                  >
                    {project.plans.map((p, i) => (
                      <option key={p.id} value={i}>
                        {p.difficultyLevel ? `${p.difficultyLevel} - ` : ''}{p.styleRecommendation || `Plan ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <RefinishingPlan plan={project.plans[selectedPlanIdx]} />
            </div>
          ) : (
            <div className="text-center py-16">
              <p className="text-gray-500 mb-3 text-sm">No refinishing plan yet</p>
              <GeneratePlanButton />
            </div>
          )}
        </div>
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

          <Card>
            <CardHeader>Update Costs</CardHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: 'Hours invested', field: 'hoursInvested', step: '0.5', value: project.hoursInvested },
                { label: 'Hourly rate ($)', field: 'hourlyRate', step: '1', value: project.hourlyRate || 25 },
                { label: 'Listed price ($)', field: 'listedPrice', step: '0.01', value: project.listedPrice },
                { label: 'Sold price ($)', field: 'soldPrice', step: '0.01', value: project.soldPrice },
                { label: 'Selling fees ($)', field: 'sellingFees', step: '0.01', value: project.sellingFees },
                { label: 'Shipping ($)', field: 'shippingCost', step: '0.01', value: project.shippingCost },
              ].map(({ label, field, step, value }) => (
                <div key={field}>
                  <label className="block text-[11px] font-medium text-gray-500 uppercase mb-1">{label}</label>
                  <input
                    type="number"
                    step={step}
                    defaultValue={value || ''}
                    onBlur={(e) => handleCostUpdate(field, e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {showExport && <ExportListingText project={project} onClose={() => setShowExport(false)} />}
    </div>
  );
}

function ProjectTimeline({ project }: { project: ProjectDetailType }) {
  const pipelineStatuses = PROJECT_PIPELINE_STATUSES;
  const statusIdx = pipelineStatuses.indexOf(project.status as typeof pipelineStatuses[number]);
  const events: { label: string; date: string | null; done: boolean }[] = [
    { label: 'Acquired', date: project.purchaseDate || project.createdAt, done: true },
    { label: 'Refinishing', date: statusIdx >= 1 ? project.updatedAt : null, done: statusIdx >= 1 },
    { label: 'Listed', date: project.listedDate, done: statusIdx >= 2 },
    { label: 'Sold', date: project.soldDate, done: project.status === 'sold' },
  ];

  const currentIdx = statusIdx;

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
                {formatDate(event.date)}
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
