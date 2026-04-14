export function resolveImageUrl(path: string): string {
  if (path.startsWith('http')) return path;
  return `/images/${path}`;
}

/** Format a date string or ISO timestamp as a readable date like "Apr 14, 2026" */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
