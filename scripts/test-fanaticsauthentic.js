const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteerExtra.use(StealthPlugin());

async function testFanaticsAuthentic() {
    console.log('🧪 Testing FanaticsAuthentic.com...\n');

    const browser = await puppeteerExtra.launch({
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ]
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });

    await page.setCookie(
        { name: 'GlobalE_Data', value: '{"countryISO":"US","cultureCode":"en-US","currencyCode":"USD"}', domain: '.fanaticsauthentic.com' },
        { name: 'country_code', value: 'US', domain: '.fanaticsauthentic.com' }
    );

    const url = 'https://www.fanaticsauthentic.com/search/NFL%20helmet';
    console.log(`Loading: ${url}\n`);

    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        console.log('✅ Page loaded\n');

        await new Promise(r => setTimeout(r, 5000));

        // Scroll
        await page.evaluate(async () => {
            for (let i = 0; i < 8; i++) {
                window.scrollBy(0, 600);
                await new Promise(r => setTimeout(r, 400));
            }
            window.scrollTo(0, 0);
        });
        await new Promise(r => setTimeout(r, 2000));

        const title = await page.title();
        console.log(`Page title: ${title}\n`);

        const pageContent = await page.content();
        if (pageContent.includes('Access Denied') || pageContent.includes('blocked') || pageContent.includes('captcha')) {
            console.log('⚠️ Page blocked/CAPTCHA detected\n');
        } else {
            console.log('✅ No block detected\n');
        }

        const analysis = await page.evaluate(() => {
            const selectors = [
                '[data-talos="product-card"]',
                '.product-card',
                '[class*="ProductCard"]',
                'article',
                '[role="listitem"]'
            ];

            const results = {
                selectorCounts: {},
                products: []
            };

            selectors.forEach(sel => {
                const count = document.querySelectorAll(sel).length;
                if (count > 0) {
                    results.selectorCounts[sel] = count;
                }
            });

            // Find products
            const productEls = document.querySelectorAll('[class*="product"], [class*="Product"]');
            productEls.forEach((el, i) => {
                if (i < 5) {
                    const titleEl = el.querySelector('a[href*="/product/"]') || el.querySelector('[class*="title"]');
                    const priceEl = el.querySelector('[class*="price"], [class*="Price"]');
                    const title = titleEl ? titleEl.textContent.trim() : '';
                    const price = priceEl ? priceEl.textContent.trim() : '';

                    if (title && price) {
                        results.products.push({ title: title.substring(0, 80), price });
                    }
                }
            });

            return results;
        });

        console.log('📊 Analysis:');
        console.log('  Selector matches:', JSON.stringify(analysis.selectorCounts, null, 2));
        console.log(`\n  Found ${analysis.products.length} products with title+price:`);
        analysis.products.forEach((p, i) => {
            console.log(`    ${i + 1}. ${p.price} - ${p.title}`);
        });

        await page.screenshot({ path: 'fanaticsauthentic-test.png' });
        console.log('\n📸 Screenshot saved');

        console.log('\n⏳ Keeping browser open for 30 seconds...');
        await new Promise(r => setTimeout(r, 30000));

    } catch (error) {
        console.log('❌ Error:', error.message);
    }

    await browser.close();
    console.log('\n✅ Test complete');
}

testFanaticsAuthentic().catch(console.error);
