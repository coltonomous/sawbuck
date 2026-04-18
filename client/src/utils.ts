const CDN_DOMAIN = (import.meta as any).env?.VITE_CDN_DOMAIN || '';

export function resolveImageUrl(path: string): string {
  if (path.startsWith('http')) return path;
  const cleaned = path.replace(/^data\/images\//, '');
  if (CDN_DOMAIN) {
    const base = CDN_DOMAIN.startsWith('http') ? CDN_DOMAIN : `https://${CDN_DOMAIN}`;
    return `${base.replace(/\/$/, '')}/${cleaned}`;
  }
  return `/images/${cleaned}`;
}

/** Format a date string or ISO timestamp as a readable date like "Apr 14, 2026" */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
