const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function deleteBoNixDucks() {
    console.log('🗑️  Deleting Bo Nix Oregon Ducks helmet...\n');

    const helmetId = 985;

    try {
        // Get helmet info
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
            console.log(`  Team: ${helmet.team || 'N/A'}`);
            console.log('');
        }

        // Check for prices
        const { data: prices } = await supabase
            .from('helmet_prices')
            .select('*')
            .eq('helmet_id', helmetId);

        if (prices && prices.length > 0) {
            console.log(`Deleting ${prices.length} price records...\n`);
            await supabase
                .from('helmet_prices')
                .delete()
                .eq('helmet_id', helmetId);
        } else {
            console.log('No price records to delete\n');
        }

        // Delete helmet
        console.log('Deleting helmet...');
        await supabase
            .from('helmets')
            .delete()
            .eq('id', helmetId);

        console.log('\n✅ Bo Nix Oregon Ducks helmet deleted successfully\n');

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

deleteBoNixDucks();
