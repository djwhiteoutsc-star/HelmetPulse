const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

(async () => {
    // Get all prices
    const { data: prices, count: totalPrices } = await supabase
        .from('helmet_prices')
        .select('helmet_id, source, median_price', { count: 'exact' });

    // Get all helmets
    const { data: helmets, count: totalHelmets } = await supabase
        .from('helmets')
        .select('id', { count: 'exact' });

    const helmetIds = new Set(helmets.map(h => h.id));
    const priceHelmetIds = new Set(prices.map(p => p.helmet_id));

    // Check for orphaned prices (prices pointing to non-existent helmets)
    let orphanedPrices = 0;
    for (const p of prices) {
        if (!helmetIds.has(p.helmet_id)) orphanedPrices++;
    }

    // Count unique helmets with prices
    const helmetsWithPrices = [...priceHelmetIds].filter(id => helmetIds.has(id)).length;

    console.log('=== PRICE DEBUG ===');
    console.log('Total helmets:', totalHelmets);
    console.log('Total price records:', totalPrices);
    console.log('Unique helmet_ids in prices:', priceHelmetIds.size);
    console.log('Helmets with valid prices:', helmetsWithPrices);
    console.log('Orphaned price records:', orphanedPrices);

    if (helmets.length > 0) {
        const minHelmetId = Math.min(...helmetIds);
        const maxHelmetId = Math.max(...helmetIds);
        console.log('Helmet ID range:', minHelmetId, 'to', maxHelmetId);
    }

    if (prices.length > 0) {
        const minPriceId = Math.min(...priceHelmetIds);
        const maxPriceId = Math.max(...priceHelmetIds);
        console.log('Price helmet_id range:', minPriceId, 'to', maxPriceId);
    }

    // Sample some prices
    console.log('\nSample prices:');
    for (let i = 0; i < 5 && i < prices.length; i++) {
        const p = prices[i];
        const valid = helmetIds.has(p.helmet_id) ? 'VALID' : 'ORPHANED';
        console.log(`  helmet_id: ${p.helmet_id}, source: ${p.source}, price: ${p.median_price} [${valid}]`);
    }
})();
