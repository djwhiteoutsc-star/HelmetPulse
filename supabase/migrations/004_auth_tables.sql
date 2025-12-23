-- Migration: Move authentication from Airtable to Supabase
-- This creates users, jwt_tokens, and access_logs tables

-- Users table
CREATE TABLE IF NOT EXISTS auth_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    reset_token VARCHAR(10),
    reset_token_expires TIMESTAMP WITH TIME ZONE
);

-- JWT Tokens table
CREATE TABLE IF NOT EXISTS auth_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth_users(id) ON DELETE CASCADE,
    token_value TEXT NOT NULL,
    issued_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expiration_date TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked BOOLEAN DEFAULT FALSE,
    device_info TEXT
);

-- Access Logs table (for security auditing)
CREATE TABLE IF NOT EXISTS auth_access_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth_users(id) ON DELETE SET NULL,
    token_id UUID REFERENCES auth_tokens(id) ON DELETE SET NULL,
    event_type VARCHAR(50) NOT NULL,
    ip_address VARCHAR(45),
    device_info TEXT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User watchlists table (stores user's tracked helmets)
CREATE TABLE IF NOT EXISTS auth_user_watchlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth_users(id) ON DELETE CASCADE,
    watchlist_data JSONB DEFAULT '[]'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth_users(email);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_id ON auth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_value ON auth_tokens(token_value);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_expiration ON auth_tokens(expiration_date);
CREATE INDEX IF NOT EXISTS idx_auth_access_logs_user_id ON auth_access_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_access_logs_created ON auth_access_logs(created_at);

-- Enable RLS
ALTER TABLE auth_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_user_watchlists ENABLE ROW LEVEL SECURITY;

-- RLS Policies (service role bypasses these, anon key respects them)
-- For now, allow service role full access (we use service key on backend)
CREATE POLICY "Service role full access to auth_users" ON auth_users FOR ALL USING (true);
CREATE POLICY "Service role full access to auth_tokens" ON auth_tokens FOR ALL USING (true);
CREATE POLICY "Service role full access to auth_access_logs" ON auth_access_logs FOR ALL USING (true);
CREATE POLICY "Service role full access to auth_user_watchlists" ON auth_user_watchlists FOR ALL USING (true);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_auth_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- Triggers for updated_at
CREATE TRIGGER update_auth_users_updated_at
    BEFORE UPDATE ON auth_users
    FOR EACH ROW EXECUTE FUNCTION update_auth_updated_at();

CREATE TRIGGER update_auth_user_watchlists_updated_at
    BEFORE UPDATE ON auth_user_watchlists
    FOR EACH ROW EXECUTE FUNCTION update_auth_updated_at();
