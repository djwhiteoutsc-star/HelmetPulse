const puppeteer = require('puppeteer');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function testRadtke() {
    console.log('Testing Radtke scraper with updated selectors...\n');

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    const testUrls = [
        { team: 'kansas-city-chiefs', type: 'autographed-authentic-pro-line-helmets', name: 'Chiefs Authentic' },
        { team: 'dallas-cowboys', type: 'mini-helmets', name: 'Cowboys Mini' },
        { team: 'green-bay-packers', type: 'full-size-replica-helmets', name: 'Packers Replica' }
    ];

    let totalFound = 0;

    for (const test of testUrls) {
        const url = `https://www.radtkesports.com/autographed-memorabilia/sports/nfl/${test.team}/${test.type}/`;
        console.log(`Testing: ${test.name}`);
        console.log(`URL: ${url}\n`);

        try {
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
            await sleep(2500);

            const pageTitle = await page.title();
            console.log(`Page Title: ${pageTitle}`);

            if (pageTitle.toLowerCase().includes('not found')) {
                console.log('❌ Page not found\n');
                continue;
            }

            const items = await page.evaluate(() => {
                const results = [];
                const products = document.querySelectorAll('li.product');

                products.forEach(prod => {
                    // Radtke uses .item-title div or h3 for titles (not h2)
                    const titleEl = prod.querySelector('.item-title, h3, .product-title');
                    const priceEl = prod.querySelector('.price');

                    let title = '';
                    if (titleEl) {
                        title = titleEl.textContent.trim();
                    } else {
                        // Fallback: extract from product link URL
                        const link = prod.querySelector('a[href*="/product/"]');
                        if (link) {
                            const urlParts = link.href.split('/').filter(p => p);
                            const lastPart = urlParts[urlParts.length - 1] || '';
                            title = lastPart.replace(/-/g, ' ');
                        }
                    }

                    let price = 0;
                    if (priceEl) {
                        const priceText = priceEl.textContent.split('$')[1] || '';
                        price = parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0;
                    }

                    if (title.length > 10 && !title.includes('Menu') && !title.includes('Cart')) {
                        results.push({ title: title.substring(0, 60), price });
                    }
                });
                return results;
            });

            console.log(`✅ Found ${items.length} products\n`);
            totalFound += items.length;

            // Show first 3 items
            items.slice(0, 3).forEach((item, i) => {
                console.log(`   ${i+1}. $${item.price} - ${item.title}`);
            });
            console.log('');

        } catch (err) {
            console.log(`❌ Error: ${err.message}\n`);
        }
    }

    await browser.close();

    console.log('═'.repeat(50));
    console.log(`TOTAL FOUND: ${totalFound} products`);
    console.log('═'.repeat(50));
}

testRadtke().catch(console.error);
