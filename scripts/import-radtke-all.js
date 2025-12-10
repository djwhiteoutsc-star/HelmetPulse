/**
 * Radtke Sports - Complete Helmet Import (Optimized)
 *
 * Scrapes ALL helmets from Radtke Sports, validates data, then batch imports.
 * URL: https://www.radtkesports.com/?s=helmet&product_cat=0&post_type=product
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const BASE_URL = 'https://www.radtkesports.com/?s=helmet&product_cat=0&post_type=product';
const CACHE_FILE = path.join(__dirname, 'radtke-cache.json');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// NFL Teams for matching
const NFL_TEAMS = [
    'Cardinals', 'Falcons', 'Ravens', 'Bills', 'Panthers', 'Bears', 'Bengals', 'Browns',
    'Cowboys', '49ers', 'Giants', 'Jaguars', 'Chiefs', 'Raiders', 'Chargers', 'Rams',
    'Dolphins', 'Vikings', 'Patriots', 'Saints', 'Jets', 'Eagles', 'Steelers', 'Seahawks',
    'Buccaneers', 'Titans', 'Commanders', 'Packers', 'Lions', 'Texans', 'Colts', 'Broncos'
];

// Team name variations
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

// Valid helmet types
const HELMET_TYPES = ['mini', 'midi', 'fullsize-authentic', 'fullsize-replica', 'fullsize-speedflex'];

// Valid design types
const DESIGN_TYPES = ['regular', 'lunar-eclipse', 'eclipse', 'flash', 'camo', 'salute-to-service',
    'rave', 'amp', 'slate', 'flat-white', 'chrome', 'throwback', 'alternate', 'rivalries', 'blaze'];

/**
 * Clean and validate player name
 */
function cleanPlayerName(name) {
    if (!name) return null;

    // Remove common suffixes/prefixes that aren't part of name
    let cleaned = name
        .replace(/\s+(Autographed|Signed|Auto|Helmet|Full|Size|Mini|Replica|Authentic|Pro|Line|F\/S)/gi, '')
        .replace(/^\s+|\s+$/g, '')
        .replace(/\s+/g, ' ');

    // Validate it looks like a name (2+ words, starts with capital)
    const parts = cleaned.split(' ').filter(p => p.length > 0);
    if (parts.length < 2) return null;
    if (!/^[A-Z]/.test(parts[0])) return null;

    // Reject if it's just team/product words
    const badWords = ['helmet', 'autographed', 'signed', 'full', 'size', 'mini', 'replica', 'nfl', 'football'];
    if (badWords.some(w => cleaned.toLowerCase().includes(w))) {
        // Try to extract just the name portion
        const nameMatch = cleaned.match(/^([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z']+(?:\s+(?:Jr\.|Sr\.|III|II|IV))?)/);
        if (nameMatch) {
            cleaned = nameMatch[1];
        } else {
            return null;
        }
    }

    // Max reasonable name length
    if (cleaned.length > 50) return null;

    return cleaned;
}

/**
 * Parse helmet title with validation
 */
function parseHelmetTitle(title) {
    const result = {
        player: null,
        team: null,
        helmetType: 'fullsize-authentic',
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

    // Skip non-helmet products
    if (!titleLower.includes('helmet')) {
        result.issues.push('Not a helmet');
        return result;
    }

    // Skip display cases, stands, etc.
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

    // Parse helmet type
    if (titleLower.includes('mini')) {
        result.helmetType = 'mini';
    } else if (titleLower.includes('midi') || titleLower.includes('mid-size')) {
        result.helmetType = 'midi';
    } else if (titleLower.includes('speedflex')) {
        result.helmetType = 'fullsize-speedflex';
    } else if (titleLower.includes('replica')) {
        result.helmetType = 'fullsize-replica';
    } else if (titleLower.includes('authentic') || titleLower.includes('proline') ||
               titleLower.includes('pro line') || titleLower.includes('f/s')) {
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

    // Extract player name - multiple strategies
    let playerName = null;

    // Strategy 1: Name at beginning before "Autographed/Signed"
    let match = title.match(/^([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z']+(?:\s+(?:Jr\.|Sr\.|III|II|IV))?)\s+(?:Autographed|Signed)/i);
    if (match) {
        playerName = match[1];
    }

    // Strategy 2: Name at beginning (first two capitalized words)
    if (!playerName) {
        match = title.match(/^([A-Z][a-z]+\s+[A-Z][a-z']+)/);
        if (match) {
            playerName = match[1];
        }
    }

    // Strategy 3: Look for "by [Name]" pattern
    if (!playerName) {
        match = title.match(/(?:signed|autographed)\s+by\s+([A-Z][a-z]+\s+[A-Z][a-z']+)/i);
        if (match) {
            playerName = match[1];
        }
    }

    result.player = cleanPlayerName(playerName);

    // Validate result
    if (result.player && result.player.length >= 3) {
        result.isValid = true;
    } else {
        result.issues.push('Could not extract player name');
    }

    if (!result.team) {
        result.issues.push('Could not identify team');
    }

    return result;
}

/**
 * Validate price
 */
function validatePrice(price) {
    if (typeof price !== 'number') return null;
    if (price <= 0 || price > 50000) return null; // Reasonable helmet price range
    return Math.round(price * 100) / 100; // Round to 2 decimals
}

/**
 * Scrape a single page
 */
async function scrapePage(page, pageNum) {
    const url = pageNum === 1
        ? BASE_URL
        : `https://www.radtkesports.com/page/${pageNum}/?s=helmet&product_cat=0&post_type=product`;

    process.stdout.write(`   Page ${pageNum}...`);

    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        await sleep(1500);

        const pageContent = await page.content();
        if (pageContent.includes('No products were found') || pageContent.includes('Page not found')) {
            console.log(' END');
            return { products: [], hasMore: false };
        }

        const products = await page.evaluate(() => {
            const results = [];
            const productElements = document.querySelectorAll('li.product, .product-item, .products .product');

            productElements.forEach(prod => {
                try {
                    let title = '';
                    const titleSelectors = ['.woocommerce-loop-product__title', '.product-title', 'h2', '.item-title', 'h3'];
                    for (const sel of titleSelectors) {
                        const el = prod.querySelector(sel);
                        if (el && el.textContent.trim()) {
                            title = el.textContent.trim();
                            break;
                        }
                    }

                    let price = 0;
                    const priceEl = prod.querySelector('.price, .woocommerce-Price-amount');
                    if (priceEl) {
                        const insPrice = priceEl.querySelector('ins .woocommerce-Price-amount');
                        const regularPrice = insPrice || priceEl.querySelector('.woocommerce-Price-amount') || priceEl;
                        const priceText = regularPrice.textContent || '';
                        const priceMatch = priceText.match(/[\d,]+\.?\d*/);
                        if (priceMatch) {
                            price = parseFloat(priceMatch[0].replace(/,/g, '')) || 0;
                        }
                    }

                    let productUrl = '';
                    const linkEl = prod.querySelector('a[href*="/product/"]');
                    if (linkEl) {
                        productUrl = linkEl.getAttribute('href') || '';
                    }

                    if (title && title.length > 10) {
                        results.push({ title, price, url: productUrl });
                    }
                } catch (e) {}
            });
            return results;
        });

        const hasMore = await page.evaluate(() => {
            return document.querySelector('.next.page-numbers, a.next') !== null;
        });

        console.log(` ${products.length} products`);
        return { products, hasMore };

    } catch (error) {
        console.log(` ERROR: ${error.message.substring(0, 30)}`);
        return { products: [], hasMore: false };
    }
}

/**
 * Main function
 */
async function main() {
    console.log('═'.repeat(60));
    console.log('  RADTKE SPORTS - HELMET IMPORT (OPTIMIZED)');
    console.log('═'.repeat(60));

    let allProducts = [];

    // Check for cached data
    if (fs.existsSync(CACHE_FILE)) {
        console.log('\n📁 Found cached data from previous scrape...');
        const cached = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        console.log(`   ${cached.length} products in cache`);

        const useCache = process.argv.includes('--use-cache');
        if (useCache) {
            console.log('   Using cached data (--use-cache flag)\n');
            allProducts = cached;
        } else {
            console.log('   Re-scraping (use --use-cache to skip)\n');
        }
    }

    // Scrape if needed
    if (allProducts.length === 0) {
        console.log('🌐 Launching browser...\n');
        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        await page.setViewport({ width: 1920, height: 1080 });

        console.log('📦 Scraping Radtke search results...\n');

        let pageNum = 1;
        let hasMore = true;

        while (hasMore && pageNum <= 100) {
            const result = await scrapePage(page, pageNum);
            if (result.products.length > 0) {
                allProducts.push(...result.products);
            }
            hasMore = result.hasMore && result.products.length > 0;
            pageNum++;
            await sleep(1000);
        }

        await browser.close();

        // Cache the results
        fs.writeFileSync(CACHE_FILE, JSON.stringify(allProducts, null, 2));
        console.log(`\n💾 Cached ${allProducts.length} products to ${CACHE_FILE}`);
    }

    console.log('\n' + '─'.repeat(60));
    console.log(`📊 SCRAPED: ${allProducts.length} total products`);
    console.log('─'.repeat(60));

    // ============ DATA VALIDATION ============
    console.log('\n🔍 VALIDATING DATA...\n');

    const validated = [];
    const rejected = { noPlayer: 0, notHelmet: 0, duplicate: 0, other: 0 };
    const seen = new Set();

    for (const product of allProducts) {
        const parsed = parseHelmetTitle(product.title);
        const price = validatePrice(product.price);

        if (!parsed.isValid) {
            if (parsed.issues.includes('Not a helmet') || parsed.issues.includes('Not signed helmet')) {
                rejected.notHelmet++;
            } else if (parsed.issues.includes('Could not extract player name')) {
                rejected.noPlayer++;
            } else {
                rejected.other++;
            }
            continue;
        }

        // Create unique key for deduplication
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

    // Show sample of validated data
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
    let dbPage = 0;
    const PAGE_SIZE = 1000;

    while (true) {
        const { data, error } = await supabase
            .from('helmets')
            .select('id, player, team, helmet_type, design_type, ebay_search_query')
            .range(dbPage * PAGE_SIZE, (dbPage + 1) * PAGE_SIZE - 1);

        if (error || !data || data.length === 0) break;
        existingHelmets.push(...data);
        if (data.length < PAGE_SIZE) break;
        dbPage++;
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

    // Process in batches of 50
    const BATCH_SIZE = 50;
    const newHelmets = [];
    const priceUpdates = [];

    for (const helmet of validated) {
        const key = `${helmet.player}|${helmet.team}|${helmet.helmetType}|${helmet.designType}`.toLowerCase();

        // Generate unique ebay_search_query including type and design
        const ebayQuery = `${helmet.player} ${helmet.team || ''} ${helmet.helmetType} ${helmet.designType} autographed helmet`
            .toLowerCase().replace(/\s+/g, ' ').trim();

        if (existingMap.has(key) || ebayQuerySet.has(ebayQuery)) {
            // Existing helmet - queue price update
            const helmetId = existingMap.get(key);
            if (helmet.price && helmetId) {
                priceUpdates.push({
                    helmet_id: helmetId,
                    price: helmet.price
                });
            }
            skipped++;
        } else {
            // New helmet - track the query to avoid duplicates within this batch
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
                price: helmet.price // Temporary, for price insert
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
                            source: 'radtke',
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
                // Upsert price
                const { data: existing } = await supabase
                    .from('helmet_prices')
                    .select('id')
                    .eq('helmet_id', update.helmet_id)
                    .eq('source', 'radtke')
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
                        source: 'radtke',
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
    console.log(`  Products scraped:     ${allProducts.length}`);
    console.log(`  Valid after cleanup:  ${validated.length}`);
    console.log(`  ─────────────────────────────────────────`);
    console.log(`  New helmets added:    ${added}`);
    console.log(`  Existing (skipped):   ${skipped}`);
    console.log(`  Prices added/updated: ${pricesUpdated}`);
    console.log(`  Errors:               ${errors}`);
    console.log('═'.repeat(60));

    // Final counts
    const { count: totalHelmets } = await supabase.from('helmets').select('*', { count: 'exact', head: true });
    const { count: radtkePrices } = await supabase.from('helmet_prices').select('*', { count: 'exact', head: true }).eq('source', 'radtke');

    console.log(`\n  📊 Database totals:`);
    console.log(`     Total helmets: ${totalHelmets}`);
    console.log(`     Radtke prices: ${radtkePrices}`);
    console.log('═'.repeat(60) + '\n');
}

main()
    .then(() => { console.log('🎉 Done!\n'); process.exit(0); })
    .catch(error => { console.error('❌ Fatal:', error); process.exit(1); });
