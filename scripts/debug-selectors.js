const puppeteer = require('puppeteer');

async function debugSiteStructure() {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const sites = [
        { name: 'Radtke', url: 'https://www.radtkesports.com/collections/autographed-full-size-helmets' },
        { name: 'Denver', url: 'https://www.denverautographs.com/collections/autographed-helmets' },
        { name: 'eBay', url: 'https://www.ebay.com/sch/i.html?_nkw=NFL+autographed+helmet&LH_Complete=1&LH_Sold=1' }
    ];

    for (const site of sites) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`DEBUGGING: ${site.name}`);
        console.log(`URL: ${site.url}`);
        console.log('='.repeat(60));

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1920, height: 1080 });

        try {
            await page.goto(site.url, { waitUntil: 'networkidle2', timeout: 60000 });
            await new Promise(r => setTimeout(r, 3000));

            // Get page title
            const title = await page.title();
            console.log(`\nPage Title: ${title}`);

            // Check for common product selectors
            const debug = await page.evaluate(() => {
                const selectors = [
                    '.product-card', '.product-item', '.grid-product', '.product',
                    '.s-item', '.srp-results', '[class*="product"]', '[class*="item"]',
                    '.collection-product', '.product-grid-item', '.product-block',
                    '.grid__item', '.productgrid--item', 'li.grid__item'
                ];

                const results = {};
                for (const sel of selectors) {
                    const els = document.querySelectorAll(sel);
                    if (els.length > 0) {
                        results[sel] = els.length;
                    }
                }

                // Get sample of actual class names in the page
                const allClasses = new Set();
                document.querySelectorAll('*').forEach(el => {
                    el.classList.forEach(c => {
                        if (c.includes('product') || c.includes('item') || c.includes('grid') || c.includes('card')) {
                            allClasses.add(c);
                        }
                    });
                });

                // Get first 500 chars of body HTML structure hints
                const bodyHTML = document.body.innerHTML.substring(0, 2000);

                return {
                    matchingSelectors: results,
                    relevantClasses: Array.from(allClasses).slice(0, 30),
                    sampleHTML: bodyHTML
                };
            });

            console.log('\nMatching Selectors:');
            console.log(JSON.stringify(debug.matchingSelectors, null, 2));

            console.log('\nRelevant Classes Found:');
            console.log(debug.relevantClasses.join(', '));

            // Try to find any links containing /products/
            const productLinks = await page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a[href*="/products/"]'));
                return links.slice(0, 5).map(a => ({
                    href: a.href,
                    text: a.textContent.trim().substring(0, 50),
                    parentClass: a.parentElement?.className
                }));
            });

            console.log('\nProduct Links Found:');
            console.log(JSON.stringify(productLinks, null, 2));

        } catch (err) {
            console.log(`ERROR: ${err.message}`);
        }

        await page.close();
    }

    await browser.close();
    console.log('\n\nDebug complete!');
}

debugSiteStructure().catch(console.error);
