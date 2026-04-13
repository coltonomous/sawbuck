import type { Context } from 'hono';
import { asc, desc, type Column } from 'drizzle-orm';

export interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
  sort: string | undefined;
  sortDir: 'asc' | 'desc';
  search: string | undefined;
}

/**
 * Parse standard pagination, sort, and search query params from a request.
 * Use across all list endpoints for consistent behavior.
 *
 * Supported query params:
 *   page (default 1), limit (default 50, max 200),
 *   sort, sort_dir (asc|desc, default desc),
 *   search (free-text search)
 */
export function parsePagination(c: Context): PaginationParams {
  const { page = '1', limit = '50', sort, sort_dir, search } = c.req.query();

  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
  const sortDir = sort_dir === 'asc' ? 'asc' : 'desc';

  return {
    page: pageNum,
    limit: limitNum,
    offset: (pageNum - 1) * limitNum,
    sort: sort || undefined,
    sortDir,
    search: search || undefined,
  };
}

/**
 * Build a Drizzle order-by clause from sort params and a column map.
 * Falls back to defaultOrder if the sort key isn't in the map.
 */
export function buildOrderBy(
  params: PaginationParams,
  columns: Record<string, Column>,
  defaultOrder: ReturnType<typeof desc>,
) {
  const col = params.sort ? columns[params.sort] : undefined;
  if (!col) return defaultOrder;
  return params.sortDir === 'asc' ? asc(col) : desc(col);
}
