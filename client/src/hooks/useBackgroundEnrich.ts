import { useEffect, useRef, useCallback } from 'react';
import { api, type Listing } from '../api';

interface EnrichUpdate {
  primaryImage: string | null;
  description: string | null;
}

/**
 * Background-enriches listings that are missing details (images, description).
 * Fetches detail pages one at a time to avoid overwhelming the browser pool.
 * Calls onUpdate with the enriched listing data so the UI can update in place.
 */
export function useBackgroundEnrich(
  listings: Listing[],
  onUpdate: (id: number, data: EnrichUpdate) => void,
) {
  const queuedRef = useRef(new Set<number>());
  const activeRef = useRef(false);
  const pendingRef = useRef<number[]>([]);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const processQueue = useCallback(async () => {
    if (activeRef.current) return;
    activeRef.current = true;

    while (pendingRef.current.length > 0) {
      const id = pendingRef.current.shift()!;
      try {
        const detail = await api.getListing(id);
        const img = detail.images?.[0];
        const primaryImage = img
          ? img.localPathResized || img.localPathOriginal || img.sourceUrl
          : null;
        if (primaryImage || detail.description) {
          onUpdateRef.current(id, { primaryImage, description: detail.description });
        }
      } catch {
        // Non-critical — skip
      }
    }

    activeRef.current = false;
  }, []);

  useEffect(() => {
    let added = false;
    for (const listing of listings) {
      if (!listing.primaryImage && !queuedRef.current.has(listing.id)) {
        queuedRef.current.add(listing.id);
        pendingRef.current.push(listing.id);
        added = true;
      }
    }
    if (added) {
      processQueue();
    }
  }, [listings, processQueue]);
}
