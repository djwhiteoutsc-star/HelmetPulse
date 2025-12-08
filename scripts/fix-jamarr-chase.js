const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function fixJaMarrChase() {
    console.log('🔧 Fixing Ja\'Marr Chase name variations...\n');

    try {
        // Find all variations of Ja'Marr Chase
        const { data: helmets, error } = await supabase
            .from('helmets')
            .select('*')
            .or('player.ilike.%marr%chase%,name.ilike.%marr%chase%');

        if (error) throw error;

        console.log(`Found ${helmets?.length || 0} helmets with "Marr Chase"\n`);

        let fixed = 0;

        for (const helmet of helmets || []) {
            const currentPlayer = helmet.player || '';

            // Check if it's a variation that needs fixing
            if (currentPlayer.toLowerCase().includes('marr') &&
                currentPlayer.toLowerCase().includes('chase') &&
                currentPlayer !== "Ja'Marr Chase") {

                console.log(`  ID ${helmet.id}: "${currentPlayer}" → "Ja'Marr Chase"`);

                await supabase
                    .from('helmets')
                    .update({ player: "Ja'Marr Chase" })
                    .eq('id', helmet.id);

                fixed++;
            }
        }

        console.log('\n═══════════════════════════════════════');
        console.log('✅ NAME STANDARDIZATION COMPLETE');
        console.log('═══════════════════════════════════════');
        console.log(`Player names fixed: ${fixed}`);
        console.log('═══════════════════════════════════════\n');

        // Show all Ja'Marr Chase helmets now
        const { data: allChase } = await supabase
            .from('helmets')
            .select('id, name, player, team, helmet_type, design_type')
            .eq('player', "Ja'Marr Chase")
            .order('id', { ascending: true });

        console.log(`📋 All Ja'Marr Chase helmets (${allChase?.length || 0} total):\n`);

        allChase?.forEach(h => {
            console.log(`  ID ${h.id}: ${h.team} - ${h.helmet_type} - ${h.design_type}`);
        });

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

fixJaMarrChase();
