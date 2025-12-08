-- HelmetPulse Database Schema
-- Run this in Supabase SQL Editor

-- Main helmets catalog
CREATE TABLE IF NOT EXISTS helmets (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  player VARCHAR(100),
  team VARCHAR(100),
  helmet_type VARCHAR(50), -- speedflex, speed-authentic, speed-replica, mini, midi-speedflex
  design_type VARCHAR(50), -- regular, rave, camo, salute, alternate, throwback, etc.
  auth_company VARCHAR(50), -- JSA, Fanatics, Beckett, PSA/DNA
  ebay_search_query TEXT NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Price history (keeps all monthly snapshots)
CREATE TABLE IF NOT EXISTS helmet_prices (
  id SERIAL PRIMARY KEY,
  helmet_id INTEGER REFERENCES helmets(id) ON DELETE CASCADE,
  median_price DECIMAL(10,2),
  min_price DECIMAL(10,2),
  max_price DECIMAL(10,2),
  total_results INTEGER,
  ebay_url TEXT,
  scraped_at TIMESTAMP DEFAULT NOW()
);

-- User accounts
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- User watchlists (tracks what users follow)
CREATE TABLE IF NOT EXISTS user_watchlists (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  helmet_id INTEGER REFERENCES helmets(id) ON DELETE CASCADE,
  cost_basis DECIMAL(10,2),
  added_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, helmet_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_helmets_player ON helmets(player);
CREATE INDEX IF NOT EXISTS idx_helmets_team ON helmets(team);
CREATE INDEX IF NOT EXISTS idx_helmets_type ON helmets(helmet_type);
CREATE INDEX IF NOT EXISTS idx_helmets_design ON helmets(design_type);
CREATE INDEX IF NOT EXISTS idx_helmet_prices_helmet_id ON helmet_prices(helmet_id);
CREATE INDEX IF NOT EXISTS idx_helmet_prices_scraped_at ON helmet_prices(scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_watchlists_user_id ON user_watchlists(user_id);

-- View for latest prices
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
  hp.median_price as current_price,
  hp.min_price,
  hp.max_price,
  hp.total_results,
  hp.ebay_url,
  hp.scraped_at as last_updated,
  -- Get previous price for change calculation
  LAG(hp.median_price) OVER (PARTITION BY h.id ORDER BY hp.scraped_at DESC) as last_price
FROM helmets h
LEFT JOIN helmet_prices hp ON h.id = hp.helmet_id
WHERE h.is_active = true
ORDER BY h.id, hp.scraped_at DESC;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to auto-update updated_at
CREATE TRIGGER update_helmets_updated_at BEFORE UPDATE ON helmets
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable Row Level Security (optional, for future multi-tenancy)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_watchlists ENABLE ROW LEVEL SECURITY;

-- Basic policies (users can only see their own data)
CREATE POLICY "Users can view own data" ON users FOR SELECT USING (auth.uid()::text = id::text);
CREATE POLICY "Users can view own watchlists" ON user_watchlists FOR ALL USING (auth.uid()::text = user_id::text);

-- Public read access to helmets and prices (anyone can browse catalog)
ALTER TABLE helmets ENABLE ROW LEVEL SECURITY;
ALTER TABLE helmet_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view helmets" ON helmets FOR SELECT USING (true);
CREATE POLICY "Anyone can view prices" ON helmet_prices FOR SELECT USING (true);
