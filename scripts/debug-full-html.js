const FirecrawlApp = require('@mendable/firecrawl-js').default;
const cheerio = require('cheerio');
require('dotenv').config();

async function debugFullHTML() {
    console.log('🔍 Debugging full HTML with onlyMainContent = false...\n');

    const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });
    const url = 'https://www.fanatics.com/search/NFL%20autographed%20helmet';

    try {
        const result = await firecrawl.v1.scrapeUrl(url, {
            formats: ['html'],
            onlyMainContent: false
        });

        console.log(`HTML length: ${result.html.length} chars\n`);

        const $ = cheerio.load(result.html);

        // Find all elements with "product" in class name
        const productElements = $('[class*="product"], [class*="Product"]');
        console.log(`Found ${productElements.length} elements with "product" in class\n`);

        productElements.each((i, elem) => {
            const $elem = $(elem);
            const classes = $elem.attr('class') || '';
            const tagName = elem.name;

            console.log(`\n${'='.repeat(60)}`);
            console.log(`ELEMENT #${i + 1}: <${tagName}>`);
            console.log('='.repeat(60));
            console.log(`Classes: ${classes.substring(0, 150)}`);

            // Look for title
            const titleCandidates = [];
            $elem.find('a, h1, h2, h3, h4, span, div').each((j, el) => {
                const text = $(el).text().trim();
                if (text.length > 15 && text.length < 200 && text.toLowerCase().includes('helmet')) {
                    titleCandidates.push(text);
                }
            });
            if (titleCandidates.length > 0) {
                console.log(`Title candidates: ${titleCandidates.slice(0, 3).join(' | ')}`);
            }

            // Look for price
            const priceElements = $elem.find('[class*="price"], [class*="Price"]');
            if (priceElements.length > 0) {
                priceElements.each((j, price) => {
                    const priceText = $(price).text().trim();
                    const priceClass = $(price).attr('class');
                    console.log(`Price: ${priceText} (${priceClass})`);
                });
            }

            // Look for links
            const links = $elem.find('a[href*="product"], a[href*="helmet"]');
            if (links.length > 0) {
                links.slice(0, 2).each((j, link) => {
                    const href = $(link).attr('href');
                    const linkText = $(link).text().trim();
                    console.log(`Link: ${linkText.substring(0, 60)} -> ${href?.substring(0, 80)}`);
                });
            }

            // Show a snippet of HTML
            console.log(`\nHTML snippet (first 500 chars):`);
            console.log($elem.html()?.substring(0, 500));
        });

        // Also search for any script tags with JSON data
        console.log('\n\n' + '='.repeat(60));
        console.log('SEARCHING FOR JSON DATA IN SCRIPTS');
        console.log('='.repeat(60));

        $('script').each((i, script) => {
            const content = $(script).html() || '';

            // Look for window.__INITIAL_STATE__ or similar
            if (content.includes('__INITIAL_STATE__') ||
                content.includes('__NEXT_DATA__') ||
                content.includes('"products"') ||
                content.includes('"searchResults"')) {

                console.log(`\nFound potential product data in script #${i}:`);
                console.log(`Content length: ${content.length} chars`);

                // Try to extract JSON
                const jsonMatch = content.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});/s) ||
                                content.match(/window\.__NEXT_DATA__\s*=\s*({.+?})<\/script>/s) ||
                                content.match(/({["']products["']:[^}]+})/);

                if (jsonMatch) {
                    console.log(`JSON snippet (first 1000 chars):`);
                    console.log(jsonMatch[1].substring(0, 1000));

                    try {
                        const data = JSON.parse(jsonMatch[1]);
                        if (data.products) {
                            console.log(`\n⭐ Found products array with ${data.products.length} items!`);
                        }
                    } catch (e) {
                        console.log(`Could not parse as JSON: ${e.message}`);
                    }
                } else {
                    console.log(`Sample (first 500 chars):`);
                    console.log(content.substring(0, 500));
                }
            }
        });

    } catch (error) {
        console.error('Error:', error.message);
    }
}

debugFullHTML().catch(console.error);
