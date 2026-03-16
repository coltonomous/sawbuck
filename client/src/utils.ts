export function resolveImageUrl(path: string, resized?: boolean): string {
  if (path.startsWith('http')) return path;
  return `/images/${resized ? 'resized/' : ''}${path.replace('resized/', '')}`;
}
