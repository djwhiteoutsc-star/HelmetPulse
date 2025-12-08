const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function checkSpecificHelmets() {
    console.log('🔍 Checking specific helmet IDs for prices...\n');

    const helmetIds = [477, 862];

    try {
        for (const id of helmetIds) {
            console.log(`\n${'='.repeat(60)}`);

            // Get helmet details
            const { data: helmet, error: helmetError } = await supabase
                .from('helmets')
                .select('*')
                .eq('id', id)
                .single();

            if (helmetError) {
                console.log(`❌ Error fetching helmet ${id}: ${helmetError.message}`);
                continue;
            }

            if (!helmet) {
                console.log(`❌ Helmet ID ${id} not found`);
                continue;
            }

            console.log(`Helmet ID: ${id}`);
            console.log(`Name: ${helmet.name.substring(0, 70)}`);
            console.log(`Player: ${helmet.player || 'N/A'}`);
            console.log(`Team: ${helmet.team || 'N/A'}`);

            // Get prices - multiple ways
            console.log('\n--- Checking prices (select *) ---');
            const { data: prices1, error: priceError1 } = await supabase
                .from('helmet_prices')
                .select('*')
                .eq('helmet_id', id);

            console.log(`Prices found: ${prices1?.length || 0}`);
            if (priceError1) console.log(`Error: ${priceError1.message}`);
            if (prices1 && prices1.length > 0) {
                prices1.forEach(p => console.log(`  Price: $${p.median_price}, Source: ${p.source || 'N/A'}`));
            }

            // Try with just ID
            console.log('\n--- Checking prices (select id) ---');
            const { data: prices2, error: priceError2 } = await supabase
                .from('helmet_prices')
                .select('id')
                .eq('helmet_id', id);

            console.log(`Prices found: ${prices2?.length || 0}`);
            if (priceError2) console.log(`Error: ${priceError2.message}`);

            // Count prices
            console.log('\n--- Counting prices ---');
            const { count, error: countError } = await supabase
                .from('helmet_prices')
                .select('*', { count: 'exact', head: true })
                .eq('helmet_id', id);

            console.log(`Count: ${count}`);
            if (countError) console.log(`Error: ${countError.message}`);
        }

        console.log(`\n${'='.repeat(60)}\n`);

        // Also check total helmets without prices using different method
        console.log('--- Checking all helmets without prices ---');

        const { data: allHelmets } = await supabase
            .from('helmets')
            .select('id, name');

        let noPriceCount = 0;
        const noPriceIds = [];

        for (const helmet of allHelmets) {
            const { data: prices } = await supabase
                .from('helmet_prices')
                .select('id')
                .eq('helmet_id', helmet.id);

            if (!prices || prices.length === 0) {
                noPriceCount++;
                noPriceIds.push(helmet.id);
            }
        }

        console.log(`Total helmets without prices: ${noPriceCount}`);
        if (noPriceCount > 0) {
            console.log(`IDs without prices: ${noPriceIds.slice(0, 20).join(', ')}${noPriceCount > 20 ? '...' : ''}`);
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

checkSpecificHelmets();
