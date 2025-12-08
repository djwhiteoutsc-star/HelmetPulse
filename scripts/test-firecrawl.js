const FirecrawlApp = require('@mendable/firecrawl-js').default;
require('dotenv').config();

async function testFirecrawl() {
    console.log('Testing Firecrawl API...\n');
    console.log('API Key:', process.env.FIRECRAWL_API_KEY ? 'Found' : 'Missing');

    try {
        const app = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY });
        console.log('FirecrawlApp instance created');
        console.log('Available methods on app:', Object.getOwnPropertyNames(Object.getPrototypeOf(app)));
        console.log('v1 object:', app.v1);
        console.log('Available methods on v1:', app.v1 ? Object.getOwnPropertyNames(Object.getPrototypeOf(app.v1)) : 'N/A');

        // Try scraping a simple page using v1.scrapeUrl
        console.log('\nAttempting to scrape Fanatics using v1.scrapeUrl...');
        const result = await app.v1.scrapeUrl('https://www.fanatics.com/search/NFL%20autographed%20helmet', {
            formats: ['markdown', 'html']
        });

        console.log('\nResult:', {
            success: result?.success,
            hasHtml: !!result?.html,
            hasMarkdown: !!result?.markdown,
            htmlLength: result?.html?.length || 0,
            markdownLength: result?.markdown?.length || 0
        });

        if (result?.html) {
            console.log('\nFirst 500 chars of HTML:', result.html.substring(0, 500));
        }

    } catch (error) {
        console.error('Error:', error.message);
        console.error('Stack:', error.stack);
    }
}

testFirecrawl().catch(console.error);
