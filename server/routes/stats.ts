import { Hono } from 'hono';
import { pool } from '../db/index.js';

// Postgres COUNT returns string; parse numeric fields
function parseNumbers(row: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? parseFloat(v) : v;
  }
  return out;
}

export const statsRouter = new Hono()
  // Analytics includes both user-owned and agent-discovered listings
  // that the user can see (their own + agent listings with userId IS NULL)
  .get('/', async (c) => {
  const user = c.get('user');
  const userId = user.id;

  // Listings visible to this user: their own OR agent-discovered
  const listingFilter = '(user_id = $1 OR user_id IS NULL)';

  const [
    summaryResult,
    projectSummaryResult,
    profitResult,
    platformResult,
    flipResult,
    scrapedResult,
    priceResult,
    dealScoreResult,
    statusResult,
    furnitureResult,
  ] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*) as total_listings,
        COUNT(CASE WHEN status = 'dismissed' THEN 1 END) as dismissed_count,
        COUNT(CASE WHEN deal_score IS NOT NULL THEN 1 END) as analyzed_count,
        AVG(asking_price) as avg_asking_price,
        MIN(scraped_at) as first_scraped,
        MAX(scraped_at) as last_scraped
      FROM listings WHERE ${listingFilter}
    `, [userId]),

    pool.query(`
      SELECT
        COUNT(*) as total_projects,
        SUM(CASE WHEN status = 'sold' THEN profit ELSE 0 END) as total_profit,
        AVG(CASE WHEN status = 'sold' THEN roi_percentage END) as avg_roi,
        AVG(CASE WHEN status = 'sold' AND sold_date IS NOT NULL AND purchase_date IS NOT NULL
          THEN EXTRACT(EPOCH FROM (sold_date::timestamp - purchase_date::timestamp)) / 86400 END) as avg_flip_days
      FROM projects WHERE user_id = $1
    `, [userId]),

    pool.query(`
      SELECT
        TO_CHAR(sold_date::timestamp, 'YYYY-MM') as month,
        SUM(profit) as total_profit,
        COUNT(*) as count
      FROM projects
      WHERE status = 'sold' AND sold_date IS NOT NULL AND user_id = $1
      GROUP BY TO_CHAR(sold_date::timestamp, 'YYYY-MM')
      ORDER BY month
    `, [userId]),

    pool.query(`
      SELECT platform, COUNT(*) as count
      FROM listings WHERE ${listingFilter}
      GROUP BY platform ORDER BY count DESC
    `, [userId]),

    pool.query(`
      SELECT name,
        CAST(EXTRACT(EPOCH FROM (sold_date::timestamp - purchase_date::timestamp)) / 86400 AS INTEGER) as days
      FROM projects
      WHERE status = 'sold' AND sold_date IS NOT NULL AND purchase_date IS NOT NULL AND user_id = $1
      ORDER BY sold_date DESC LIMIT 20
    `, [userId]),

    pool.query(`
      SELECT DATE_TRUNC('week', scraped_at::timestamp)::date::text as week, COUNT(*) as count
      FROM listings WHERE ${listingFilter}
      GROUP BY week ORDER BY week
    `, [userId]),

    pool.query(`
      SELECT
        CASE
          WHEN asking_price < 50 THEN '< $50'
          WHEN asking_price < 100 THEN '$50-99'
          WHEN asking_price < 200 THEN '$100-199'
          WHEN asking_price < 500 THEN '$200-499'
          WHEN asking_price < 1000 THEN '$500-999'
          ELSE '$1000+'
        END as bucket, COUNT(*) as count
      FROM listings WHERE asking_price IS NOT NULL AND ${listingFilter}
      GROUP BY bucket ORDER BY MIN(asking_price)
    `, [userId]),

    pool.query(`
      SELECT
        CASE
          WHEN deal_score < 1.0 THEN '< 1.0x'
          WHEN deal_score < 1.5 THEN '1.0-1.4x'
          WHEN deal_score < 2.0 THEN '1.5-1.9x'
          WHEN deal_score < 2.5 THEN '2.0-2.4x'
          WHEN deal_score < 3.0 THEN '2.5-2.9x'
          ELSE '3.0x+'
        END as bucket, COUNT(*) as count
      FROM listings WHERE deal_score IS NOT NULL AND ${listingFilter}
      GROUP BY bucket ORDER BY MIN(deal_score)
    `, [userId]),

    pool.query(`
      SELECT status, COUNT(*) as count
      FROM listings WHERE ${listingFilter}
      GROUP BY status ORDER BY count DESC
    `, [userId]),

    pool.query(`
      SELECT furniture_type as type, COUNT(*) as count
      FROM listings WHERE furniture_type IS NOT NULL AND ${listingFilter}
      GROUP BY furniture_type ORDER BY count DESC LIMIT 10
    `, [userId]),
  ]);

  return c.json({
    summary: parseNumbers(summaryResult.rows[0] || {}),
    projectSummary: parseNumbers(projectSummaryResult.rows[0] || {}),
    profitOverTime: profitResult.rows.map(parseNumbers),
    dealsByPlatform: platformResult.rows.map(parseNumbers),
    flipTimes: flipResult.rows.map(parseNumbers),
    scrapedOverTime: scrapedResult.rows.map(parseNumbers),
    priceDistribution: priceResult.rows.map(parseNumbers),
    dealScoreDistribution: dealScoreResult.rows.map(parseNumbers),
    statusBreakdown: statusResult.rows.map(parseNumbers),
    topFurnitureTypes: furnitureResult.rows.map(parseNumbers),
  });
});
