const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function deleteHelmet() {
    console.log('🗑️  Deleting Josh Allen helmet ID 477...\n');

    const helmetId = 477;

    try {
        // Get helmet info first
        const { data: helmet } = await supabase
            .from('helmets')
            .select('*')
            .eq('id', helmetId)
            .single();

        if (helmet) {
            console.log('Helmet to delete:');
            console.log(`  ID: ${helmet.id}`);
            console.log(`  Name: ${helmet.name}`);
            console.log(`  Player: ${helmet.player}`);
            console.log(`  Team: ${helmet.team}`);
            console.log('');
        }

        // Get prices
        const { data: prices } = await supabase
            .from('helmet_prices')
            .select('*')
            .eq('helmet_id', helmetId);

        if (prices && prices.length > 0) {
            console.log(`Prices to delete: ${prices.length}`);
            prices.forEach(p => {
                console.log(`  - $${p.median_price} (Source: ${p.source || 'N/A'})`);
            });
            console.log('');
        }

        // Delete prices first (foreign key constraint)
        console.log('Deleting price records...');
        const { error: deletePricesError } = await supabase
            .from('helmet_prices')
            .delete()
            .eq('helmet_id', helmetId);

        if (deletePricesError) throw deletePricesError;
        console.log(`✅ Deleted ${prices?.length || 0} price records\n`);

        // Delete helmet
        console.log('Deleting helmet record...');
        const { error: deleteHelmetError } = await supabase
            .from('helmets')
            .delete()
            .eq('id', helmetId);

        if (deleteHelmetError) throw deleteHelmetError;
        console.log('✅ Deleted helmet record\n');

        console.log('═══════════════════════════════════════');
        console.log('✅ DELETION COMPLETE');
        console.log('═══════════════════════════════════════');
        console.log('Helmet ID 477 has been removed from the database');
        console.log('═══════════════════════════════════════\n');

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

deleteHelmet();
