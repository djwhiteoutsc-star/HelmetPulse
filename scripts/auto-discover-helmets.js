const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// NFL Teams for parsing
const NFL_TEAMS = [
    'Cardinals', 'Falcons', 'Ravens', 'Bills', 'Panthers', 'Bears', 'Bengals', 'Browns',
    'Cowboys', '49ers', 'Giants', 'Jaguars', 'Chiefs', 'Raiders', 'Chargers', 'Rams',
    'Dolphins', 'Vikings', 'Patriots', 'Saints', 'Jets', 'Eagles', 'Steelers', 'Seahawks',
    'Buccaneers', 'Titans', 'Commanders', 'Packers', 'Lions', 'Texans', 'Colts', 'Broncos'
];

// Popular players (expand this list)
const POPULAR_PLAYERS = [
    'Patrick Mahomes', 'Tom Brady', 'Josh Allen', 'Joe Burrow', 'Justin Herbert',
    'Lamar Jackson', 'Dak Prescott', 'Jalen Hurts', 'Trevor Lawrence', 'CJ Stroud',
    'Tua Tagovailoa', 'Justin Jefferson', 'Ja\'Marr Chase', 'Cooper Kupp', 'Tyreek Hill',
    'Travis Kelce', 'George Kittle', 'Nick Bosa', 'Micah Parsons', 'Myles Garrett',
    'Aaron Donald', 'Christian McCaffrey', 'Saquon Barkley', 'Derrick Henry',
    'Brock Purdy', 'Jordan Love', 'Geno Smith', 'Kirk Cousins', 'Derek Carr',
    'Jared Goff', 'Kyler Murray', 'Russell Wilson', 'Aaron Rodgers', 'Matthew Stafford'
];

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Parse helmet title to extract details
function parseHelmetTitle(title) {
    const result = {
        player: null,
        team: null,
        helmetType: 'speed-authentic', // default
        designType: 'regular',
        authCompany: null
    };

    // Extract player name (check against known players first)
    for (const player of POPULAR_PLAYERS) {
        if (title.includes(player)) {
            result.player = player;
            break;
        }
    }

    // If no known player found, try to extract first two capitalized words
    if (!result.player) {
        const playerMatch = title.match(/\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b/);
        if (playerMatch) result.player = playerMatch[1];
    }

    // Extract team
    for (const team of NFL_TEAMS) {
        if (title.includes(team)) {
            result.team = team;
            break;
        }
    }

    // Extract helmet type
    const titleLower = title.toLowerCase();
    if (titleLower.includes('speedflex')) {
        result.helmetType = 'speedflex';
    } else if (titleLower.includes('mini')) {
        result.helmetType = 'mini';
    } else if (titleLower.includes('midi')) {
        result.helmetType = 'midi-speedflex';
    } else if (titleLower.includes('replica')) {
        result.helmetType = 'speed-replica';
    }

    // Extract design type
    if (titleLower.includes('rave')) result.designType = 'rave';
    else if (titleLower.includes('salute to service 2')) result.designType = 'salute2';
    else if (titleLower.includes('salute')) result.designType = 'salute';
    else if (titleLower.includes('camo')) result.designType = 'camo';
    else if (titleLower.includes('alternate')) result.designType = 'alternate';
    else if (titleLower.includes('throwback')) result.designType = 'throwback';
    else if (titleLower.includes('lunar')) result.designType = 'lunar';
    else if (titleLower.includes('eclipse') && !titleLower.includes('lunar')) result.designType = 'eclipse';
    else if (titleLower.includes('amp')) result.designType = 'amp';
    else if (titleLower.includes('flash')) result.designType = 'flash';
    else if (titleLower.includes('slate')) result.designType = 'slate';

    // Extract auth company
    if (title.includes('JSA')) result.authCompany = 'JSA';
    else if (title.includes('Fanatics')) result.authCompany = 'Fanatics';
    else if (title.includes('Beckett')) result.authCompany = 'Beckett';
    else if (title.includes('PSA') || title.includes('DNA')) result.authCompany = 'PSA/DNA';

    return result.player ? result : null;
}

// Scrape current eBay sold listings for a query
async function scrapeEbayPrices(browser, query) {
    const page = await browser.newPage();

    // Set realistic viewport and user agent
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Remove webdriver flag
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    try {
        const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1&_sop=13`;

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await sleep(1500); // Wait for dynamic content

        // Extract prices
        const prices = await page.$$eval('.s-item__price', elements =>
            elements
                .map(el => el.textContent.trim().replace(/[$,]/g, ''))
                .map(p => parseFloat(p))
                .filter(p => !isNaN(p) && p > 0)
        );

        if (prices.length === 0) {
            return { median: null, min: null, max: null, total: 0, url };
        }

        prices.sort((a, b) => a - b);
        const median = prices[Math.floor(prices.length / 2)];

        return {
            median,
            min: Math.min(...prices),
            max: Math.max(...prices),
            total: prices.length,
            url
        };
    } catch (error) {
        console.error(`Error scraping ${query}:`, error.message);
        return { median: null, min: null, max: null, total: 0, url: null };
    } finally {
        await page.close();
    }
}

// Discover helmets from eBay search
async function discoverHelmetsFromSearch(browser, searchQuery, maxPages = 5) {
    const page = await browser.newPage();
    const discovered = [];

    // Set realistic viewport and user agent
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Remove webdriver flag
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });

    try {
        for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
            const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(searchQuery)}&LH_Sold=1&LH_Complete=1&_pgn=${pageNum}`;

            console.log(`Scraping page ${pageNum} for: ${searchQuery}`);

            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
                await sleep(2000); // Wait for page to fully load
            } catch (navError) {
                console.log(`   ⚠️  Navigation error on page ${pageNum}, skipping...`);
                continue;
            }

            // Extract all listings
            const listings = await page.$$eval('.s-item', items => {
                return items.slice(0, 50).map(item => { // Limit to 50 items per page
                    const titleEl = item.querySelector('.s-item__title');
                    const title = titleEl ? titleEl.textContent.trim() : null;
                    return title;
                }).filter(title => title && !title.includes('Shop on eBay'));
            });

            for (const title of listings) {
                // Only include signed/autographed helmets
                if (!title.toLowerCase().includes('signed') &&
                    !title.toLowerCase().includes('autograph')) {
                    continue;
                }

                const parsed = parseHelmetTitle(title);
                if (parsed && parsed.player && parsed.team) {
                    discovered.push({
                        name: title,
                        player: parsed.player,
                        team: parsed.team,
                        helmetType: parsed.helmetType,
                        designType: parsed.designType,
                        authCompany: parsed.authCompany,
                        searchQuery: title
                    });
                }
            }

            // Check if there's a next page
            const hasNext = await page.$('.pagination__next:not([aria-disabled="true"])');
            if (!hasNext) break;

            await sleep(3000); // Rate limiting between pages
        }
    } catch (error) {
        console.error(`Error discovering helmets for ${searchQuery}:`, error.message);
    } finally {
        await page.close();
    }

    return discovered;
}

// Main discovery function
async function discoverAllHelmets() {
    console.log('🚀 Starting helmet discovery...\n');

    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1920,1080',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ]
    });

    let allHelmets = [];

    try {
        // Search queries to discover helmets
        const searchQueries = [
            'NFL autographed helmet signed',
            'NFL signed authentic helmet',
            'NFL signed speedflex helmet',
            'NFL signed mini helmet',
            ...POPULAR_PLAYERS.map(p => `${p} signed helmet`)
        ];

        for (const query of searchQueries) {
            console.log(`\n🔍 Searching: ${query}`);
            const helmets = await discoverHelmetsFromSearch(browser, query, 2); // 2 pages per query
            allHelmets = allHelmets.concat(helmets);
            console.log(`   Found ${helmets.length} helmets`);
            await sleep(5000); // 5 second delay between searches
        }

        // Remove duplicates by name
        const uniqueHelmets = Array.from(
            new Map(allHelmets.map(h => [h.name, h])).values()
        );

        console.log(`\n✅ Discovered ${uniqueHelmets.length} unique helmets`);

        // Save to database and get initial prices
        console.log('\n💾 Saving to database and fetching initial prices...\n');

        let saved = 0;
        for (const helmet of uniqueHelmets) {
            // Check if already exists
            const { data: existing } = await supabase
                .from('helmets')
                .select('id')
                .eq('ebay_search_query', helmet.searchQuery)
                .single();

            if (!existing) {
                // Insert helmet
                const { data: inserted, error } = await supabase
                    .from('helmets')
                    .insert({
                        name: helmet.name,
                        player: helmet.player,
                        team: helmet.team,
                        helmet_type: helmet.helmetType,
                        design_type: helmet.designType,
                        auth_company: helmet.authCompany,
                        ebay_search_query: helmet.searchQuery
                    })
                    .select()
                    .single();

                if (error) {
                    console.error(`❌ Error saving ${helmet.name}:`, error.message);
                    continue;
                }

                // Get initial price
                console.log(`   📊 Fetching price for: ${helmet.player} (${helmet.team})`);
                const priceData = await scrapeEbayPrices(browser, helmet.searchQuery);

                if (priceData.median) {
                    await supabase.from('helmet_prices').insert({
                        helmet_id: inserted.id,
                        median_price: priceData.median,
                        min_price: priceData.min,
                        max_price: priceData.max,
                        total_results: priceData.total,
                        ebay_url: priceData.url
                    });
                }

                saved++;
                await sleep(3000); // Rate limiting between price checks
            }
        }

        console.log(`\n✅ Saved ${saved} new helmets to database!`);

    } catch (error) {
        console.error('❌ Error in discovery:', error);
    } finally {
        await browser.close();
    }

    console.log('\n🎉 Discovery complete!');
}

// Run the discovery
discoverAllHelmets().catch(console.error);
