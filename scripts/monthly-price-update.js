const puppeteer = require('puppeteer');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Scrape current eBay sold listings for a query
async function scrapeEbayPrices(browser, query) {
    const page = await browser.newPage();
    try {
        const url = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1&_sop=13`;

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

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

// Update all helmet prices
async function updateAllHelmetPrices() {
    console.log('🔄 Starting monthly price update...\n');

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        // Get all active helmets
        const { data: helmets, error } = await supabase
            .from('helmets')
            .select('id, name, player, team, ebay_search_query')
            .eq('is_active', true);

        if (error) {
            console.error('❌ Error fetching helmets:', error);
            return;
        }

        console.log(`📊 Updating prices for ${helmets.length} helmets\n`);

        let updated = 0;
        let failed = 0;

        for (const helmet of helmets) {
            try {
                console.log(`⏳ Updating: ${helmet.player} (${helmet.team})`);

                const priceData = await scrapeEbayPrices(browser, helmet.ebay_search_query);

                if (priceData.median) {
                    // Insert new price snapshot
                    const { error: insertError } = await supabase
                        .from('helmet_prices')
                        .insert({
                            helmet_id: helmet.id,
                            median_price: priceData.median,
                            min_price: priceData.min,
                            max_price: priceData.max,
                            total_results: priceData.total,
                            ebay_url: priceData.url
                        });

                    if (insertError) {
                        console.error(`   ❌ Error saving price: ${insertError.message}`);
                        failed++;
                    } else {
                        console.log(`   ✅ Updated: $${priceData.median} (${priceData.total} sales)`);
                        updated++;
                    }
                } else {
                    console.log(`   ⚠️  No sales found`);
                    failed++;
                }

                // Rate limiting - 2 seconds between requests
                await sleep(2000);

            } catch (error) {
                console.error(`   ❌ Error updating ${helmet.name}:`, error.message);
                failed++;
            }
        }

        console.log(`\n✅ Update complete!`);
        console.log(`   📈 Successfully updated: ${updated}`);
        console.log(`   ❌ Failed: ${failed}`);

    } catch (error) {
        console.error('❌ Fatal error:', error);
    } finally {
        await browser.close();
    }
}

// Run the update
updateAllHelmetPrices()
    .then(() => {
        console.log('\n🎉 Monthly update finished!');
        process.exit(0);
    })
    .catch(error => {
        console.error('❌ Update failed:', error);
        process.exit(1);
    });
