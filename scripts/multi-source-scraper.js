const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const NFL_TEAMS = [
    'Cardinals', 'Falcons', 'Ravens', 'Bills', 'Panthers', 'Bears', 'Bengals', 'Browns',
    'Cowboys', '49ers', 'Giants', 'Jaguars', 'Chiefs', 'Raiders', 'Chargers', 'Rams',
    'Dolphins', 'Vikings', 'Patriots', 'Saints', 'Jets', 'Eagles', 'Steelers', 'Seahawks',
    'Buccaneers', 'Titans', 'Commanders', 'Packers', 'Lions', 'Texans', 'Colts', 'Broncos'
];

// Team URL slugs for Radtke
const RADTKE_TEAMS = [
    'arizona-cardinals', 'atlanta-falcons', 'baltimore-ravens', 'buffalo-bills',
    'carolina-panthers', 'chicago-bears', 'cincinnati-bengals', 'cleveland-browns',
    'dallas-cowboys', 'denver-broncos', 'detroit-lions', 'green-bay-packers',
    'houston-texans', 'indianapolis-colts', 'jacksonville-jaguars', 'kansas-city-chiefs',
    'las-vegas-raiders', 'los-angeles-chargers', 'los-angeles-rams', 'miami-dolphins',
    'minnesota-vikings', 'new-england-patriots', 'new-orleans-saints', 'new-york-giants',
    'new-york-jets', 'philadelphia-eagles', 'pittsburgh-steelers', 'san-francisco-49ers',
    'seattle-seahawks', 'tampa-bay-buccaneers', 'tennessee-titans', 'washington-commanders'
];

// Team URL slugs for Denver
const DENVER_TEAMS = [
    'arizona-cardinals', 'atlanta-falcons', 'baltimore-ravens', 'buffalo-bills',
    'carolina-panthers', 'chicago-bears', 'cincinnati-bengals', 'cleveland-browns',
    'dallas-cowboys', 'denver-broncos', 'detroit-lions', 'green-bay-packers',
    'houston-texans', 'indianapolis-colts', 'jacksonville-jaguars', 'kansas-city-chiefs',
    'oakland-raiders', 'los-angeles-chargers', 'los-angeles-rams', 'miami-dolphins',
    'minnesota-vikings', 'new-england-patriots', 'new-orleans-saints', 'new-york-giants',
    'new-york-jets', 'philadelphia-eagles', 'pittsburgh-steelers', 'san-francisco-49ers',
    'seattle-seahawks', 'tampa-bay-buccaneers', 'tennessee-titans', 'washington-commanders'
];

function parseHelmetTitle(title) {
    const result = { player: null, team: null, helmetType: 'fullsize-authentic', designType: 'regular', authCompany: null };
    const titleLower = title.toLowerCase();

    // Parse team
    for (const team of NFL_TEAMS) {
        if (titleLower.includes(team.toLowerCase())) { result.team = team; break; }
    }

    // Parse helmet type - order matters! Check specific types first
    if (titleLower.includes('mini')) {
        result.helmetType = 'mini';
    } else if (titleLower.includes('midi') || titleLower.includes('mid-size') || titleLower.includes('mid size')) {
        result.helmetType = 'midi';
    } else if (titleLower.includes('speedflex')) {
        result.helmetType = 'fullsize-speedflex';
    } else if (titleLower.includes('full-size replica') || titleLower.includes('full size replica') || titleLower.includes('f/s replica')) {
        result.helmetType = 'fullsize-replica';
    } else if (titleLower.includes('replica')) {
        result.helmetType = 'fullsize-replica';
    } else if (titleLower.includes('authentic') || titleLower.includes('f/s') || titleLower.includes('full-size') || titleLower.includes('full size')) {
        result.helmetType = 'fullsize-authentic';
    }

    // Parse design type/variation
    if (titleLower.includes('lunar') || titleLower.includes('lunar eclipse')) {
        result.designType = 'lunar-eclipse';
    } else if (titleLower.includes('eclipse')) {
        result.designType = 'eclipse';
    } else if (titleLower.includes('flash')) {
        result.designType = 'flash';
    } else if (titleLower.includes('camo')) {
        result.designType = 'camo';
    } else if (titleLower.includes('salute to service') || titleLower.includes('sts') || titleLower.includes('salute')) {
        result.designType = 'salute-to-service';
    } else if (titleLower.includes('rave')) {
        result.designType = 'rave';
    } else if (titleLower.includes('amp')) {
        result.designType = 'amp';
    } else if (titleLower.includes('slate')) {
        result.designType = 'slate';
    } else if (titleLower.includes('flat white')) {
        result.designType = 'flat-white';
    } else if (titleLower.includes('chrome')) {
        result.designType = 'chrome';
    } else if (titleLower.includes('throwback') || titleLower.includes('tb ')) {
        result.designType = 'throwback';
    } else if (titleLower.includes('alternate') || titleLower.includes('alt ')) {
        result.designType = 'alternate';
    } else if (titleLower.includes('rivalries')) {
        result.designType = 'rivalries';
    }

    // Parse auth company
    if (title.includes('JSA')) result.authCompany = 'JSA';
    else if (title.includes('Beckett') || title.includes('BAS')) result.authCompany = 'Beckett';
    else if (title.includes('Fanatics')) result.authCompany = 'Fanatics';
    else if (title.includes('PSA')) result.authCompany = 'PSA/DNA';

    // Parse player name - try to get first and last name
    const match = title.match(/([A-Z][a-z]+\s+[A-Z][a-z]+)/);
    if (match) result.player = match[1];

    return result;
}

const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
};

// ============ SCRAPER FUNCTIONS ============

// RSA - Shopify JSON API (working!)
async function scrapeRSA() {
    console.log('\n📦 Scraping Shop RSA...');
    const helmets = [];

    try {
        let page = 1;
        let hasMore = true;

        while (hasMore && page <= 10) {
            const url = `https://www.shoprsa.com/products.json?limit=250&page=${page}`;
            console.log(`   Fetching page ${page}...`);

            const response = await axios.get(url, { headers, timeout: 30000 });
            const products = response.data.products || [];

            if (products.length === 0) {
                hasMore = false;
            } else {
                console.log(`   Page ${page}: ${products.length} products`);
                for (const product of products) {
                    const title = product.title || '';
                    const price = parseFloat(product.variants?.[0]?.price) || 0;
                    if (title.toLowerCase().includes('helmet')) {
                        helmets.push({ title, price, source: 'rsa' });
                    }
                }
                page++;
            }
            await sleep(500);
        }
        console.log(`   ✅ Found ${helmets.length} helmets from RSA`);
    } catch (error) {
        console.log(`   ❌ RSA Error: ${error.message}`);
    }

    return helmets;
}

// Radtke Sports - WooCommerce site, scrape by team
async function scrapeRadtke(browser) {
    console.log('\n📦 Scraping Radtke Sports...');
    const helmets = [];

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        await page.setViewport({ width: 1920, height: 1080 });

        // Helmet type suffixes for Radtke URLs
        const helmetTypes = [
            { slug: 'autographed-authentic-pro-line-helmets', name: 'Authentic' },
            { slug: 'full-size-replica-helmets', name: 'Replica' },
            { slug: 'mini-helmets', name: 'Mini' }
        ];

        // Sample a few popular teams to avoid scraping all 32x3 = 96 pages
        const popularTeams = [
            'kansas-city-chiefs', 'dallas-cowboys', 'green-bay-packers', 'new-england-patriots',
            'san-francisco-49ers', 'buffalo-bills', 'philadelphia-eagles', 'miami-dolphins',
            'denver-broncos', 'pittsburgh-steelers', 'chicago-bears', 'las-vegas-raiders'
        ];

        let pageCount = 0;
        for (const team of popularTeams) {
            for (const helmetType of helmetTypes) {
                // Try both URL patterns
                const urls = [
                    `https://www.radtkesports.com/autographed-memorabilia/sports/nfl/${team}/${helmetType.slug}/`,
                    `https://www.radtkesports.com/autographed-memorabilia/sports/nfl/${team}/${helmetType.slug}-1-${team}/`
                ];

                for (const url of urls) {
                    try {
                        console.log(`   Loading: ${team} - ${helmetType.name}...`);
                        // Use networkidle2 for full page load
                        await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
                        await sleep(2500); // Wait longer for dynamic content

                        // Check if we got a 404 page
                        const pageTitle = await page.title();
                        if (pageTitle.toLowerCase().includes('not found') || pageTitle.toLowerCase().includes('404')) {
                            continue;
                        }

                        const items = await page.evaluate(() => {
                            const results = [];
                            // Use li.product which is the actual product container
                            const products = document.querySelectorAll('li.product');

                            products.forEach(prod => {
                                // Radtke uses .item-title div or h3 for titles (not h2)
                                const titleEl = prod.querySelector('.item-title, h3, .product-title');
                                const priceEl = prod.querySelector('.price');

                                let title = '';
                                if (titleEl) {
                                    title = titleEl.textContent.trim();
                                } else {
                                    // Fallback: extract from product link URL
                                    const link = prod.querySelector('a[href*="/product/"]');
                                    if (link) {
                                        const urlParts = link.href.split('/').filter(p => p);
                                        const lastPart = urlParts[urlParts.length - 1] || '';
                                        title = lastPart.replace(/-/g, ' ');
                                    }
                                }

                                let price = 0;
                                if (priceEl) {
                                    // Get first price (ignore sale prices)
                                    const priceText = priceEl.textContent.split('$')[1] || '';
                                    price = parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0;
                                }

                                if (title.length > 10 && !title.includes('Menu') && !title.includes('Cart')) {
                                    results.push({ title, price });
                                }
                            });
                            return results;
                        });

                        if (items.length > 0) {
                            items.forEach(item => helmets.push({ ...item, source: 'radtke' }));
                            console.log(`      Found ${items.length} products`);
                            pageCount++;
                            break; // URL worked, no need to try alternate
                        }
                    } catch (err) {
                        // URL didn't work, try next pattern
                    }
                    await sleep(1500);
                }
            }
        }

        await page.close();
        console.log(`   ✅ Found ${helmets.length} helmets from Radtke (${pageCount} pages)`);

    } catch (error) {
        console.log(`   ❌ Radtke Error: ${error.message}`);
    }

    return helmets;
}

// Denver Autographs - WooCommerce site, scrape NFL category with helmet filter
async function scrapeDenver(browser) {
    console.log('\n📦 Scraping Denver Autographs...');
    const helmets = [];

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        await page.setViewport({ width: 1920, height: 1080 });

        // Try the main NFL page first, then search for helmets
        const urls = [
            'https://www.denverautographs.com/?s=helmet&post_type=product',
            'https://www.denverautographs.com/product-category/nfl/?s=helmet',
            'https://www.denverautographs.com/product-category/helmets/',
        ];

        // Also try popular team pages
        const popularTeams = ['denver-broncos', 'kansas-city-chiefs', 'dallas-cowboys', 'green-bay-packers'];
        for (const team of popularTeams) {
            urls.push(`https://www.denverautographs.com/product-category/nfl/${team}/`);
        }

        for (const url of urls) {
            console.log(`   Loading: ${url.substring(0, 60)}...`);
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await sleep(2000);

                const items = await page.evaluate(() => {
                    const results = [];
                    // WooCommerce product selectors
                    const products = document.querySelectorAll('.product, .woocommerce-loop-product__link, li.product, .products .product');

                    products.forEach(prod => {
                        const titleEl = prod.querySelector('.woocommerce-loop-product__title, h2, .product-title, a.woocommerce-LoopProduct-link');
                        const priceEl = prod.querySelector('.price .amount, .woocommerce-Price-amount');

                        if (titleEl) {
                            const title = titleEl.textContent.trim();
                            let price = 0;
                            if (priceEl) {
                                const priceText = priceEl.textContent.replace(/[^0-9.]/g, '');
                                price = parseFloat(priceText) || 0;
                            }
                            // Only include helmets
                            if (title.length > 10 && title.toLowerCase().includes('helmet')) {
                                results.push({ title, price });
                            }
                        }
                    });
                    return results;
                });

                if (items.length > 0) {
                    items.forEach(item => {
                        // Avoid duplicates
                        if (!helmets.find(h => h.title === item.title)) {
                            helmets.push({ ...item, source: 'denver' });
                        }
                    });
                    console.log(`      Found ${items.length} products`);
                }
            } catch (err) {
                console.log(`      Error: ${err.message.substring(0, 50)}`);
            }
            await sleep(1500);
        }

        await page.close();
        console.log(`   ✅ Found ${helmets.length} helmets from Denver`);

    } catch (error) {
        console.log(`   ❌ Denver Error: ${error.message}`);
    }

    return helmets;
}

// eBay - Updated selectors for new eBay design
async function scrapeEbay(browser) {
    console.log('\n📦 Scraping eBay sold listings...');
    const helmets = [];

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1920, height: 1080 });

        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
        });

        const searches = ['NFL autographed helmet', 'signed football helmet'];

        for (const search of searches) {
            console.log(`   Searching: "${search}"`);
            try {
                const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(search)}&LH_Complete=1&LH_Sold=1&_sop=13`;
                await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
                await sleep(3000);

                // Try multiple selector strategies
                const items = await page.evaluate(() => {
                    const results = [];

                    // New eBay design uses s-card
                    let cards = document.querySelectorAll('.s-card');

                    // Fallback to old s-item selector
                    if (cards.length === 0) {
                        cards = document.querySelectorAll('.s-item');
                    }

                    // Try srp-results li items
                    if (cards.length === 0) {
                        cards = document.querySelectorAll('.srp-results li');
                    }

                    cards.forEach(el => {
                        // Try new selectors first
                        let titleEl = el.querySelector('.s-card__title, .s-item__title');
                        let priceEl = el.querySelector('.s-card__price, .s-item__price');

                        if (titleEl && priceEl) {
                            const title = titleEl.innerText.trim();
                            const priceText = priceEl.innerText.replace(/[^0-9.]/g, '');
                            const price = parseFloat(priceText) || 0;
                            if (title && !title.includes('Shop on eBay') && price > 50 && price < 15000) {
                                results.push({ title, price });
                            }
                        }
                    });
                    return results;
                });

                items.forEach(item => helmets.push({ ...item, source: 'ebay' }));
                console.log(`      Found ${items.length} items`);

            } catch (err) {
                console.log(`      Error: ${err.message.substring(0, 50)}`);
            }
            await sleep(4000);
        }

        await page.close();
        console.log(`   ✅ Total from eBay: ${helmets.length} helmets`);

    } catch (error) {
        console.log(`   ❌ eBay Error: ${error.message}`);
    }

    return helmets;
}

// ============ MAIN FUNCTION ============

async function discoverAllHelmets() {
    console.log('🚀 Starting multi-source helmet discovery...\n');
    console.log('═'.repeat(50));
    console.log('Sources: RSA, Radtke, Denver, eBay');
    console.log('═'.repeat(50));

    // Launch browser for sites that need it
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });

    // Scrape all sources
    const rsaHelmets = await scrapeRSA();
    const radtkeHelmets = await scrapeRadtke(browser);
    const denverHelmets = await scrapeDenver(browser);
    const ebayHelmets = await scrapeEbay(browser);

    await browser.close();

    const allHelmets = [...rsaHelmets, ...radtkeHelmets, ...denverHelmets, ...ebayHelmets];

    // Deduplicate
    const uniqueHelmets = [];
    const seen = new Set();
    for (const h of allHelmets) {
        const key = h.title.toLowerCase().substring(0, 80);
        if (!seen.has(key)) {
            seen.add(key);
            uniqueHelmets.push(h);
        }
    }

    // Summary
    console.log('\n' + '═'.repeat(50));
    console.log('📊 DISCOVERY SUMMARY');
    console.log('═'.repeat(50));
    console.log(`   RSA:      ${rsaHelmets.length} helmets`);
    console.log(`   Radtke:   ${radtkeHelmets.length} helmets`);
    console.log(`   Denver:   ${denverHelmets.length} helmets`);
    console.log(`   eBay:     ${ebayHelmets.length} helmets`);
    console.log(`   ─────────────────────────────`);
    console.log(`   TOTAL:    ${allHelmets.length} found`);
    console.log(`   UNIQUE:   ${uniqueHelmets.length} after dedup`);
    console.log('═'.repeat(50) + '\n');

    if (uniqueHelmets.length === 0) {
        console.log('⚠️  No helmets found.\n');
        return;
    }

    // Show samples
    console.log('📋 Sample helmets:');
    uniqueHelmets.slice(0, 8).forEach((h, i) => {
        console.log(`   ${i + 1}. [${h.source}] $${h.price} - ${h.title.substring(0, 50)}...`);
    });

    // Save to database
    console.log('\n💾 Saving to database...\n');

    let saved = 0;
    let pricesAdded = 0;
    let errors = 0;

    for (const helmet of uniqueHelmets) {
        try {
            const parsed = parseHelmetTitle(helmet.title);
            const searchQuery = helmet.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').substring(0, 200);

            // Check if exists
            const { data: existing } = await supabase
                .from('helmets')
                .select('id')
                .eq('ebay_search_query', searchQuery)
                .single();

            let helmetId;

            if (!existing) {
                // Insert new helmet
                const { data: inserted, error } = await supabase
                    .from('helmets')
                    .insert({
                        name: helmet.title.substring(0, 250),
                        player: parsed.player,
                        team: parsed.team,
                        helmet_type: parsed.helmetType,
                        design_type: parsed.designType,
                        auth_company: parsed.authCompany,
                        ebay_search_query: searchQuery
                    })
                    .select()
                    .single();

                if (error) {
                    errors++;
                    if (errors <= 3) console.log(`   ❌ Insert error: ${error.message}`);
                    continue;
                }

                helmetId = inserted.id;
                saved++;

                if (saved % 50 === 0) console.log(`   ✅ Saved ${saved} helmets...`);
            } else {
                helmetId = existing.id;
            }

            // Insert price
            if (helmet.price > 0 && helmetId) {
                const { error: priceError } = await supabase.from('helmet_prices').insert({
                    helmet_id: helmetId,
                    median_price: helmet.price,
                    min_price: helmet.price,
                    max_price: helmet.price,
                    total_results: 1,
                    source: helmet.source
                });

                if (priceError) {
                    // If source column doesn't exist, try without it
                    if (priceError.message.includes('source')) {
                        await supabase.from('helmet_prices').insert({
                            helmet_id: helmetId,
                            median_price: helmet.price,
                            min_price: helmet.price,
                            max_price: helmet.price,
                            total_results: 1
                        });
                    }
                }
                pricesAdded++;
            }

        } catch (err) {
            errors++;
        }
    }

    console.log('\n' + '═'.repeat(50));
    console.log('✅ COMPLETE');
    console.log('═'.repeat(50));
    console.log(`   New helmets saved: ${saved}`);
    console.log(`   Prices recorded: ${pricesAdded}`);
    console.log(`   Errors: ${errors}`);
    console.log('═'.repeat(50));
}

// Run
discoverAllHelmets()
    .then(() => { console.log('\n🎉 Done!\n'); process.exit(0); })
    .catch(error => { console.error('❌ Fatal:', error); process.exit(1); });
