import { Hono } from 'hono';
import { sqlite } from '../db/index.js';

export const statsRouter = new Hono();

statsRouter.get('/', (c) => {
  // Summary stats
  const summary = sqlite.prepare(`
    SELECT
      COUNT(*) as total_listings,
      COUNT(CASE WHEN status = 'dismissed' THEN 1 END) as dismissed_count,
      COUNT(CASE WHEN deal_score IS NOT NULL THEN 1 END) as analyzed_count,
      AVG(asking_price) as avg_asking_price,
      MIN(scraped_at) as first_scraped,
      MAX(scraped_at) as last_scraped
    FROM listings
  `).get() as any;

  // Project summary
  const projectSummary = sqlite.prepare(`
    SELECT
      COUNT(*) as total_projects,
      SUM(CASE WHEN status = 'sold' THEN profit ELSE 0 END) as total_profit,
      AVG(CASE WHEN status = 'sold' THEN roi_percentage END) as avg_roi,
      AVG(CASE WHEN status = 'sold' THEN julianday(sold_date) - julianday(purchase_date) END) as avg_flip_days
    FROM projects
  `).get() as any;

  // Profit over time (sold projects by month)
  const profitOverTime = sqlite.prepare(`
    SELECT
      strftime('%Y-%m', sold_date) as month,
      SUM(profit) as total_profit,
      COUNT(*) as count
    FROM projects
    WHERE status = 'sold' AND sold_date IS NOT NULL
    GROUP BY strftime('%Y-%m', sold_date)
    ORDER BY month
  `).all();

  // Deals by platform
  const dealsByPlatform = sqlite.prepare(`
    SELECT
      platform,
      COUNT(*) as count
    FROM listings
    GROUP BY platform
    ORDER BY count DESC
  `).all();

  // Flip times (projects)
  const flipTimes = sqlite.prepare(`
    SELECT
      name,
      CAST(julianday(sold_date) - julianday(purchase_date) AS INTEGER) as days
    FROM projects
    WHERE status = 'sold' AND sold_date IS NOT NULL AND purchase_date IS NOT NULL
    ORDER BY sold_date DESC
    LIMIT 20
  `).all();

  // Scraped over time (by week)
  const scrapedOverTime = sqlite.prepare(`
    SELECT
      strftime('%Y-%m-%d', scraped_at, 'weekday 0', '-6 days') as week,
      COUNT(*) as count
    FROM listings
    GROUP BY week
    ORDER BY week
  `).all();

  // Price distribution (buckets)
  const priceDistribution = sqlite.prepare(`
    SELECT
      CASE
        WHEN asking_price < 50 THEN '< $50'
        WHEN asking_price < 100 THEN '$50-99'
        WHEN asking_price < 200 THEN '$100-199'
        WHEN asking_price < 500 THEN '$200-499'
        WHEN asking_price < 1000 THEN '$500-999'
        ELSE '$1000+'
      END as bucket,
      COUNT(*) as count
    FROM listings
    WHERE asking_price IS NOT NULL
    GROUP BY bucket
    ORDER BY MIN(asking_price)
  `).all();

  // Deal score distribution
  const dealScoreDistribution = sqlite.prepare(`
    SELECT
      CASE
        WHEN deal_score < 1.0 THEN '< 1.0x'
        WHEN deal_score < 1.5 THEN '1.0-1.4x'
        WHEN deal_score < 2.0 THEN '1.5-1.9x'
        WHEN deal_score < 2.5 THEN '2.0-2.4x'
        WHEN deal_score < 3.0 THEN '2.5-2.9x'
        ELSE '3.0x+'
      END as bucket,
      COUNT(*) as count
    FROM listings
    WHERE deal_score IS NOT NULL
    GROUP BY bucket
    ORDER BY MIN(deal_score)
  `).all();

  // Status breakdown
  const statusBreakdown = sqlite.prepare(`
    SELECT status, COUNT(*) as count
    FROM listings
    GROUP BY status
    ORDER BY count DESC
  `).all();

  // Top furniture types
  const topFurnitureTypes = sqlite.prepare(`
    SELECT furniture_type as type, COUNT(*) as count
    FROM listings
    WHERE furniture_type IS NOT NULL
    GROUP BY furniture_type
    ORDER BY count DESC
    LIMIT 10
  `).all();

  return c.json({
    summary,
    projectSummary,
    profitOverTime,
    dealsByPlatform,
    flipTimes,
    scrapedOverTime,
    priceDistribution,
    dealScoreDistribution,
    statusBreakdown,
    topFurnitureTypes,
  });
});
