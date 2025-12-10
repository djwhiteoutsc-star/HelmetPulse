const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

(async () => {
    // Count prices by source
    const { data: fanatics } = await supabase
        .from('helmet_prices')
        .select('helmet_id, median_price')
        .eq('source', 'fanatics');

    const { data: ebay } = await supabase
        .from('helmet_prices')
        .select('helmet_id')
        .eq('source', 'ebay');

    const { data: rsa } = await supabase
        .from('helmet_prices')
        .select('helmet_id')
        .eq('source', 'rsa');

    const fanaticsIds = new Set(fanatics.map(p => p.helmet_id));
    const ebayIds = new Set(ebay.map(p => p.helmet_id));
    const rsaIds = new Set(rsa.map(p => p.helmet_id));

    console.log('=== PRICES BY SOURCE ===');
    console.log('Fanatics prices:', fanatics.length, '(unique helmets:', fanaticsIds.size + ')');
    console.log('eBay prices:', ebay.length, '(unique helmets:', ebayIds.size + ')');
    console.log('RSA prices:', rsa.length, '(unique helmets:', rsaIds.size + ')');

    // Sample Fanatics prices
    console.log('\nSample Fanatics prices:');
    for (let i = 0; i < 10 && i < fanatics.length; i++) {
        console.log(`  helmet_id: ${fanatics[i].helmet_id}, price: $${fanatics[i].median_price}`);
    }

    // Get some helmets without Fanatics prices
    const { data: helmets } = await supabase
        .from('helmets')
        .select('id, player, team, helmet_type, design_type')
        .limit(20);

    console.log('\nSample helmets and their Fanatics status:');
    for (const h of helmets) {
        const hasFanatics = fanaticsIds.has(h.id);
        console.log(`  ${h.id}: ${h.player} - ${h.team} ${h.helmet_type} ${h.design_type} [Fanatics: ${hasFanatics ? 'YES' : 'NO'}]`);
    }
})();
