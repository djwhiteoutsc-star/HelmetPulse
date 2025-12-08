const FirecrawlApp = require('@mendable/firecrawl-js').default;
const cheerio = require('cheerio');
require('dotenv').config();

async function testFanaticsCategory() {
    console.log('🧪 Testing Fanatics category pages with Firecrawl...\n');

    const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });

    const testUrls = [
        // Direct category URLs
        'https://www.fanatics.com/nfl/autographed-nfl-helmets/o-3572+d-34114444+z-95-3466529848',
        'https://www.fanatics.com/nfl/helmets/o-2438+d-67669008+z-92-3509530827',
        'https://www.fanatics.com/collectibles-and-memorabilia/autographed-helmets/d-5634225511+z-931425-1539088796'
    ];

    for (const url of testUrls) {
        console.log(`\n${'='.repeat(70)}`);
        console.log(`Testing: ${url}`);
        console.log('='.repeat(70));

        try {
            const result = await firecrawl.v1.scrapeUrl(url, {
                formats: ['html'],
                onlyMainContent: false
            });

            const $ = cheerio.load(result.html);

            console.log(`✓ Scraped successfully (${result.html.length} chars)\n`);

            // Look for product listings
            const selectors = [
                '[class*="product-card"]',
                '[class*="ProductCard"]',
                '[data-talos="product"]',
                '[data-talos="productCard"]',
                'article',
                '[role="listitem"]',
                '[class*="grid-item"]'
            ];

            let foundProducts = false;
            for (const selector of selectors) {
                const elements = $(selector);
                if (elements.length > 5) {  // More than just a few promo items
                    console.log(`✓ Found ${elements.length} elements with selector: ${selector}`);

                    // Examine first product
                    const first = elements.first();
                    const titleEl = first.find('a[href*="/product/"], h2, h3, [class*="title"]').first();
                    const priceEl = first.find('[class*="price"]').first();
                    const title = titleEl.text().trim() || titleEl.attr('title') || 'No title';
                    const price = priceEl.text().trim() || 'No price';

                    console.log(`\n  Sample product:`);
                    console.log(`    Title: ${title.substring(0, 80)}`);
                    console.log(`    Price: ${price}`);

                    if (title.toLowerCase().includes('helmet') || title.length > 20) {
                        foundProducts = true;
                        console.log(`\n  ⭐ This looks like real product data!`);
                    }
                    break;
                }
            }

            if (!foundProducts) {
                console.log('✗ No product listings found');

                // Check if there's a "no results" or redirect message
                const bodyText = $('body').text().toLowerCase();
                if (bodyText.includes('no results') || bodyText.includes('404') || bodyText.includes('not found')) {
                    console.log('  Page may not exist or has no results');
                }
            }

        } catch (error) {
            console.log(`✗ Error: ${error.message}`);
        }

        // Wait between requests
        await new Promise(r => setTimeout(r, 2000));
    }

    console.log('\n' + '='.repeat(70));
    console.log('✅ Tests complete');
}

testFanaticsCategory().catch(console.error);
