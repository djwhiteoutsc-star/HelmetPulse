const puppeteer = require('puppeteer');

async function debugRadtkeDeep() {
    console.log('Deep debugging Radtke page structure...\n');

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    const url = 'https://www.radtkesports.com/autographed-memorabilia/sports/nfl/kansas-city-chiefs/autographed-authentic-pro-line-helmets/';

    console.log(`Loading: ${url}\n`);

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait even longer
    console.log('Waiting 5 seconds for full page load...\n');
    await new Promise(r => setTimeout(r, 5000));

    const analysis = await page.evaluate(() => {
        const results = {
            selectors: {},
            productHtml: [],
            allH2: [],
            allPrices: []
        };

        // Test various selectors
        const selectorTests = [
            'li.product',
            '.product',
            '.products li',
            '.products > *',
            'ul.products li',
            '.woocommerce ul.products li.product',
            '[class*="product"]',
            '.product-item',
            'article.product'
        ];

        for (const sel of selectorTests) {
            try {
                const els = document.querySelectorAll(sel);
                results.selectors[sel] = els.length;
            } catch(e) {
                results.selectors[sel] = 'error';
            }
        }

        // Get raw HTML of first few product-like elements
        const products = document.querySelectorAll('li.product');
        for (let i = 0; i < Math.min(products.length, 2); i++) {
            results.productHtml.push(products[i].outerHTML.substring(0, 1500));
        }

        // Get all h2 elements text
        const h2s = document.querySelectorAll('h2');
        h2s.forEach(h2 => {
            const text = h2.textContent.trim();
            if (text.length > 5) {
                results.allH2.push(text.substring(0, 80));
            }
        });

        // Get all price elements
        const prices = document.querySelectorAll('.price, .woocommerce-Price-amount, [class*="price"]');
        prices.forEach(p => {
            const text = p.textContent.trim();
            if (text.includes('$')) {
                results.allPrices.push(text.substring(0, 30));
            }
        });

        // Look for the main product container
        const mainContent = document.querySelector('.content-area, main, #primary, .site-main');
        if (mainContent) {
            results.mainContentClasses = mainContent.className;
        }

        // Check for WooCommerce container
        const wooContainer = document.querySelector('.woocommerce');
        if (wooContainer) {
            const productsUl = wooContainer.querySelector('ul.products');
            if (productsUl) {
                results.productsUlFound = true;
                results.productsUlChildren = productsUl.children.length;
                results.firstChildTag = productsUl.firstElementChild?.tagName;
                results.firstChildClasses = productsUl.firstElementChild?.className;
            }
        }

        return results;
    });

    console.log('Selector Results:');
    console.log(JSON.stringify(analysis.selectors, null, 2));

    console.log('\nAll H2 Elements:');
    analysis.allH2.slice(0, 10).forEach(h2 => console.log(`  - ${h2}`));

    console.log('\nAll Price Elements:');
    analysis.allPrices.slice(0, 10).forEach(p => console.log(`  - ${p}`));

    console.log('\nProducts UL Container:');
    console.log('  Found:', analysis.productsUlFound);
    console.log('  Children:', analysis.productsUlChildren);
    console.log('  First Child Tag:', analysis.firstChildTag);
    console.log('  First Child Classes:', analysis.firstChildClasses);

    if (analysis.productHtml.length > 0) {
        console.log('\n--- First Product HTML ---');
        console.log(analysis.productHtml[0]);
    }

    await browser.close();
}

debugRadtkeDeep().catch(console.error);
