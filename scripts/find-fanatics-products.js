const FirecrawlApp = require('@mendable/firecrawl-js').default;
const cheerio = require('cheerio');
require('dotenv').config();

async function findProducts() {
    console.log('🔍 Searching for product data in Fanatics HTML...\n');

    const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });
    const url = 'https://www.fanatics.com/search/NFL%20autographed%20helmet';

    try {
        const result = await firecrawl.v1.scrapeUrl(url, {
            formats: ['markdown', 'html'],
            onlyMainContent: false
        });

        if (!result || !result.success) {
            console.log('Failed to scrape');
            return;
        }

        const $ = cheerio.load(result.html);
        const html = result.html;

        // Search for common product patterns
        console.log('🔍 Searching for product-related selectors:\n');

        const patterns = [
            { name: 'product-card', selector: '[class*="product-card"]' },
            { name: 'product-grid', selector: '[class*="product-grid"]' },
            { name: 'product-item', selector: '[class*="product-item"]' },
            { name: 'product-list', selector: '[class*="product-list"]' },
            { name: 'ProductCard', selector: '[class*="ProductCard"]' },
            { name: 'ProductGrid', selector: '[class*="ProductGrid"]' },
            { name: 'search-results', selector: '[class*="search-result"]' },
            { name: 'plp (product list)', selector: '[class*="plp"]' },
            { name: 'catalog', selector: '[class*="catalog"]' },
            { name: 'listing', selector: '[class*="listing"]' },
            { name: 'grid-item', selector: '[class*="grid-item"]' },
            { name: 'data-talos product', selector: '[data-talos*="product"]' },
            { name: 'data-product', selector: '[data-product]' },
            { name: 'article elements', selector: 'article' },
            { name: 'role=listitem', selector: '[role="listitem"]' }
        ];

        patterns.forEach(({ name, selector }) => {
            const count = $(selector).length;
            if (count > 0) {
                console.log(`  ✓ ${name}: ${count} elements`);

                // Show a sample
                const first = $(selector).first();
                const classes = first.attr('class');
                const dataAttrs = [];
                for (const attr in first[0]?.attribs || {}) {
                    if (attr.startsWith('data-')) {
                        dataAttrs.push(`${attr}="${first.attr(attr)?.substring(0, 40)}"`);
                    }
                }
                if (classes) console.log(`    Classes: ${classes.substring(0, 100)}`);
                if (dataAttrs.length) console.log(`    Data: ${dataAttrs.join(', ')}`);
            }
        });

        // Check if there's any JSON data embedded in the page
        console.log('\n\n🔍 Searching for embedded JSON data:\n');

        $('script[type="application/json"], script[type="application/ld+json"]').each((i, script) => {
            const content = $(script).html();
            if (content && content.length > 100) {
                console.log(`  Found JSON script #${i + 1}:`);
                console.log(`    Length: ${content.length} chars`);
                console.log(`    First 300 chars: ${content.substring(0, 300)}`);

                // Try to parse and look for products
                try {
                    const data = JSON.parse(content);
                    if (data.products || data.items || data.searchResults) {
                        console.log('    ⭐ Contains product data!');
                    }
                } catch (e) {
                    // Not valid JSON
                }
            }
        });

        // Check for any script tags that might contain product data
        console.log('\n\n🔍 Searching for product data in script tags:\n');
        let foundProductData = false;
        $('script').each((i, script) => {
            const content = $(script).html() || '';
            if (content.includes('product') && content.includes('price') && content.length > 200) {
                console.log(`  Found potential product data in script #${i}:`);
                console.log(`    Length: ${content.length} chars`);
                console.log(`    Sample: ${content.substring(0, 400)}`);
                foundProductData = true;
            }
        });

        if (!foundProductData) {
            console.log('  No product data found in script tags');
        }

        // Look for any divs/spans with "helmet" in text
        console.log('\n\n🔍 Searching for elements containing "helmet":\n');
        const helmetElements = $('*').filter((i, el) => {
            const text = $(el).text().toLowerCase();
            return text.includes('helmet') && text.length < 200;
        });
        console.log(`  Found ${helmetElements.length} elements with "helmet" in text`);
        helmetElements.slice(0, 5).each((i, el) => {
            console.log(`    ${i + 1}. <${el.name}> ${$(el).text().trim().substring(0, 100)}`);
        });

        // Check markdown for product info
        console.log('\n\n🔍 Searching markdown for helmet products:\n');
        const mdLines = result.markdown.split('\n');
        const helmetLines = mdLines.filter(line =>
            line.toLowerCase().includes('helmet') &&
            (line.includes('$') || line.toLowerCase().includes('sign') || line.toLowerCase().includes('auto'))
        );
        console.log(`  Found ${helmetLines.length} lines in markdown mentioning helmets`);
        helmetLines.slice(0, 10).forEach((line, i) => {
            console.log(`    ${i + 1}. ${line.substring(0, 150)}`);
        });

    } catch (error) {
        console.error('Error:', error.message);
    }
}

findProducts().catch(console.error);
