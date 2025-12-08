const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function findJoshAllen() {
    console.log('🔍 Searching for ALL Josh Allen helmets...\n');

    try {
        // Search for all Josh Allen helmets
        const { data: helmets, error: searchError } = await supabase
            .from('helmets')
            .select('*')
            .ilike('name', '%josh%allen%');

        if (searchError) throw searchError;

        if (!helmets || helmets.length === 0) {
            console.log('❌ No matching helmets found');
            return;
        }

        console.log(`Found ${helmets.length} Josh Allen helmet(s):\n`);

        for (const helmet of helmets) {
            // Get prices for this helmet
            const { data: prices, error: priceError } = await supabase
                .from('helmet_prices')
                .select('*')
                .eq('helmet_id', helmet.id)
                .order('created_at', { ascending: false });

            console.log('═════════════════════════════════════════════════════════════');
            console.log(`ID: ${helmet.id}`);
            console.log(`Name: ${helmet.name.substring(0, 80)}`);
            console.log(`Player: ${helmet.player || 'N/A'}`);
            console.log(`Team: ${helmet.team || 'N/A'}`);
            console.log(`Helmet Type: ${helmet.helmet_type || 'N/A'}`);
            console.log(`Design Type: ${helmet.design_type || 'N/A'}`);
            console.log(`Auth Company: ${helmet.auth_company || 'N/A'}`);

            if (prices && prices.length > 0) {
                console.log(`\n💰 Prices (${prices.length} records):`);
                prices.forEach((p, i) => {
                    console.log(`  ${i + 1}. $${p.median_price} (min: $${p.min_price}, max: $${p.max_price})`);
                    console.log(`     Source: ${p.source || 'N/A'}, Results: ${p.total_results || 0}`);
                });
            } else {
                console.log('\n💰 No prices found');
            }
        }

        console.log('═════════════════════════════════════════════════════════════\n');

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

findJoshAllen();
