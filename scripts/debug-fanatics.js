const puppeteer = require('puppeteer');

async function debugFanatics() {
    console.log('🔍 Debugging Fanatics page structure...\n');

    const browser = await puppeteer.launch({
        headless: false, // Show browser for debugging
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    // Set US locale cookies BEFORE navigation
    await page.setCookie(
        { name: 'GlobalE_Data', value: '{"countryISO":"US","cultureCode":"en-US","currencyCode":"USD"}', domain: '.fanatics.com' },
        { name: 'GlobalE_CT_Data', value: '{"GLBE_GEO":{"countryISO":"US"}}', domain: '.fanatics.com' },
        { name: 'country_code', value: 'US', domain: '.fanatics.com' }
    );

    // Set extra headers
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
    });

    // Disable webdriver detection
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        Object.defineProperty(navigator, 'language', { get: () => 'en-US' });
    });

    const url = 'https://www.fanatics.com/search/NFL%20autographed%20helmet';
    console.log(`Loading: ${url}\n`);

    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        console.log('Page loaded, waiting for content...\n');

        // Wait a bit for dynamic content
        await new Promise(r => setTimeout(r, 5000));

        // Scroll the page to load lazy content
        await page.evaluate(async () => {
            for (let i = 0; i < 8; i++) {
                window.scrollBy(0, 600);
                await new Promise(r => setTimeout(r, 400));
            }
            window.scrollTo(0, 0);
        });
        await new Promise(r => setTimeout(r, 2000));

        // Get page title
        const title = await page.title();
        console.log(`Page title: ${title}\n`);

        // Check for common blockers/challenges
        const pageContent = await page.content();
        if (pageContent.includes('Access Denied') || pageContent.includes('blocked')) {
            console.log('⚠️ Page appears to be blocked!\n');
        }

        // Analyze page structure
        const analysis = await page.evaluate(() => {
            const results = {
                bodyClasses: document.body.className,
                mainSelectors: [],
                productCards: [],
                allLinks: [],
                dataAttributes: []
            };

            // Check for various product container patterns
            const selectors = [
                '[data-talos="product-card"]',
                '.product-card',
                '[class*="ProductCard"]',
                '[class*="product-image"]',
                '[class*="ProductImage"]',
                '.plp-products',
                '[data-trk-id]',
                '.product-grid',
                '[class*="Grid"]',
                'article',
                '[role="listitem"]',
                'li[class*="product"]'
            ];

            selectors.forEach(sel => {
                const els = document.querySelectorAll(sel);
                if (els.length > 0) {
                    results.mainSelectors.push({ selector: sel, count: els.length });
                }
            });

            // Get all unique class names that might be product-related
            const allElements = document.querySelectorAll('*');
            const productRelatedClasses = new Set();
            allElements.forEach(el => {
                if (el.className && typeof el.className === 'string') {
                    const classes = el.className.split(' ');
                    classes.forEach(cls => {
                        if (cls.toLowerCase().includes('product') ||
                            cls.toLowerCase().includes('card') ||
                            cls.toLowerCase().includes('item') ||
                            cls.toLowerCase().includes('grid')) {
                            productRelatedClasses.add(cls);
                        }
                    });
                }
            });
            results.productClasses = Array.from(productRelatedClasses).slice(0, 30);

            // Look for any links containing "helmet"
            const helmetLinks = document.querySelectorAll('a[href*="helmet"]');
            helmetLinks.forEach(link => {
                results.allLinks.push({
                    text: link.textContent?.trim().substring(0, 50),
                    href: link.href.substring(0, 80)
                });
            });

            // Get any data attributes
            document.querySelectorAll('[data-talos], [data-trk]').forEach(el => {
                const attrs = {};
                for (const attr of el.attributes) {
                    if (attr.name.startsWith('data-')) {
                        attrs[attr.name] = attr.value.substring(0, 30);
                    }
                }
                if (Object.keys(attrs).length > 0) {
                    results.dataAttributes.push(attrs);
                }
            });
            results.dataAttributes = results.dataAttributes.slice(0, 10);

            // Get outer HTML of first potential product
            const firstProduct = document.querySelector('[class*="product"], [class*="Product"], article, [role="listitem"]');
            if (firstProduct) {
                results.sampleProductHTML = firstProduct.outerHTML.substring(0, 1000);
            }

            return results;
        });

        console.log('📊 Page Analysis:\n');
        console.log('Body classes:', analysis.bodyClasses?.substring(0, 100));
        console.log('\nMatching selectors:');
        analysis.mainSelectors.forEach(s => console.log(`  ${s.selector}: ${s.count} elements`));

        console.log('\nProduct-related classes found:');
        console.log(analysis.productClasses?.join(', '));

        console.log('\nHelmet links found:', analysis.allLinks?.length || 0);
        analysis.allLinks?.slice(0, 5).forEach(l => console.log(`  ${l.text} -> ${l.href}`));

        console.log('\nData attributes:');
        analysis.dataAttributes?.slice(0, 5).forEach(a => console.log(`  ${JSON.stringify(a)}`));

        if (analysis.sampleProductHTML) {
            console.log('\nSample product HTML:');
            console.log(analysis.sampleProductHTML.substring(0, 500));
        }

        // Take a screenshot for reference
        await page.screenshot({ path: 'fanatics-debug.png', fullPage: false });
        console.log('\n📸 Screenshot saved to fanatics-debug.png');

        // Keep browser open for manual inspection
        console.log('\n⏳ Browser will stay open for 30 seconds for manual inspection...');
        await new Promise(r => setTimeout(r, 30000));

    } catch (error) {
        console.log('Error:', error.message);
    }

    await browser.close();
    console.log('\n✅ Debug complete');
}

debugFanatics().catch(console.error);
