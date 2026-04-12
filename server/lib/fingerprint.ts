import { createHash } from 'crypto';

export interface FingerprintInput {
  platform: string;
  title: string;
  askingPrice?: number | null;
  location?: string | null;
}

export function fingerprint(listing: FingerprintInput): string {
  const normalized = `${listing.platform}:${listing.title.toLowerCase().trim()}:${listing.askingPrice ?? ''}:${listing.location?.toLowerCase().trim() ?? ''}`;
  return createHash('sha256').update(normalized).digest('hex').slice(0, 32);
}
