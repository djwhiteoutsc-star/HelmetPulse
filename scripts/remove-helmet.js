const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function removeHelmet() {
    console.log('🔍 Searching for Josh Allen Bills Mini helmet...\n');

    try {
        // Search for Josh Allen Bills helmets
        const { data: helmets, error: searchError } = await supabase
            .from('helmets')
            .select('*')
            .ilike('player', '%josh%allen%')
            .ilike('team', '%bills%')
            .eq('helmet_type', 'mini');

        if (searchError) throw searchError;

        if (!helmets || helmets.length === 0) {
            console.log('❌ No matching helmets found');
            return;
        }

        console.log(`Found ${helmets.length} matching helmet(s):\n`);

        for (const helmet of helmets) {
            // Get prices for this helmet
            const { data: prices, error: priceError } = await supabase
                .from('helmet_prices')
                .select('*')
                .eq('helmet_id', helmet.id)
                .order('created_at', { ascending: false });

            console.log('─────────────────────────────────────');
            console.log(`ID: ${helmet.id}`);
            console.log(`Name: ${helmet.name}`);
            console.log(`Player: ${helmet.player}`);
            console.log(`Team: ${helmet.team}`);
            console.log(`Type: ${helmet.helmet_type}`);
            console.log(`Auth: ${helmet.auth_company}`);

            if (prices && prices.length > 0) {
                console.log(`\nPrices (${prices.length} records):`);
                prices.slice(0, 3).forEach((p, i) => {
                    console.log(`  ${i + 1}. $${p.median_price} (min: $${p.min_price}, max: $${p.max_price}) - Source: ${p.source || 'N/A'}`);
                });
            } else {
                console.log('\nNo prices found');
            }
        }

        console.log('─────────────────────────────────────\n');

        if (helmets.length === 1) {
            const helmet = helmets[0];
            console.log(`\n🗑️  Deleting helmet ID ${helmet.id}...\n`);

            // Delete prices first (foreign key constraint)
            const { error: deletePricesError } = await supabase
                .from('helmet_prices')
                .delete()
                .eq('helmet_id', helmet.id);

            if (deletePricesError) throw deletePricesError;
            console.log('✅ Deleted price records');

            // Delete helmet
            const { error: deleteHelmetError } = await supabase
                .from('helmets')
                .delete()
                .eq('id', helmet.id);

            if (deleteHelmetError) throw deleteHelmetError;
            console.log('✅ Deleted helmet record');

            console.log('\n✅ Helmet successfully removed from database');
        } else {
            console.log('⚠️  Multiple helmets found. Please specify which one to delete.');
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

removeHelmet();
