const FirecrawlApp = require('@mendable/firecrawl-js').default;
const cheerio = require('cheerio');
require('dotenv').config();

async function testFirecrawlOptions() {
    console.log('🧪 Testing Firecrawl with different options...\n');

    const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });
    const url = 'https://www.fanatics.com/search/NFL%20autographed%20helmet';

    // Test 1: Default options
    console.log('Test 1: Default scrapeUrl');
    try {
        const result1 = await firecrawl.v1.scrapeUrl(url, {
            formats: ['html']
        });
        const $ = cheerio.load(result1.html);
        const products = $('[class*="product"], article, [data-talos*="product"]').length;
        console.log(`  Products found: ${products}`);
        console.log(`  HTML length: ${result1.html.length}`);
    } catch (e) {
        console.log(`  Error: ${e.message}`);
    }

    // Test 2: With timeout
    console.log('\nTest 2: With longer timeout (30s)');
    try {
        const result2 = await firecrawl.v1.scrapeUrl(url, {
            formats: ['html'],
            timeout: 30000
        });
        const $ = cheerio.load(result2.html);
        const products = $('[class*="product"], article, [data-talos*="product"]').length;
        console.log(`  Products found: ${products}`);
        console.log(`  HTML length: ${result2.html.length}`);
    } catch (e) {
        console.log(`  Error: ${e.message}`);
    }

    // Test 3: With waitFor parameter (if supported)
    console.log('\nTest 3: With waitFor parameter');
    try {
        const result3 = await firecrawl.v1.scrapeUrl(url, {
            formats: ['html'],
            waitFor: 5000  // wait 5 seconds for JS to execute
        });
        const $ = cheerio.load(result3.html);
        const products = $('[class*="product"], article, [data-talos*="product"]').length;
        console.log(`  Products found: ${products}`);
        console.log(`  HTML length: ${result3.html.length}`);
    } catch (e) {
        console.log(`  Error: ${e.message}`);
    }

    // Test 4: With onlyMainContent = false
    console.log('\nTest 4: With onlyMainContent = false');
    try {
        const result4 = await firecrawl.v1.scrapeUrl(url, {
            formats: ['html'],
            onlyMainContent: false
        });
        const $ = cheerio.load(result4.html);
        const products = $('[class*="product"], article, [data-talos*="product"]').length;
        console.log(`  Products found: ${products}`);
        console.log(`  HTML length: ${result4.html.length}`);

        // Also check for script tags with product data
        let hasProductScript = false;
        $('script').each((i, script) => {
            const content = $(script).html() || '';
            if (content.includes('product') && content.includes('price')) {
                hasProductScript = true;
            }
        });
        console.log(`  Has product script: ${hasProductScript}`);
    } catch (e) {
        console.log(`  Error: ${e.message}`);
    }

    // Test 5: Try the extract method instead
    console.log('\nTest 5: Using extract method for structured data');
    try {
        const result5 = await firecrawl.v1.extract(url, {
            schema: {
                type: 'object',
                properties: {
                    products: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                title: { type: 'string' },
                                price: { type: 'number' },
                                url: { type: 'string' }
                            }
                        }
                    }
                }
            }
        });
        console.log(`  Extract result:`, JSON.stringify(result5, null, 2).substring(0, 500));
    } catch (e) {
        console.log(`  Error: ${e.message}`);
    }

    console.log('\n✅ Tests complete');
}

testFirecrawlOptions().catch(console.error);
