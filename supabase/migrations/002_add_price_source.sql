-- Add source column to track where prices come from
ALTER TABLE helmet_prices ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'ebay';

-- Create index for querying by source
CREATE INDEX IF NOT EXISTS idx_helmet_prices_source ON helmet_prices(source);

-- Update the view to show latest price from each source
DROP VIEW IF EXISTS helmet_latest_prices;

CREATE OR REPLACE VIEW helmet_latest_prices AS
SELECT DISTINCT ON (h.id)
  h.id,
  h.name,
  h.player,
  h.team,
  h.helmet_type,
  h.design_type,
  h.auth_company,
  h.ebay_search_query,

  -- Calculate median price across all sources
  (
    SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY hp2.median_price)
    FROM helmet_prices hp2
    WHERE hp2.helmet_id = h.id
    AND hp2.scraped_at >= NOW() - INTERVAL '7 days'
  ) as current_price,

  hp.min_price,
  hp.max_price,
  hp.total_results,
  hp.ebay_url,
  hp.source,
  hp.scraped_at as last_updated,

  -- Get previous price for change calculation
  LAG(hp.median_price) OVER (PARTITION BY h.id ORDER BY hp.scraped_at DESC) as last_price
FROM helmets h
LEFT JOIN helmet_prices hp ON h.id = hp.helmet_id
WHERE h.is_active = true
ORDER BY h.id, hp.scraped_at DESC;

-- Create a new view for multi-source price comparison
CREATE OR REPLACE VIEW helmet_price_comparison AS
SELECT
  h.id as helmet_id,
  h.name,
  h.player,
  h.team,
  MAX(CASE WHEN hp.source = 'ebay' THEN hp.median_price END) as ebay_price,
  MAX(CASE WHEN hp.source = 'rsa' THEN hp.median_price END) as rsa_price,
  MAX(CASE WHEN hp.source = 'fanatics' THEN hp.median_price END) as fanatics_price,
  MAX(CASE WHEN hp.source = 'radtke' THEN hp.median_price END) as radtke_price,
  MAX(CASE WHEN hp.source = 'denver' THEN hp.median_price END) as denver_price,

  -- Calculate median across all sources
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY hp.median_price) as median_price_all_sources,

  COUNT(DISTINCT hp.source) as num_sources,
  MAX(hp.scraped_at) as last_updated
FROM helmets h
LEFT JOIN helmet_prices hp ON h.id = hp.helmet_id
WHERE h.is_active = true
AND hp.scraped_at >= NOW() - INTERVAL '7 days'
GROUP BY h.id, h.name, h.player, h.team;
