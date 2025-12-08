const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function countHelmetsWithoutPrices() {
    console.log('🔍 Checking for helmets without prices...\n');

    try {
        // Get all helmets
        const { data: allHelmets, error: helmetsError } = await supabase
            .from('helmets')
            .select('id, name, player, team, helmet_type, auth_company');

        if (helmetsError) throw helmetsError;

        console.log(`Total helmets in database: ${allHelmets.length}\n`);

        // Check each helmet for prices
        let noPriceCount = 0;
        const noPriceHelmets = [];

        for (const helmet of allHelmets) {
            const { data: prices, error: priceError } = await supabase
                .from('helmet_prices')
                .select('id')
                .eq('helmet_id', helmet.id);

            if (!priceError && (!prices || prices.length === 0)) {
                noPriceCount++;
                noPriceHelmets.push(helmet);
            }
        }

        console.log('═══════════════════════════════════════');
        console.log('📊 PRICE COVERAGE SUMMARY');
        console.log('═══════════════════════════════════════');
        console.log(`Total helmets:           ${allHelmets.length}`);
        console.log(`Helmets with prices:     ${allHelmets.length - noPriceCount}`);
        console.log(`Helmets WITHOUT prices:  ${noPriceCount}`);
        console.log(`Coverage:                ${((allHelmets.length - noPriceCount) / allHelmets.length * 100).toFixed(1)}%`);
        console.log('═══════════════════════════════════════\n');

        if (noPriceCount > 0) {
            console.log(`\n📋 Sample helmets without prices (showing first 20):\n`);
            noPriceHelmets.slice(0, 20).forEach((h, i) => {
                console.log(`${(i + 1).toString().padStart(2)}. [ID ${h.id}] ${h.name.substring(0, 70)}`);
                console.log(`    Type: ${h.helmet_type || 'N/A'} | Auth: ${h.auth_company || 'N/A'}\n`);
            });

            if (noPriceCount > 20) {
                console.log(`    ... and ${noPriceCount - 20} more\n`);
            }
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

countHelmetsWithoutPrices();
