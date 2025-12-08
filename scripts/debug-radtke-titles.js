const puppeteer = require('puppeteer');

async function debugRadtkeTitles() {
    console.log('Finding where Radtke product titles are located...\n');

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    const url = 'https://www.radtkesports.com/autographed-memorabilia/sports/nfl/kansas-city-chiefs/autographed-authentic-pro-line-helmets/';

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000));

    const products = await page.evaluate(() => {
        const results = [];
        const productElements = document.querySelectorAll('li.product');

        productElements.forEach((prod, index) => {
            if (index >= 5) return; // Only check first 5

            const productData = {
                index,
                possibleTitles: []
            };

            // Method 1: Title from link href (extract from URL)
            const link = prod.querySelector('a[href*="/product/"]');
            if (link) {
                const href = link.href;
                // Extract title from URL path
                const urlParts = href.split('/').filter(p => p);
                const lastPart = urlParts[urlParts.length - 1] || urlParts[urlParts.length - 2];
                productData.possibleTitles.push({
                    method: 'URL path',
                    value: lastPart.replace(/-/g, ' ')
                });

                // Also check title attribute
                if (link.title) {
                    productData.possibleTitles.push({
                        method: 'link title attr',
                        value: link.title
                    });
                }
            }

            // Method 2: Look for any text-containing element inside product-item
            const textElements = prod.querySelectorAll('.product-item *');
            textElements.forEach(el => {
                const text = el.textContent.trim();
                if (text.length > 20 && text.length < 200 && !text.includes('$') && !text.includes('\n')) {
                    if (text.toLowerCase().includes('signed') || text.toLowerCase().includes('helmet') || text.toLowerCase().includes('authentic')) {
                        productData.possibleTitles.push({
                            method: `${el.tagName}.${el.className}`,
                            value: text.substring(0, 100)
                        });
                    }
                }
            });

            // Method 3: Check for span or div with class containing 'title' or 'name'
            const titleEl = prod.querySelector('[class*="title"], [class*="name"], .product-title');
            if (titleEl) {
                productData.possibleTitles.push({
                    method: 'title class element',
                    value: titleEl.textContent.trim()
                });
            }

            // Method 4: Get all links and their text
            const allLinks = prod.querySelectorAll('a');
            allLinks.forEach(a => {
                const text = a.textContent.trim();
                if (text.length > 20 && !text.includes('$')) {
                    productData.possibleTitles.push({
                        method: `link text: ${a.className}`,
                        value: text.substring(0, 100)
                    });
                }
            });

            // Get price
            const priceEl = prod.querySelector('.price');
            if (priceEl) {
                productData.price = priceEl.textContent.trim();
            }

            results.push(productData);
        });

        return results;
    });

    console.log('Found product data:\n');
    products.forEach(p => {
        console.log(`Product ${p.index}:`);
        console.log(`  Price: ${p.price}`);
        console.log('  Possible Titles:');
        p.possibleTitles.forEach(t => {
            console.log(`    [${t.method}]: ${t.value}`);
        });
        console.log('');
    });

    await browser.close();
}

debugRadtkeTitles().catch(console.error);
