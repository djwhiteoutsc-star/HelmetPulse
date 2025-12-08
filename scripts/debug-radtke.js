const puppeteer = require('puppeteer');

async function debugRadtke() {
    console.log('Debugging Radtke Sports page structure...\n');

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    // Test a specific team URL that should have products
    const url = 'https://www.radtkesports.com/autographed-memorabilia/sports/nfl/kansas-city-chiefs/autographed-authentic-pro-line-helmets/';

    console.log(`Loading: ${url}\n`);

    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
        await new Promise(r => setTimeout(r, 3000));

        const pageTitle = await page.title();
        console.log(`Page Title: ${pageTitle}\n`);

        // Check the URL to make sure we didn't get redirected
        const currentUrl = page.url();
        console.log(`Current URL: ${currentUrl}\n`);

        // Get page content info
        const analysis = await page.evaluate(() => {
            const results = {
                bodyClasses: document.body.className,
                productSelectors: {},
                sampleHtml: '',
                allLinks: []
            };

            // Check various product selectors
            const selectors = [
                '.product',
                '.products .product',
                '.woocommerce-loop-product__link',
                'li.product',
                '.product-item',
                '.product-card',
                '.shop-product',
                '.woo-product',
                'article.product',
                '[class*="product"]',
                '.archive-product',
                '.product-grid-item',
                '.ast-shop-summary-wrap',
                '.astra-shop-summary-wrap'
            ];

            for (const sel of selectors) {
                const els = document.querySelectorAll(sel);
                if (els.length > 0) {
                    results.productSelectors[sel] = els.length;
                }
            }

            // Get sample of product-related HTML
            const mainContent = document.querySelector('main, .content, #content, .site-content, .ast-container');
            if (mainContent) {
                results.sampleHtml = mainContent.innerHTML.substring(0, 5000);
            }

            // Get all links that might be product links
            const links = document.querySelectorAll('a[href*="product"], a[href*="shop"]');
            links.forEach(link => {
                if (link.href && link.textContent.trim()) {
                    results.allLinks.push({
                        href: link.href,
                        text: link.textContent.trim().substring(0, 50)
                    });
                }
            });

            // Look for any elements with product in class name
            const allElements = document.querySelectorAll('*');
            const productClasses = new Set();
            allElements.forEach(el => {
                if (el.className && typeof el.className === 'string') {
                    el.className.split(' ').forEach(cls => {
                        if (cls.toLowerCase().includes('product') ||
                            cls.toLowerCase().includes('shop') ||
                            cls.toLowerCase().includes('item')) {
                            productClasses.add(cls);
                        }
                    });
                }
            });
            results.relevantClasses = Array.from(productClasses).slice(0, 30);

            return results;
        });

        console.log('Body Classes:', analysis.bodyClasses, '\n');
        console.log('Product Selectors Found:');
        console.log(JSON.stringify(analysis.productSelectors, null, 2), '\n');
        console.log('Relevant Classes:', analysis.relevantClasses.join(', '), '\n');

        if (analysis.allLinks.length > 0) {
            console.log('Product-related Links (first 10):');
            analysis.allLinks.slice(0, 10).forEach(link => {
                console.log(`  - ${link.text}: ${link.href}`);
            });
        }

        // Save HTML snippet for analysis
        console.log('\n--- HTML Sample (first 3000 chars) ---\n');
        console.log(analysis.sampleHtml.substring(0, 3000));

    } catch (err) {
        console.log('Error:', err.message);
    }

    await browser.close();
}

debugRadtke().catch(console.error);
