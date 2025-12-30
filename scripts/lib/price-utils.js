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
const VALID_SOURCES = ['ebay', 'fanatics', 'rsa', 'radtke', 'pristine', 'signaturesports', 'greatsports'];

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
 * Extract team name from helmet name/description
 * Used to auto-populate team field when not provided
 *
 * @param {string} name - Helmet name or description
 * @returns {string|null} - Extracted team name or null if not found
 */
function extractTeamFromName(name) {
    if (!name) return null;

    // Team extraction patterns (order matters - more specific patterns first)
    const teamPatterns = [
        // College Teams (check first as they're more specific)
        { pattern: /georgia bulldogs/i, team: 'Georgia Bulldogs' },
        { pattern: /colorado buffaloes/i, team: 'Colorado Buffaloes' },
        { pattern: /alabama crimson tide/i, team: 'Alabama Crimson Tide' },
        { pattern: /ohio state buckeyes/i, team: 'Ohio State Buckeyes' },
        { pattern: /michigan wolverines/i, team: 'Michigan Wolverines' },
        { pattern: /michigan state spartans/i, team: 'Michigan State Spartans' },
        { pattern: /lsu tigers/i, team: 'LSU Tigers' },
        { pattern: /clemson tigers/i, team: 'Clemson Tigers' },
        { pattern: /auburn tigers/i, team: 'Auburn Tigers' },
        { pattern: /notre dame fighting irish/i, team: 'Notre Dame Fighting Irish' },
        { pattern: /notre dame/i, team: 'Notre Dame Fighting Irish' },
        { pattern: /florida gators/i, team: 'Florida Gators' },
        { pattern: /texas longhorns/i, team: 'Texas Longhorns' },
        { pattern: /texas a&m aggies/i, team: 'Texas A&M Aggies' },
        { pattern: /texas a&m/i, team: 'Texas A&M Aggies' },
        { pattern: /oklahoma sooners/i, team: 'Oklahoma Sooners' },
        { pattern: /usc trojans/i, team: 'USC Trojans' },
        { pattern: /miami hurricanes/i, team: 'Miami Hurricanes' },
        { pattern: /nebraska cornhuskers/i, team: 'Nebraska Cornhuskers' },
        { pattern: /wisconsin badgers/i, team: 'Wisconsin Badgers' },
        { pattern: /oregon ducks/i, team: 'Oregon Ducks' },
        { pattern: /washington huskies/i, team: 'Washington Huskies' },
        { pattern: /iowa hawkeyes/i, team: 'Iowa Hawkeyes' },
        { pattern: /penn state/i, team: 'Penn State Nittany Lions' },
        { pattern: /tennessee volunteers/i, team: 'Tennessee Volunteers' },
        { pattern: /florida state seminoles/i, team: 'Florida State Seminoles' },
        { pattern: /purdue boilermakers/i, team: 'Purdue Boilermakers' },
        { pattern: /virginia tech hokies/i, team: 'Virginia Tech Hokies' },
        { pattern: /ole miss rebels/i, team: 'Ole Miss Rebels' },
        { pattern: /ole miss/i, team: 'Ole Miss Rebels' },
        { pattern: /arizona state sun devils/i, team: 'Arizona State Sun Devils' },
        { pattern: /arizona state/i, team: 'Arizona State Sun Devils' },
        { pattern: /utah utes/i, team: 'Utah Utes' },
        { pattern: /north dakota state bison/i, team: 'North Dakota State Bison' },
        { pattern: /north dakota state/i, team: 'North Dakota State Bison' },
        { pattern: /navy midshipmen/i, team: 'Navy Midshipmen' },
        { pattern: /stanford/i, team: 'Stanford Cardinal' },
        { pattern: /tn vols/i, team: 'Tennessee Volunteers' },

        // NFL Teams
        { pattern: /houston oilers/i, team: 'Houston Oilers' },
        { pattern: /washington redskins/i, team: 'Commanders' },
        { pattern: /las vegas raiders/i, team: 'Raiders' },
        { pattern: /49ers/i, team: '49ers' },
        { pattern: /bears/i, team: 'Bears' },
        { pattern: /bengals/i, team: 'Bengals' },
        { pattern: /bills/i, team: 'Bills' },
        { pattern: /broncos/i, team: 'Broncos' },
        { pattern: /browns/i, team: 'Browns' },
        { pattern: /buccaneers/i, team: 'Buccaneers' },
        { pattern: /cardinals/i, team: 'Cardinals' },
        { pattern: /chargers/i, team: 'Chargers' },
        { pattern: /chiefs/i, team: 'Chiefs' },
        { pattern: /colts/i, team: 'Colts' },
        { pattern: /commanders/i, team: 'Commanders' },
        { pattern: /cowboys/i, team: 'Cowboys' },
        { pattern: /dolphins/i, team: 'Dolphins' },
        { pattern: /eagles/i, team: 'Eagles' },
        { pattern: /falcons/i, team: 'Falcons' },
        { pattern: /giants/i, team: 'Giants' },
        { pattern: /jaguars/i, team: 'Jaguars' },
        { pattern: /jets/i, team: 'Jets' },
        { pattern: /lions/i, team: 'Lions' },
        { pattern: /packers/i, team: 'Packers' },
        { pattern: /panthers/i, team: 'Panthers' },
        { pattern: /patriots/i, team: 'Patriots' },
        { pattern: /raiders/i, team: 'Raiders' },
        { pattern: /rams/i, team: 'Rams' },
        { pattern: /ravens/i, team: 'Ravens' },
        { pattern: /saints/i, team: 'Saints' },
        { pattern: /seahawks/i, team: 'Seahawks' },
        { pattern: /steelers/i, team: 'Steelers' },
        { pattern: /texans/i, team: 'Texans' },
        { pattern: /titans/i, team: 'Titans' },
        { pattern: /vikings/i, team: 'Vikings' },

        // NHL Teams
        { pattern: /new york rangers/i, team: 'NY Rangers (NHL)' },
        { pattern: /rangers/i, team: 'NY Rangers (NHL)' },
        { pattern: /toronto maple leafs/i, team: 'Toronto Maple Leafs (NHL)' },
        { pattern: /maple leafs/i, team: 'Toronto Maple Leafs (NHL)' },
        { pattern: /montreal canadiens/i, team: 'Montreal Canadiens (NHL)' },
        { pattern: /canadiens/i, team: 'Montreal Canadiens (NHL)' },
        { pattern: /vancouver canucks/i, team: 'Vancouver Canucks (NHL)' },
        { pattern: /canucks/i, team: 'Vancouver Canucks (NHL)' },
        { pattern: /edmonton oilers/i, team: 'Edmonton Oilers (NHL)' },
        { pattern: /colorado avalanche/i, team: 'Colorado Avalanche (NHL)' },
        { pattern: /avalanche/i, team: 'Colorado Avalanche (NHL)' },
        { pattern: /washington capitals/i, team: 'Washington Capitals (NHL)' },
        { pattern: /capitals/i, team: 'Washington Capitals (NHL)' },
        { pattern: /carolina hurricanes/i, team: 'Carolina Hurricanes (NHL)' },
        { pattern: /new jersey devils/i, team: 'New Jersey Devils (NHL)' },
        { pattern: /devils/i, team: 'New Jersey Devils (NHL)' },
        { pattern: /calgary flames/i, team: 'Calgary Flames (NHL)' },
        { pattern: /flames/i, team: 'Calgary Flames (NHL)' },
        { pattern: /seattle kraken/i, team: 'Seattle Kraken (NHL)' },
        { pattern: /kraken/i, team: 'Seattle Kraken (NHL)' },
        { pattern: /nashville predators/i, team: 'Nashville Predators (NHL)' },
        { pattern: /predators/i, team: 'Nashville Predators (NHL)' },
        { pattern: /new york islanders/i, team: 'NY Islanders (NHL)' },
        { pattern: /islanders/i, team: 'NY Islanders (NHL)' },
        { pattern: /minnesota wild/i, team: 'Minnesota Wild (NHL)' },
        { pattern: /buffalo sabres/i, team: 'Buffalo Sabres (NHL)' },
        { pattern: /sabres/i, team: 'Buffalo Sabres (NHL)' },
        { pattern: /columbus blue jackets/i, team: 'Columbus Blue Jackets (NHL)' },
        { pattern: /blue jackets/i, team: 'Columbus Blue Jackets (NHL)' },
        { pattern: /anaheim ducks/i, team: 'Anaheim Ducks (NHL)' },
        { pattern: /los angeles kings/i, team: 'LA Kings (NHL)' },
        { pattern: /vegas golden knights/i, team: 'Vegas Golden Knights (NHL)' },
        { pattern: /golden knights/i, team: 'Vegas Golden Knights (NHL)' },
        { pattern: /tampa bay lightning/i, team: 'Tampa Bay Lightning (NHL)' },
        { pattern: /lightning/i, team: 'Tampa Bay Lightning (NHL)' },

        // MLB Teams
        { pattern: /new york yankees/i, team: 'NY Yankees (MLB)' },
        { pattern: /yankees/i, team: 'NY Yankees (MLB)' },
        { pattern: /new york mets/i, team: 'NY Mets (MLB)' },
        { pattern: /mets/i, team: 'NY Mets (MLB)' },
        { pattern: /boston red sox/i, team: 'Boston Red Sox (MLB)' },
        { pattern: /red sox/i, team: 'Boston Red Sox (MLB)' },
        { pattern: /chicago cubs/i, team: 'Chicago Cubs (MLB)' },
        { pattern: /cubs/i, team: 'Chicago Cubs (MLB)' },
        { pattern: /cincinnati reds/i, team: 'Cincinnati Reds (MLB)' },
        { pattern: /reds/i, team: 'Cincinnati Reds (MLB)' },
        { pattern: /seattle mariners/i, team: 'Seattle Mariners (MLB)' },
        { pattern: /mariners/i, team: 'Seattle Mariners (MLB)' },
        { pattern: /san diego padres/i, team: 'San Diego Padres (MLB)' },
        { pattern: /padres/i, team: 'San Diego Padres (MLB)' },
        { pattern: /los angeles angels/i, team: 'LA Angels (MLB)' },
        { pattern: /angels/i, team: 'LA Angels (MLB)' },
        { pattern: /milwaukee brewers/i, team: 'Milwaukee Brewers (MLB)' },
        { pattern: /brewers/i, team: 'Milwaukee Brewers (MLB)' },
        { pattern: /colorado rockies/i, team: 'Colorado Rockies (MLB)' },
        { pattern: /rockies/i, team: 'Colorado Rockies (MLB)' },
        { pattern: /texas rangers/i, team: 'Texas Rangers (MLB)' },
        { pattern: /washington senators/i, team: 'Washington Senators (MLB)' },
        { pattern: /senators/i, team: 'Washington Senators (MLB)' },

        // Catch-all patterns (less specific)
        { pattern: /bulldogs/i, team: 'Georgia Bulldogs' },
        { pattern: /buffaloes/i, team: 'Colorado Buffaloes' },
        { pattern: /buckeyes/i, team: 'Ohio State Buckeyes' },
        { pattern: /wolverines/i, team: 'Michigan Wolverines' },
        { pattern: /spartans/i, team: 'Michigan State Spartans' },
        { pattern: /gators/i, team: 'Florida Gators' },
        { pattern: /longhorns/i, team: 'Texas Longhorns' },
        { pattern: /aggies/i, team: 'Texas A&M Aggies' },
        { pattern: /sooners/i, team: 'Oklahoma Sooners' },
        { pattern: /trojans/i, team: 'USC Trojans' },
        { pattern: /cornhuskers/i, team: 'Nebraska Cornhuskers' },
        { pattern: /badgers/i, team: 'Wisconsin Badgers' },
        { pattern: /hawkeyes/i, team: 'Iowa Hawkeyes' },
        { pattern: /seminoles/i, team: 'Florida State Seminoles' },
        { pattern: /hokies/i, team: 'Virginia Tech Hokies' },
        { pattern: /rebels/i, team: 'Ole Miss Rebels' },
        { pattern: /sun devils/i, team: 'Arizona State Sun Devils' },
    ];

    for (const { pattern, team } of teamPatterns) {
        if (pattern.test(name)) {
            return team;
        }
    }
    return null;
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
    validateSchema,
    extractTeamFromName
};
