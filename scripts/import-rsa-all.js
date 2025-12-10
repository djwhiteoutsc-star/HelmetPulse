/**
 * RSA (Shop RSA) - Complete Helmet Import
 *
 * Uses Shopify JSON API for fast, reliable data extraction.
 * Collections:
 *   - signed-nfl-mini-helmets
 *   - signed-midi-speedflex-helmets
 *   - signed-nfl-football-helmets
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const CACHE_FILE = path.join(__dirname, 'rsa-cache.json');

// RSA collections to scrape
const COLLECTIONS = [
    { slug: 'signed-nfl-mini-helmets', type: 'mini' },
    { slug: 'signed-midi-speedflex-helmets', type: 'midi' },
    { slug: 'signed-nfl-football-helmets', type: 'fullsize-authentic' }
];

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// NFL Teams for matching
const TEAM_ALIASES = {
    '49ers': ['49ers', 'san francisco', 'niners'],
    'Cardinals': ['cardinals', 'arizona'],
    'Falcons': ['falcons', 'atlanta'],
    'Ravens': ['ravens', 'baltimore'],
    'Bills': ['bills', 'buffalo'],
    'Panthers': ['panthers', 'carolina'],
    'Bears': ['bears', 'chicago'],
    'Bengals': ['bengals', 'cincinnati'],
    'Browns': ['browns', 'cleveland'],
    'Cowboys': ['cowboys', 'dallas'],
    'Broncos': ['broncos', 'denver'],
    'Lions': ['lions', 'detroit'],
    'Packers': ['packers', 'green bay'],
    'Texans': ['texans', 'houston'],
    'Colts': ['colts', 'indianapolis'],
    'Jaguars': ['jaguars', 'jacksonville'],
    'Chiefs': ['chiefs', 'kansas city'],
    'Raiders': ['raiders', 'las vegas', 'oakland'],
    'Chargers': ['chargers', 'la chargers', 'san diego'],
    'Rams': ['rams', 'la rams', 'st louis', 'st. louis'],
    'Dolphins': ['dolphins', 'miami'],
    'Vikings': ['vikings', 'minnesota'],
    'Patriots': ['patriots', 'new england'],
    'Saints': ['saints', 'new orleans'],
    'Giants': ['giants', 'ny giants'],
    'Jets': ['jets', 'ny jets'],
    'Eagles': ['eagles', 'philadelphia'],
    'Steelers': ['steelers', 'pittsburgh'],
    'Seahawks': ['seahawks', 'seattle'],
    'Buccaneers': ['buccaneers', 'tampa bay', 'bucs'],
    'Titans': ['titans', 'tennessee', 'oilers'],
    'Commanders': ['commanders', 'washington', 'redskins'],
};

/**
 * Clean and validate player name
 */
function cleanPlayerName(name) {
    if (!name) return null;

    let cleaned = name
        .replace(/\s+(Autographed|Signed|Auto|Helmet|Full|Size|Mini|Replica|Authentic|Pro|Line|F\/S|Midi|Speedflex)/gi, '')
        .replace(/^\s+|\s+$/g, '')
        .replace(/\s+/g, ' ');

    const parts = cleaned.split(' ').filter(p => p.length > 0);
    if (parts.length < 2) return null;
    if (!/^[A-Z]/.test(parts[0])) return null;

    const badWords = ['helmet', 'autographed', 'signed', 'full', 'size', 'mini', 'replica', 'nfl', 'football', 'midi'];
    if (badWords.some(w => cleaned.toLowerCase().includes(w))) {
        const nameMatch = cleaned.match(/^([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z']+(?:\s+(?:Jr\.|Sr\.|III|II|IV))?)/);
        if (nameMatch) {
            cleaned = nameMatch[1];
        } else {
            return null;
        }
    }

    if (cleaned.length > 50) return null;
    return cleaned;
}

/**
 * Parse helmet title with validation
 */
function parseHelmetTitle(title, defaultType = 'fullsize-authentic') {
    const result = {
        player: null,
        team: null,
        helmetType: defaultType,
        designType: 'regular',
        authCompany: null,
        isValid: false,
        issues: []
    };

    if (!title || title.length < 10) {
        result.issues.push('Title too short');
        return result;
    }

    const titleLower = title.toLowerCase();

    // Skip non-helmet or unsigned products
    if (titleLower.includes('display case') || titleLower.includes('helmet stand') ||
        titleLower.includes('unsigned') || titleLower.includes('un-signed')) {
        result.issues.push('Not signed helmet');
        return result;
    }

    // Parse team
    for (const [teamName, aliases] of Object.entries(TEAM_ALIASES)) {
        for (const alias of aliases) {
            if (titleLower.includes(alias.toLowerCase())) {
                result.team = teamName;
                break;
            }
        }
        if (result.team) break;
    }

    // Parse helmet type (override default if specified in title)
    if (titleLower.includes('mini')) {
        result.helmetType = 'mini';
    } else if (titleLower.includes('midi') || titleLower.includes('mid-size')) {
        result.helmetType = 'midi';
    } else if (titleLower.includes('speedflex')) {
        result.helmetType = 'fullsize-speedflex';
    } else if (titleLower.includes('replica')) {
        result.helmetType = 'fullsize-replica';
    } else if (titleLower.includes('authentic') || titleLower.includes('proline') || titleLower.includes('pro line')) {
        result.helmetType = 'fullsize-authentic';
    }

    // Parse design type
    const designPatterns = [
        [/lunar\s*eclipse/i, 'lunar-eclipse'],
        [/eclipse/i, 'eclipse'],
        [/flash/i, 'flash'],
        [/camo/i, 'camo'],
        [/salute\s*to\s*service|sts/i, 'salute-to-service'],
        [/rave/i, 'rave'],
        [/\bamp\b/i, 'amp'],
        [/slate/i, 'slate'],
        [/flat\s*white/i, 'flat-white'],
        [/chrome/i, 'chrome'],
        [/throwback|\btb\b/i, 'throwback'],
        [/alternate|\balt\b/i, 'alternate'],
        [/rivalries/i, 'rivalries'],
        [/blaze/i, 'blaze'],
    ];

    for (const [pattern, design] of designPatterns) {
        if (pattern.test(title)) {
            result.designType = design;
            break;
        }
    }

    // Parse auth company
    if (/\bJSA\b/.test(title)) result.authCompany = 'JSA';
    else if (/\b(Beckett|BAS)\b/.test(title)) result.authCompany = 'Beckett';
    else if (/\bFanatics\b/i.test(title)) result.authCompany = 'Fanatics';
    else if (/\bPSA\b/.test(title)) result.authCompany = 'PSA/DNA';

    // Extract player name
    let playerName = null;
    let match = title.match(/^([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z']+(?:\s+(?:Jr\.|Sr\.|III|II|IV))?)\s+(?:Autographed|Signed)/i);
    if (match) {
        playerName = match[1];
    }
    if (!playerName) {
        match = title.match(/^([A-Z][a-z]+\s+[A-Z][a-z']+)/);
        if (match) {
            playerName = match[1];
        }
    }

    result.player = cleanPlayerName(playerName);

    if (result.player && result.player.length >= 3) {
        result.isValid = true;
    } else {
        result.issues.push('Could not extract player name');
    }

    return result;
}

/**
 * Validate price
 */
function validatePrice(price) {
    if (typeof price !== 'number') return null;
    if (price <= 0 || price > 50000) return null;
    return Math.round(price * 100) / 100;
}

/**
 * Fetch products from Shopify JSON API
 */
async function fetchCollection(collectionSlug, defaultType) {
    const products = [];
    let page = 1;
    let hasMore = true;

    console.log(`   Fetching ${collectionSlug}...`);

    while (hasMore && page <= 20) {
        try {
            const url = `https://www.shoprsa.com/collections/${collectionSlug}/products.json?limit=250&page=${page}`;
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json'
                },
                timeout: 30000
            });

            const data = response.data.products || [];

            if (data.length === 0) {
                hasMore = false;
            } else {
                for (const product of data) {
                    const title = product.title || '';
                    const price = parseFloat(product.variants?.[0]?.price) || 0;
                    const productType = product.product_type || '';

                    // Only include helmet products
                    if (title.toLowerCase().includes('helmet') || productType.toLowerCase().includes('helmet')) {
                        products.push({
                            title,
                            price,
                            defaultType,
                            url: `https://www.shoprsa.com/products/${product.handle}`
                        });
                    }
                }
                console.log(`      Page ${page}: ${data.length} products (${products.length} helmets total)`);
                page++;
            }

            await sleep(500);
        } catch (error) {
            console.log(`      Error on page ${page}: ${error.message}`);
            hasMore = false;
        }
    }

    return products;
}

/**
 * Main function
 */
async function main() {
    console.log('═'.repeat(60));
    console.log('  RSA (SHOP RSA) - HELMET IMPORT');
    console.log('═'.repeat(60));
    console.log('  Using Shopify JSON API for fast extraction');
    console.log('═'.repeat(60) + '\n');

    let allProducts = [];

    // Check for cached data
    if (fs.existsSync(CACHE_FILE)) {
        console.log('📁 Found cached data from previous fetch...');
        const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        console.log(`   ${cached.length} products in cache`);

        const useCache = process.argv.includes('--use-cache');
        if (useCache) {
            console.log('   Using cached data (--use-cache flag)\n');
            allProducts = cached;
        } else {
            console.log('   Re-fetching (use --use-cache to skip)\n');
        }
    }

    // Fetch if needed
    if (allProducts.length === 0) {
        console.log('🌐 Fetching from Shopify API...\n');

        for (const collection of COLLECTIONS) {
            const products = await fetchCollection(collection.slug, collection.type);
            allProducts.push(...products);
            await sleep(1000);
        }

        // Also fetch from main products endpoint
        console.log('   Fetching all products...');
        let page = 1;
        let hasMore = true;
        while (hasMore && page <= 20) {
            try {
                const url = `https://www.shoprsa.com/products.json?limit=250&page=${page}`;
                const response = await axios.get(url, {
                    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
                    timeout: 30000
                });
                const data = response.data.products || [];
                if (data.length === 0) {
                    hasMore = false;
                } else {
                    for (const product of data) {
                        const title = product.title || '';
                        if (title.toLowerCase().includes('helmet')) {
                            // Check if not already added
                            if (!allProducts.find(p => p.title === title)) {
                                allProducts.push({
                                    title,
                                    price: parseFloat(product.variants?.[0]?.price) || 0,
                                    defaultType: 'fullsize-authentic',
                                    url: `https://www.shoprsa.com/products/${product.handle}`
                                });
                            }
                        }
                    }
                    console.log(`      Page ${page}: ${data.length} products`);
                    page++;
                }
                await sleep(500);
            } catch (error) {
                hasMore = false;
            }
        }

        // Cache the results
        fs.writeFileSync(CACHE_FILE, JSON.stringify(allProducts, null, 2));
        console.log(`\n💾 Cached ${allProducts.length} products to ${CACHE_FILE}`);
    }

    console.log('\n' + '─'.repeat(60));
    console.log(`📊 FETCHED: ${allProducts.length} total products`);
    console.log('─'.repeat(60));

    if (allProducts.length === 0) {
        console.log('⚠️  No products found.');
        return;
    }

    // ============ DATA VALIDATION ============
    console.log('\n🔍 VALIDATING DATA...\n');

    const validated = [];
    const rejected = { noPlayer: 0, notHelmet: 0, duplicate: 0, other: 0 };
    const seen = new Set();

    for (const product of allProducts) {
        const parsed = parseHelmetTitle(product.title, product.defaultType);
        const price = validatePrice(product.price);

        if (!parsed.isValid) {
            if (parsed.issues.includes('Not signed helmet')) {
                rejected.notHelmet++;
            } else if (parsed.issues.includes('Could not extract player name')) {
                rejected.noPlayer++;
            } else {
                rejected.other++;
            }
            continue;
        }

        const key = `${parsed.player}|${parsed.team}|${parsed.helmetType}|${parsed.designType}`.toLowerCase();
        if (seen.has(key)) {
            rejected.duplicate++;
            continue;
        }
        seen.add(key);

        validated.push({
            title: product.title.substring(0, 250),
            player: parsed.player,
            team: parsed.team,
            helmetType: parsed.helmetType,
            designType: parsed.designType,
            authCompany: parsed.authCompany,
            price: price,
            url: product.url
        });
    }

    console.log('   Validation Results:');
    console.log(`   ✓ Valid helmets:     ${validated.length}`);
    console.log(`   ✗ No player name:    ${rejected.noPlayer}`);
    console.log(`   ✗ Not signed helmet: ${rejected.notHelmet}`);
    console.log(`   ✗ Duplicates:        ${rejected.duplicate}`);
    console.log(`   ✗ Other issues:      ${rejected.other}`);

    // Show sample
    console.log('\n📋 SAMPLE VALIDATED DATA:\n');
    validated.slice(0, 10).forEach((h, i) => {
        console.log(`   ${i + 1}. ${h.player} - ${h.team || 'Unknown'}`);
        console.log(`      Type: ${h.helmetType}, Design: ${h.designType}, Price: $${h.price || 'N/A'}`);
    });

    // Team distribution
    const teamCounts = {};
    validated.forEach(h => {
        const team = h.team || 'Unknown';
        teamCounts[team] = (teamCounts[team] || 0) + 1;
    });

    console.log('\n📊 TEAM DISTRIBUTION (top 10):');
    Object.entries(teamCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .forEach(([team, count]) => {
            console.log(`   ${team}: ${count}`);
        });

    // Helmet type distribution
    const typeCounts = {};
    validated.forEach(h => {
        typeCounts[h.helmetType] = (typeCounts[h.helmetType] || 0) + 1;
    });

    console.log('\n📊 HELMET TYPE DISTRIBUTION:');
    Object.entries(typeCounts)
        .sort((a, b) => b[1] - a[1])
        .forEach(([type, count]) => {
            console.log(`   ${type}: ${count}`);
        });

    // ============ DATABASE IMPORT ============
    console.log('\n' + '═'.repeat(60));
    console.log('  IMPORTING TO DATABASE');
    console.log('═'.repeat(60) + '\n');

    // Get existing helmets (fetch ALL, not limited to 1000)
    console.log('📥 Loading existing helmets...');
    let existingHelmets = [];
    let page = 0;
    const PAGE_SIZE = 1000;

    while (true) {
        const { data, error } = await supabase
            .from('helmets')
            .select('id, player, team, helmet_type, design_type, ebay_search_query')
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

        if (error || !data || data.length === 0) break;
        existingHelmets.push(...data);
        if (data.length < PAGE_SIZE) break;
        page++;
    }

    const existingMap = new Map();
    const ebayQuerySet = new Set();
    existingHelmets.forEach(h => {
        const key = `${h.player}|${h.team}|${h.helmet_type}|${h.design_type}`.toLowerCase();
        existingMap.set(key, h.id);
        if (h.ebay_search_query) ebayQuerySet.add(h.ebay_search_query.toLowerCase());
    });

    console.log(`   Found ${existingMap.size} existing helmets, ${ebayQuerySet.size} search queries\n`);

    let added = 0;
    let pricesUpdated = 0;
    let skipped = 0;
    let errors = 0;

    const BATCH_SIZE = 50;
    const newHelmets = [];
    const priceUpdates = [];

    for (const helmet of validated) {
        const key = `${helmet.player}|${helmet.team}|${helmet.helmetType}|${helmet.designType}`.toLowerCase();
        const ebayQuery = `${helmet.player} ${helmet.team || ''} ${helmet.helmetType} ${helmet.designType} autographed helmet`
            .toLowerCase().replace(/\s+/g, ' ').trim();

        if (existingMap.has(key) || ebayQuerySet.has(ebayQuery)) {
            const helmetId = existingMap.get(key);
            if (helmet.price && helmetId) {
                priceUpdates.push({
                    helmet_id: helmetId,
                    price: helmet.price
                });
            }
            skipped++;
        } else {
            ebayQuerySet.add(ebayQuery);
            newHelmets.push({
                name: helmet.title,
                player: helmet.player,
                team: helmet.team,
                helmet_type: helmet.helmetType,
                design_type: helmet.designType,
                auth_company: helmet.authCompany,
                ebay_search_query: ebayQuery,
                is_active: true,
                price: helmet.price
            });
        }
    }

    console.log(`📝 New helmets to add: ${newHelmets.length}`);
    console.log(`💰 Price updates for existing: ${priceUpdates.length}\n`);

    // Insert new helmets in batches
    if (newHelmets.length > 0) {
        console.log('➕ Adding new helmets...');

        for (let i = 0; i < newHelmets.length; i += BATCH_SIZE) {
            const batch = newHelmets.slice(i, i + BATCH_SIZE);
            const insertData = batch.map(h => ({
                name: h.name,
                player: h.player,
                team: h.team,
                helmet_type: h.helmet_type,
                design_type: h.design_type,
                auth_company: h.auth_company,
                ebay_search_query: h.ebay_search_query,
                is_active: h.is_active
            }));

            const { data: inserted, error } = await supabase
                .from('helmets')
                .insert(insertData)
                .select('id');

            if (error) {
                console.log(`   ✗ Batch error: ${error.message}`);
                errors += batch.length;
            } else {
                added += inserted.length;

                // Add prices for new helmets
                const priceInserts = [];
                inserted.forEach((h, idx) => {
                    if (batch[idx].price) {
                        priceInserts.push({
                            helmet_id: h.id,
                            source: 'rsa',
                            median_price: batch[idx].price,
                            min_price: batch[idx].price,
                            max_price: batch[idx].price,
                            total_results: 1,
                            scraped_at: new Date().toISOString()
                        });
                    }
                });

                if (priceInserts.length > 0) {
                    await supabase.from('helmet_prices').insert(priceInserts);
                    pricesUpdated += priceInserts.length;
                }

                process.stdout.write(`   ✓ Added ${added}/${newHelmets.length}\r`);
            }
        }
        console.log(`\n   ✓ Added ${added} new helmets`);
    }

    // Update prices for existing helmets
    if (priceUpdates.length > 0) {
        console.log('\n💰 Updating prices for existing helmets...');

        for (let i = 0; i < priceUpdates.length; i += BATCH_SIZE) {
            const batch = priceUpdates.slice(i, i + BATCH_SIZE);

            for (const update of batch) {
                const { data: existing } = await supabase
                    .from('helmet_prices')
                    .select('id')
                    .eq('helmet_id', update.helmet_id)
                    .eq('source', 'rsa')
                    .limit(1);

                if (existing && existing.length > 0) {
                    await supabase
                        .from('helmet_prices')
                        .update({
                            median_price: update.price,
                            min_price: update.price,
                            max_price: update.price,
                            scraped_at: new Date().toISOString()
                        })
                        .eq('id', existing[0].id);
                } else {
                    await supabase.from('helmet_prices').insert({
                        helmet_id: update.helmet_id,
                        source: 'rsa',
                        median_price: update.price,
                        min_price: update.price,
                        max_price: update.price,
                        total_results: 1,
                        scraped_at: new Date().toISOString()
                    });
                }
                pricesUpdated++;
            }
            process.stdout.write(`   ✓ Updated ${Math.min(i + BATCH_SIZE, priceUpdates.length)}/${priceUpdates.length}\r`);
        }
        console.log('');
    }

    // Final summary
    console.log('\n' + '═'.repeat(60));
    console.log('  IMPORT COMPLETE');
    console.log('═'.repeat(60));
    console.log(`  Products fetched:     ${allProducts.length}`);
    console.log(`  Valid after cleanup:  ${validated.length}`);
    console.log(`  ─────────────────────────────────────────`);
    console.log(`  New helmets added:    ${added}`);
    console.log(`  Existing (skipped):   ${skipped}`);
    console.log(`  Prices added/updated: ${pricesUpdated}`);
    console.log(`  Errors:               ${errors}`);
    console.log('═'.repeat(60));

    // Final counts
    const { count: totalHelmets } = await supabase.from('helmets').select('*', { count: 'exact', head: true });
    const { count: rsaPrices } = await supabase.from('helmet_prices').select('*', { count: 'exact', head: true }).eq('source', 'rsa');

    console.log(`\n  📊 Database totals:`);
    console.log(`     Total helmets: ${totalHelmets}`);
    console.log(`     RSA prices: ${rsaPrices}`);
    console.log('═'.repeat(60) + '\n');
}

main()
    .then(() => { console.log('🎉 Done!\n'); process.exit(0); })
    .catch(error => { console.error('❌ Fatal:', error); process.exit(1); });
