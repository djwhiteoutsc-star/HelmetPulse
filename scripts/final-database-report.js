const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function generateFinalReport() {
    console.log('📊 Generating Final Database Report...\n');

    try {
        // Get all helmets
        const { data: helmets, error } = await supabase
            .from('helmets')
            .select('*')
            .order('id', { ascending: true });

        if (error) throw error;

        console.log('═══════════════════════════════════════');
        console.log('📊 FINAL DATABASE SUMMARY');
        console.log('═══════════════════════════════════════');
        console.log(`Total Helmets: ${helmets.length}\n`);

        // Check for duplicates
        const duplicateCheck = new Map();
        for (const helmet of helmets) {
            const key = `${helmet.player || 'NULL'}|${helmet.team || 'NULL'}|${helmet.helmet_type}|${helmet.design_type}`;
            if (!duplicateCheck.has(key)) {
                duplicateCheck.set(key, []);
            }
            duplicateCheck.get(key).push(helmet);
        }

        const duplicates = Array.from(duplicateCheck.entries())
            .filter(([key, items]) => items.length > 1);

        console.log(`✅ Duplicate Check: ${duplicates.length} duplicate groups found`);

        if (duplicates.length > 0) {
            console.log('\n⚠️  Remaining Duplicates:\n');
            duplicates.forEach(([key, items]) => {
                const [player, team, type, design] = key.split('|');
                console.log(`  • ${player} - ${team} - ${type} - ${design}`);
                console.log(`    IDs: ${items.map(h => h.id).join(', ')}`);
            });
        }

        // Count by helmet type
        const typeCount = {};
        helmets.forEach(h => {
            const type = h.helmet_type || 'unknown';
            typeCount[type] = (typeCount[type] || 0) + 1;
        });

        console.log('\n📋 Breakdown by Helmet Type:');
        console.log('───────────────────────────────────────');
        Object.entries(typeCount)
            .sort((a, b) => b[1] - a[1])
            .forEach(([type, count]) => {
                console.log(`  ${type.padEnd(25)}: ${count}`);
            });

        // Count by auth company
        const authCount = {};
        helmets.forEach(h => {
            const auth = h.auth_company || 'Unknown';
            authCount[auth] = (authCount[auth] || 0) + 1;
        });

        console.log('\n📋 Breakdown by Auth Company:');
        console.log('───────────────────────────────────────');
        Object.entries(authCount)
            .sort((a, b) => b[1] - a[1])
            .forEach(([auth, count]) => {
                console.log(`  ${auth.padEnd(25)}: ${count}`);
            });

        // Count missing data
        let missingPlayer = 0;
        let missingTeam = 0;

        helmets.forEach(h => {
            if (!h.player || h.player.trim() === '') missingPlayer++;
            if (!h.team || h.team.trim() === '') missingTeam++;
        });

        console.log('\n📋 Data Completeness:');
        console.log('───────────────────────────────────────');
        console.log(`  Players filled:  ${helmets.length - missingPlayer} / ${helmets.length} (${((helmets.length - missingPlayer) / helmets.length * 100).toFixed(1)}%)`);
        console.log(`  Teams filled:    ${helmets.length - missingTeam} / ${helmets.length} (${((helmets.length - missingTeam) / helmets.length * 100).toFixed(1)}%)`);

        // Check price coverage
        console.log('\n📋 Price Coverage:');
        console.log('───────────────────────────────────────');

        let helmetsWithPrices = 0;
        let totalPrices = 0;

        for (const helmet of helmets) {
            const { data: prices } = await supabase
                .from('helmet_prices')
                .select('id')
                .eq('helmet_id', helmet.id);

            if (prices && prices.length > 0) {
                helmetsWithPrices++;
                totalPrices += prices.length;
            }
        }

        console.log(`  Helmets with prices: ${helmetsWithPrices} / ${helmets.length} (${(helmetsWithPrices / helmets.length * 100).toFixed(1)}%)`);
        console.log(`  Total price records: ${totalPrices}`);
        console.log(`  Avg prices/helmet:   ${(totalPrices / helmets.length).toFixed(1)}`);

        console.log('\n═══════════════════════════════════════');
        console.log('✅ DATABASE HEALTH: ' + (duplicates.length === 0 ? 'EXCELLENT' : 'NEEDS ATTENTION'));
        console.log('═══════════════════════════════════════\n');

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

generateFinalReport();
