import { useEffect, useState } from 'react';
import { api, type StatsResponse } from '../api';
import { SkeletonChartPage } from '../components/Skeleton';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { CHART_COLORS } from '@shared/constants';

export default function Analytics() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getStats()
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Analytics</h2>
      <SkeletonChartPage />
    </div>
  );

  if (!stats) return (
    <div className="text-center py-24">
      <div className="w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-4">
        <svg className="w-7 h-7 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      </div>
      <p className="text-gray-900 font-medium">Failed to load analytics</p>
      <p className="text-sm text-gray-500 mt-1">Try refreshing the page.</p>
      <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors">
        Refresh
      </button>
    </div>
  );

  const { summary, projectSummary, profitOverTime, dealsByPlatform, scrapedOverTime, priceDistribution, dealScoreDistribution, statusBreakdown, topFurnitureTypes } = stats;

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Analytics</h2>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Listings" value={summary?.total_listings ?? 0} />
        <StatCard label="Total Profit" value={`$${(projectSummary?.total_profit ?? 0).toFixed(0)}`} color="text-green-700" />
        <StatCard label="Avg ROI" value={projectSummary?.avg_roi != null ? `${projectSummary.avg_roi.toFixed(0)}%` : '-'} color="text-blue-700" />
        <StatCard label="Avg Flip Time" value={projectSummary?.avg_flip_days != null ? `${Math.round(projectSummary.avg_flip_days)}d` : '-'} color="text-amber-700" />
      </div>

      {/* Profit over time */}
      {profitOverTime.length > 0 && (
        <ChartCard title="Profit Over Time" full>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={profitOverTime}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(v) => `$${Number(v).toFixed(0)}`} />
              <Line type="monotone" dataKey="total_profit" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} name="Profit" />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Platform + Status row */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <ChartCard title="Deals by Platform">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={dealsByPlatform} dataKey="count" nameKey="platform" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name} (${value})`}>
                {dealsByPlatform.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Status Breakdown">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={statusBreakdown} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name} (${value})`}>
                {statusBreakdown.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Scraped over time */}
      {scrapedOverTime.length > 0 && (
        <ChartCard title="Listings Scraped Over Time" full>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={scrapedOverTime}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Area type="monotone" dataKey="count" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} name="Listings" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Price + Deal score row */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <ChartCard title="Price Distribution">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={priceDistribution}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Listings" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard title="Deal Score Distribution">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={dealScoreDistribution}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} name="Listings" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Top furniture types */}
      {topFurnitureTypes.length > 0 && (
        <ChartCard title="Top Furniture Types" full>
          <ResponsiveContainer width="100%" height={Math.max(200, topFurnitureTypes.length * 36)}>
            <BarChart data={topFurnitureTypes} layout="vertical" margin={{ left: 80 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis type="number" tick={{ fontSize: 12 }} />
              <YAxis type="category" dataKey="type" tick={{ fontSize: 12 }} width={80} />
              <Tooltip />
              <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} name="Listings" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      )}
    </div>
  );
}

function StatCard({ label, value, color = 'text-gray-900' }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <p className="text-[11px] text-gray-500 uppercase tracking-wide font-medium">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  );
}

function ChartCard({ title, children, full }: { title: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={`bg-white rounded-lg shadow-sm border border-gray-200 p-5 mb-4 ${full ? '' : ''}`}>
      <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4">{title}</h3>
      {children}
    </div>
  );
}
