const puppeteer = require('puppeteer');

async function findCorrectUrls() {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    // Check homepage and find helmet collection links
    const sites = [
        { name: 'Radtke', url: 'https://www.radtkesports.com/' },
        { name: 'Denver', url: 'https://www.denverautographs.com/' }
    ];

    for (const site of sites) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Finding helmet URLs on: ${site.name}`);
        console.log('='.repeat(60));

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        await page.setViewport({ width: 1920, height: 1080 });

        try {
            await page.goto(site.url, { waitUntil: 'networkidle2', timeout: 60000 });
            await new Promise(r => setTimeout(r, 2000));

            const title = await page.title();
            console.log(`Page Title: ${title}`);

            // Find all links containing 'helmet'
            const helmetLinks = await page.evaluate(() => {
                const allLinks = Array.from(document.querySelectorAll('a'));
                return allLinks
                    .filter(a => a.href && (
                        a.href.toLowerCase().includes('helmet') ||
                        a.textContent.toLowerCase().includes('helmet')
                    ))
                    .map(a => ({
                        href: a.href,
                        text: a.textContent.trim().substring(0, 60)
                    }))
                    .filter((v, i, arr) => arr.findIndex(x => x.href === v.href) === i)
                    .slice(0, 20);
            });

            console.log('\nHelmet-related links:');
            helmetLinks.forEach(l => console.log(`  ${l.text}: ${l.href}`));

            // Find all category/collection links
            const categoryLinks = await page.evaluate(() => {
                const allLinks = Array.from(document.querySelectorAll('a'));
                return allLinks
                    .filter(a => a.href && (
                        a.href.includes('/product-category/') ||
                        a.href.includes('/category/') ||
                        a.href.includes('/collections/') ||
                        a.href.includes('/shop/')
                    ))
                    .map(a => ({
                        href: a.href,
                        text: a.textContent.trim().substring(0, 60)
                    }))
                    .filter((v, i, arr) => arr.findIndex(x => x.href === v.href) === i)
                    .slice(0, 30);
            });

            console.log('\nCategory/Collection links:');
            categoryLinks.forEach(l => console.log(`  ${l.text}: ${l.href}`));

        } catch (err) {
            console.log(`ERROR: ${err.message}`);
        }

        await page.close();
    }

    await browser.close();
}

findCorrectUrls().catch(console.error);
