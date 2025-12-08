const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function deleteInvalidFanatics() {
    console.log('🗑️  Deleting Fanatics helmets without Fanatics prices...\n');

    try {
        // Get all Fanatics helmets
        const { data: fanaticsHelmets, error: helmetsError } = await supabase
            .from('helmets')
            .select('*')
            .eq('auth_company', 'Fanatics')
            .order('id', { ascending: true });

        if (helmetsError) throw helmetsError;

        console.log(`Found ${fanaticsHelmets?.length || 0} Fanatics helmets\n`);

        // Find ones without Fanatics prices
        const toDelete = [];

        for (const helmet of fanaticsHelmets) {
            const { data: prices } = await supabase
                .from('helmet_prices')
                .select('*')
                .eq('helmet_id', helmet.id)
                .eq('source', 'fanatics');

            if (!prices || prices.length === 0) {
                toDelete.push(helmet);
            }
        }

        console.log(`Found ${toDelete.length} helmets to delete (no Fanatics prices)\n`);

        if (toDelete.length === 0) {
            console.log('✅ No invalid helmets to delete\n');
            return;
        }

        console.log('Helmets to delete:\n');
        toDelete.forEach((h, i) => {
            console.log(`  ${i + 1}. ID ${h.id}: ${h.name.substring(0, 60)}...`);
        });
        console.log('');

        // Delete them
        console.log('Deleting helmets...\n');

        let deleted = 0;
        let pricesDeleted = 0;

        for (const helmet of toDelete) {
            // Check if helmet has any prices from other sources
            const { data: allPrices } = await supabase
                .from('helmet_prices')
                .select('*')
                .eq('helmet_id', helmet.id);

            if (allPrices && allPrices.length > 0) {
                // Delete all prices first
                const { error: deletePricesError } = await supabase
                    .from('helmet_prices')
                    .delete()
                    .eq('helmet_id', helmet.id);

                if (deletePricesError) {
                    console.log(`  ❌ Error deleting prices for ID ${helmet.id}: ${deletePricesError.message}`);
                    continue;
                }
                pricesDeleted += allPrices.length;
            }

            // Delete helmet
            const { error: deleteHelmetError } = await supabase
                .from('helmets')
                .delete()
                .eq('id', helmet.id);

            if (deleteHelmetError) {
                console.log(`  ❌ Error deleting ID ${helmet.id}: ${deleteHelmetError.message}`);
            } else {
                console.log(`  ✅ Deleted ID ${helmet.id}`);
                deleted++;
            }
        }

        console.log('\n═══════════════════════════════════════');
        console.log('✅ DELETION COMPLETE');
        console.log('═══════════════════════════════════════');
        console.log(`Helmets deleted:      ${deleted}`);
        console.log(`Price records deleted: ${pricesDeleted}`);
        console.log('═══════════════════════════════════════\n');

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

deleteInvalidFanatics();
