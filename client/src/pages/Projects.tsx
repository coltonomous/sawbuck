import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type PipelineProject } from '../api';
import { SkeletonKanban } from '../components/Skeleton';
import { PROJECT_PIPELINE_STATUSES, PROJECT_STATUS_META } from '@shared/constants';

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export default function Projects() {
  const [projects, setProjects] = useState<PipelineProject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getProjectsPipeline()
      .then(setProjects)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Projects</h2>
          <p className="text-sm text-gray-500 mt-0.5">Track your furniture flips from purchase to sale.</p>
        </div>
      </div>
      <SkeletonKanban />
    </div>
  );

  const grouped = PROJECT_PIPELINE_STATUSES.reduce((acc, status) => {
    acc[status] = projects.filter((p) => p.status === status);
    return acc;
  }, {} as Record<string, PipelineProject[]>);

  const totalProfit = projects
    .filter((p) => p.profit != null)
    .reduce((sum, p) => sum + (p.profit ?? 0), 0);

  const totalInvested = projects
    .filter((p) => p.status !== 'sold')
    .reduce((sum, p) => sum + (p.totalCost || p.purchasePrice || 0), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Projects</h2>
          <p className="text-sm text-gray-500 mt-0.5">Track your furniture flips from purchase to sale.</p>
        </div>
        {projects.length > 0 && (
          <div className="flex gap-3">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 px-4 py-2.5 text-center">
              <p className="text-[11px] text-gray-500 uppercase font-medium">Active</p>
              <p className="text-lg font-bold text-gray-900">{projects.filter((p) => p.status !== 'sold').length}</p>
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 px-4 py-2.5 text-center">
              <p className="text-[11px] text-gray-500 uppercase font-medium">Invested</p>
              <p className="text-lg font-bold text-gray-900">${totalInvested.toFixed(0)}</p>
            </div>
            {totalProfit !== 0 && (
              <div className={`bg-white rounded-lg shadow-sm border border-gray-200 px-4 py-2.5 text-center`}>
                <p className="text-[11px] text-gray-500 uppercase font-medium">Profit</p>
                <p className={`text-lg font-bold ${totalProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>${totalProfit.toFixed(0)}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {projects.length === 0 ? (
        <div className="text-center py-24">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <p className="text-gray-900 font-medium">No projects yet</p>
          <p className="text-sm text-gray-500 mt-1">Start one from a listing detail page.</p>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-4">
          {PROJECT_PIPELINE_STATUSES.map((status) => {
            const meta = PROJECT_STATUS_META[status];
            return (
              <div key={status}>
                <div className={`${meta.header} rounded-t-lg px-4 py-2.5 flex items-center justify-between`}>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${meta.dot}`} />
                    <h3 className={`text-xs font-semibold ${meta.text} uppercase tracking-wide`}>
                      {status}
                    </h3>
                  </div>
                  <span className={`text-xs font-semibold ${meta.text} bg-white/60 rounded-full px-2 py-0.5`}>
                    {grouped[status].length}
                  </span>
                </div>
                <div className={`${meta.bg} rounded-b-lg p-2.5 min-h-[200px] space-y-2.5`}>
                  {grouped[status].map((project) => {
                    const days = daysSince(project.updatedAt);
                    return (
                      <Link
                        key={project.id}
                        to={`/projects/${project.id}`}
                        className="block bg-white rounded-lg shadow-sm border border-gray-200/80 p-3 hover:shadow-md hover:border-gray-300 transition-all"
                      >
                        {project.primaryImagePath && (
                          <img
                            src={`/images/${project.primaryImagePath}`}
                            alt=""
                            className="w-full h-24 object-cover rounded-md mb-2.5"
                          />
                        )}
                        <p className="font-medium text-gray-900 text-sm truncate">{project.name}</p>
                        <div className="flex items-center justify-between mt-1.5">
                          <span className="text-xs font-medium text-gray-900">${project.purchasePrice}</span>
                          {project.furnitureType && (
                            <span className="text-[11px] text-gray-400 truncate ml-2">{project.furnitureType}</span>
                          )}
                        </div>
                        {project.profit != null && (
                          <p className={`text-xs font-semibold mt-1.5 ${project.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {project.profit >= 0 ? '+' : ''}${project.profit.toFixed(0)} profit
                          </p>
                        )}
                        {project.totalCost && !project.profit && (
                          <p className="text-[11px] text-gray-400 mt-1.5">
                            ${project.totalCost.toFixed(0)} invested
                          </p>
                        )}
                        {days != null && (
                          <p className="text-[11px] text-gray-400 mt-0.5">
                            {days === 0 ? 'Today' : `${days}d in stage`}
                          </p>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
