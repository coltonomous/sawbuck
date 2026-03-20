export function resolveImageUrl(path: string): string {
  if (path.startsWith('http')) return path;
  return `/images/${path}`;
}
