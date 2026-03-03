import { type ReactNode } from 'react';

// ── Platform badge ──────────────────────────────────────────────────

const PLATFORM_COLORS: Record<string, string> = {
  craigslist: 'bg-purple-100 text-purple-700',
  offerup: 'bg-teal-100 text-teal-700',
  ebay: 'bg-blue-100 text-blue-700',
  mercari: 'bg-orange-100 text-orange-700',
};

const PLATFORM_LABELS: Record<string, string> = {
  craigslist: 'Craigslist',
  offerup: 'OfferUp',
  ebay: 'eBay',
  mercari: 'Mercari',
};

export function PlatformBadge({ platform }: { platform: string }) {
  return (
    <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${PLATFORM_COLORS[platform] || 'bg-gray-100 text-gray-700'}`}>
      {platform}
    </span>
  );
}

/** Full label version for settings/display contexts */
export function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] || platform;
}

export function platformColor(platform: string): string {
  const map: Record<string, string> = {
    craigslist: 'bg-purple-500',
    offerup: 'bg-teal-500',
    ebay: 'bg-blue-500',
    mercari: 'bg-orange-500',
  };
  return map[platform] || 'bg-gray-500';
}

// ── Deal score badge ────────────────────────────────────────────────

export function DealScoreBadge({ score, className = '' }: { score: number; className?: string }) {
  const colors = score >= 2 ? 'bg-green-100 text-green-700'
    : score >= 1.5 ? 'bg-yellow-100 text-yellow-700'
    : 'bg-gray-100 text-gray-500';
  return (
    <span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold ${colors} ${className}`}>
      {score.toFixed(1)}x
    </span>
  );
}

export function dealScoreColor(score: number): string {
  return score >= 2 ? 'bg-green-500'
    : score >= 1.5 ? 'bg-yellow-500'
    : 'bg-gray-300';
}

export function dealScoreTextColor(score: number): string {
  return score >= 2 ? 'text-green-700'
    : score >= 1.5 ? 'text-yellow-700'
    : 'text-gray-500';
}

// ── Status pill ─────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-50 text-blue-600',
  analyzed: 'bg-green-50 text-green-600',
  watching: 'bg-amber-50 text-amber-600',
  acquired: 'bg-purple-50 text-purple-600',
  dismissed: 'bg-gray-100 text-gray-400',
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_COLORS[status] || 'bg-gray-100 text-gray-500'}`}>
      {status}
    </span>
  );
}

// ── Loading spinner ─────────────────────────────────────────────────

export function Spinner({ size = 'sm', color = 'white' }: { size?: 'xs' | 'sm' | 'md'; color?: 'white' | 'blue' }) {
  const sizeClass = size === 'xs' ? 'w-3 h-3' : size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
  const borderClass = color === 'blue'
    ? 'border-blue-600 border-t-transparent'
    : 'border-white/30 border-t-white';
  return <div className={`${sizeClass} border-2 ${borderClass} rounded-full animate-spin`} />;
}

// ── Empty state ─────────────────────────────────────────────────────

export function EmptyState({ icon, title, subtitle, action }: {
  icon: ReactNode;
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="text-center py-24">
      <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
        {icon}
      </div>
      <p className="text-gray-900 font-medium text-lg">{title}</p>
      {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ── Card ────────────────────────────────────────────────────────────

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-lg shadow-sm border border-gray-200 p-5 ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-4">{children}</h3>
  );
}

// ── Back button ─────────────────────────────────────────────────────

export function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-sm text-gray-400 hover:text-gray-600 mb-4 inline-flex items-center gap-1 transition-colors">
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
      Back
    </button>
  );
}

// ── Icons ───────────────────────────────────────────────────────────

export function ExternalLinkIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  );
}

export function SearchIcon({ className = 'w-6 h-6 text-gray-400' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
  );
}

export function NotFoundIcon({ className = 'w-7 h-7 text-gray-400' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
    </svg>
  );
}
