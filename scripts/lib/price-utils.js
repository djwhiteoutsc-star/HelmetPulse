/**
 * Unified Price Utilities
 *
 * This module provides consistent methods for adding/updating prices in the database.
 * All import scripts and scrapers should use these functions to ensure data consistency.
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Valid price sources
const VALID_SOURCES = ['ebay', 'fanatics', 'rsa', 'radtke', 'pristine'];

// helmet_prices table schema (correct column names)
const PRICE_SCHEMA = {
    helmet_id: 'number',      // Required - FK to helmets.id
    source: 'string',         // Required - price source
    median_price: 'number',   // The price value
    min_price: 'number',      // Minimum price (can equal median for single values)
    max_price: 'number',      // Maximum price (can equal median for single values)
    total_results: 'number',  // Number of results found
    ebay_url: 'string',       // Optional URL
    scraped_at: 'timestamp'   // When the price was fetched
};

/**
 * Validate that price source is valid
 */
function validateSource(source) {
    if (!VALID_SOURCES.includes(source)) {
        throw new Error(`Invalid source: ${source}. Valid sources: ${VALID_SOURCES.join(', ')}`);
    }
    return true;
}

/**
 * Add or update a price for a helmet
 *
 * @param {number} helmetId - The helmet ID
 * @param {string} source - Price source (ebay, fanatics, rsa, radtke, pristine)
 * @param {number} price - The price value
 * @param {object} options - Optional: { minPrice, maxPrice, totalResults, ebayUrl }
 * @returns {object} - { success: boolean, action: 'inserted'|'updated', error?: string }
 */
async function upsertPrice(helmetId, source, price, options = {}) {
    try {
        validateSource(source);

        if (!helmetId || typeof helmetId !== 'number') {
            return { success: false, error: 'Invalid helmet_id' };
        }

        if (!price || typeof price !== 'number' || price <= 0) {
            return { success: false, error: 'Invalid price value' };
        }

        const minPrice = options.minPrice || price;
        const maxPrice = options.maxPrice || price;
        const totalResults = options.totalResults || 1;
        const ebayUrl = options.ebayUrl || null;

        // Check if price already exists for this helmet + source
        const { data: existing } = await supabase
            .from('helmet_prices')
            .select('id')
            .eq('helmet_id', helmetId)
            .eq('source', source);

        if (existing && existing.length > 0) {
            // Update existing
            const { error } = await supabase
                .from('helmet_prices')
                .update({
                    median_price: price,
                    min_price: minPrice,
                    max_price: maxPrice,
                    total_results: totalResults,
                    ebay_url: ebayUrl,
                    scraped_at: new Date().toISOString()
                })
                .eq('id', existing[0].id);

            if (error) return { success: false, error: error.message };
            return { success: true, action: 'updated' };
        } else {
            // Insert new
            const { error } = await supabase
                .from('helmet_prices')
                .insert({
                    helmet_id: helmetId,
                    source: source,
                    median_price: price,
                    min_price: minPrice,
                    max_price: maxPrice,
                    total_results: totalResults,
                    ebay_url: ebayUrl,
                    scraped_at: new Date().toISOString()
                });

            if (error) return { success: false, error: error.message };
            return { success: true, action: 'inserted' };
        }
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * Find a helmet by player and team with flexible matching
 *
 * @param {string} player - Player name
 * @param {string} team - Team name
 * @param {string} helmetType - Helmet type (optional for exact match)
 * @param {string} designType - Design type (optional for exact match)
 * @returns {object|null} - Helmet object or null if not found
 */
async function findHelmet(player, team, helmetType = null, designType = null) {
    // Try exact match first
    if (helmetType && designType) {
        const { data: exact } = await supabase
            .from('helmets')
            .select('id, player, team, helmet_type, design_type')
            .eq('player', player)
            .eq('team', team)
            .eq('helmet_type', helmetType)
            .eq('design_type', designType);

        if (exact && exact.length > 0) return exact[0];
    }

    // Try player + team + helmet_type
    if (helmetType) {
        const { data: partial } = await supabase
            .from('helmets')
            .select('id, player, team, helmet_type, design_type')
            .eq('player', player)
            .eq('team', team)
            .eq('helmet_type', helmetType)
            .limit(1);

        if (partial && partial.length > 0) return partial[0];
    }

    // Try just player + team
    const { data: basic } = await supabase
        .from('helmets')
        .select('id, player, team, helmet_type, design_type')
        .eq('player', player)
        .eq('team', team)
        .limit(1);

    if (basic && basic.length > 0) return basic[0];

    return null;
}

/**
 * Get price statistics
 */
async function getPriceStats() {
    const stats = {};

    for (const source of VALID_SOURCES) {
        const { data, count } = await supabase
            .from('helmet_prices')
            .select('helmet_id', { count: 'exact' })
            .eq('source', source);

        const uniqueHelmets = new Set((data || []).map(p => p.helmet_id));
        stats[source] = {
            records: count || 0,
            uniqueHelmets: uniqueHelmets.size
        };
    }

    const { count: totalHelmets } = await supabase
        .from('helmets')
        .select('*', { count: 'exact', head: true });

    stats.totalHelmets = totalHelmets;

    return stats;
}

/**
 * Validate database schema matches expectations
 */
async function validateSchema() {
    const errors = [];

    // Test insert with all required columns
    const testData = {
        helmet_id: -1, // Will fail FK but validates column names
        source: 'test',
        median_price: 99.99,
        min_price: 99.99,
        max_price: 99.99,
        total_results: 1,
        scraped_at: new Date().toISOString()
    };

    const { error } = await supabase
        .from('helmet_prices')
        .insert(testData);

    if (error) {
        if (error.message.includes('violates foreign key')) {
            // This is expected - schema is valid
            return { valid: true, errors: [] };
        } else if (error.message.includes('column')) {
            errors.push(`Schema mismatch: ${error.message}`);
        }
    }

    // Clean up test data if it somehow got inserted
    await supabase.from('helmet_prices').delete().eq('helmet_id', -1);

    return { valid: errors.length === 0, errors };
}

module.exports = {
    supabase,
    VALID_SOURCES,
    PRICE_SCHEMA,
    validateSource,
    upsertPrice,
    findHelmet,
    getPriceStats,
    validateSchema
};
