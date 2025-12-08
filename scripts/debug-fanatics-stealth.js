const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteerExtra.use(StealthPlugin());

async function debugFanaticsStealth() {
    console.log('🔍 Debugging Fanatics with Stealth Plugin...\n');

    const browser = await puppeteerExtra.launch({
        headless: false, // Show browser for debugging
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-web-security'
        ]
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    // Set US locale cookies
    await page.setCookie(
        { name: 'GlobalE_Data', value: '{"countryISO":"US","cultureCode":"en-US","currencyCode":"USD"}', domain: '.fanatics.com' },
        { name: 'GlobalE_CT_Data', value: '{"GLBE_GEO":{"countryISO":"US"}}', domain: '.fanatics.com' },
        { name: 'country_code', value: 'US', domain: '.fanatics.com' }
    );

    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
    });

    const url = 'https://www.fanatics.com/search/NFL%20autographed%20helmet';
    console.log(`Loading: ${url}\n`);

    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        console.log('✅ Page loaded\n');

        // Wait for dynamic content
        await new Promise(r => setTimeout(r, 5000));

        // Scroll to load lazy content
        await page.evaluate(async () => {
            for (let i = 0; i < 8; i++) {
                window.scrollBy(0, 600);
                await new Promise(r => setTimeout(r, 400));
            }
            window.scrollTo(0, 0);
        });
        await new Promise(r => setTimeout(r, 3000));

        // Get page title
        const title = await page.title();
        console.log(`Page title: ${title}\n`);

        // Check if blocked
        const pageContent = await page.content();
        if (pageContent.includes('Access Denied') || pageContent.includes('blocked') || pageContent.includes('captcha')) {
            console.log('⚠️ Page appears to be blocked or has CAPTCHA!\n');
        } else {
            console.log('✅ No block/CAPTCHA detected\n');
        }

        // Analyze selectors
        const analysis = await page.evaluate(() => {
            const selectors = [
                '[data-talos="product-card"]',
                '.product-card',
                '[class*="ProductCard"]',
                '[class*="product-image"]',
                '[class*="product-grid"]',
                '[class*="ProductGrid"]',
                'article',
                '[role="listitem"]',
                '[class*="search-result"]',
                '[data-product-id]'
            ];

            const results = {
                selectorCounts: {},
                allProductClasses: [],
                sampleHTML: '',
                hasProducts: false
            };

            selectors.forEach(sel => {
                const count = document.querySelectorAll(sel).length;
                if (count > 0) {
                    results.selectorCounts[sel] = count;
                }
            });

            // Find all elements with "product" in class name
            const productEls = document.querySelectorAll('[class*="product"], [class*="Product"]');
            results.productElementsCount = productEls.length;

            if (productEls.length > 0) {
                const first = productEls[0];
                results.sampleHTML = first.outerHTML.substring(0, 1000);
                results.firstProductClasses = first.className;

                // Try to extract title and price from first product
                const titleEl = first.querySelector('a[href*="/product/"]') ||
                              first.querySelector('[class*="title"]') ||
                              first.querySelector('h1, h2, h3, h4');
                const priceEl = first.querySelector('[class*="price"], [class*="Price"]');

                results.sampleTitle = titleEl ? titleEl.textContent.trim().substring(0, 100) : 'NO TITLE';
                results.samplePrice = priceEl ? priceEl.textContent.trim() : 'NO PRICE';
            }

            // Look for helmet links
            const helmetLinks = document.querySelectorAll('a[href*="helmet"]');
            results.helmetLinksCount = helmetLinks.length;

            return results;
        });

        console.log('📊 Page Analysis:');
        console.log(`  Product elements found: ${analysis.productElementsCount}`);
        console.log(`  Helmet links found: ${analysis.helmetLinksCount}`);
        console.log('  \nSelector matches:');
        Object.entries(analysis.selectorCounts).forEach(([sel, count]) => {
            console.log(`    ${sel}: ${count}`);
        });

        if (analysis.sampleHTML) {
            console.log('\n  First product element classes:', analysis.firstProductClasses);
            console.log('  Sample title:', analysis.sampleTitle);
            console.log('  Sample price:', analysis.samplePrice);
            console.log('\n  First product HTML (first 500 chars):');
            console.log(analysis.sampleHTML.substring(0, 500));
        }

        // Take a screenshot
        await page.screenshot({ path: 'fanatics-stealth-debug.png', fullPage: false });
        console.log('\n📸 Screenshot saved to fanatics-stealth-debug.png');

        // Keep browser open for inspection
        console.log('\n⏳ Browser will stay open for 60 seconds for manual inspection...');
        await new Promise(r => setTimeout(r, 60000));

    } catch (error) {
        console.log('❌ Error:', error.message);
    }

    await browser.close();
    console.log('\n✅ Debug complete');
}

debugFanaticsStealth().catch(console.error);
