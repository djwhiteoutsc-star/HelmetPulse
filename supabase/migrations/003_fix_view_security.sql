-- Fix Security Definer View warnings
-- Change views to use SECURITY INVOKER to respect RLS policies of the querying user

-- Fix helmet_latest_prices view
ALTER VIEW public.helmet_latest_prices SET (security_invoker = on);

-- Fix helmet_price_comparison view
ALTER VIEW public.helmet_price_comparison SET (security_invoker = on);

-- Fix Function Search Path Mutable warning
-- Set search_path to prevent search path manipulation attacks
ALTER FUNCTION public.update_updated_at_column() SET search_path = '';

-- Performance fixes for user_watchlists table
-- Add missing index on helmet_id foreign key
CREATE INDEX IF NOT EXISTS idx_user_watchlists_helmet_id ON user_watchlists(helmet_id);

-- Drop unused index (UNIQUE constraint on user_id, helmet_id already covers user_id lookups)
DROP INDEX IF EXISTS idx_user_watchlists_user_id;
