const FirecrawlApp = require('@mendable/firecrawl-js').default;
const cheerio = require('cheerio');
require('dotenv').config();

async function debugFanaticsHTML() {
    console.log('🔍 Debugging Fanatics HTML structure from Firecrawl...\n');

    const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });
    const url = 'https://www.fanatics.com/search/NFL%20autographed%20helmet';

    try {
        console.log('Scraping URL:', url);
        const result = await firecrawl.v1.scrapeUrl(url, {
            formats: ['markdown', 'html']
        });

        if (!result || !result.success) {
            console.log('Failed to scrape page');
            return;
        }

        console.log('✅ Page scraped successfully');
        console.log('HTML length:', result.html.length);
        console.log('Markdown length:', result.markdown.length);

        const $ = cheerio.load(result.html);

        // Find all .image-card elements
        const imageCards = $('.image-card');
        console.log('\n📦 Found', imageCards.length, '.image-card elements\n');

        // Show first 3 image cards in detail
        imageCards.slice(0, 3).each((i, elem) => {
            console.log(`\n${'='.repeat(60)}`);
            console.log(`IMAGE CARD #${i + 1}`);
            console.log('='.repeat(60));

            const $elem = $(elem);

            // Show the full HTML (first 2000 chars)
            console.log('\n📄 FULL HTML:');
            console.log($elem.html().substring(0, 2000));

            // Try to find links
            console.log('\n🔗 LINKS:');
            $elem.find('a').each((j, link) => {
                console.log(`  ${j + 1}. href: ${$(link).attr('href')}`);
                console.log(`     text: ${$(link).text().trim().substring(0, 100)}`);
                console.log(`     title: ${$(link).attr('title') || 'N/A'}`);
            });

            // Try to find images
            console.log('\n🖼️ IMAGES:');
            $elem.find('img').each((j, img) => {
                console.log(`  ${j + 1}. src: ${$(img).attr('src')?.substring(0, 80)}`);
                console.log(`     alt: ${$(img).attr('alt')}`);
            });

            // Try to find prices
            console.log('\n💰 PRICE ELEMENTS:');
            $elem.find('[class*="price"], [class*="Price"]').each((j, price) => {
                console.log(`  ${j + 1}. class: ${$(price).attr('class')}`);
                console.log(`     text: ${$(price).text().trim()}`);
            });

            // Look for any data attributes
            console.log('\n📊 DATA ATTRIBUTES:');
            for (const attr of elem.attributes) {
                if (attr.name.startsWith('data-')) {
                    console.log(`  ${attr.name}: ${attr.value.substring(0, 100)}`);
                }
            }

            // Show all classes
            console.log('\n🏷️ ALL UNIQUE CLASSES IN THIS CARD:');
            const classes = new Set();
            $elem.find('*').each((j, el) => {
                if (el.attribs && el.attribs.class) {
                    el.attribs.class.split(' ').forEach(c => classes.add(c));
                }
            });
            console.log('  ', Array.from(classes).join(', '));
        });

        // Also check the markdown to see if it has structured data
        console.log('\n\n' + '='.repeat(60));
        console.log('MARKDOWN CONTENT (first 2000 chars):');
        console.log('='.repeat(60));
        console.log(result.markdown.substring(0, 2000));

    } catch (error) {
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
    }
}

debugFanaticsHTML().catch(console.error);
