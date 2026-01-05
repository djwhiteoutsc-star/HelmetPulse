const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function countHelmets() {
    console.log('📊 Counting helmets in database...\n');

    try {
        // Get all helmets
        const { data: allHelmets, error: allError } = await supabase
            .from('helmets')
            .select('helmet_type');

        if (allError) throw allError;

        // Count by type
        const counts = {
            total: allHelmets.length,
            authentic: 0,
            mini: 0,
            replica: 0,
            other: 0
        };

        allHelmets.forEach(helmet => {
            const type = helmet.helmet_type?.toLowerCase();
            if (type === 'mini') {
                counts.mini++;
            } else if (type === 'authentic' || type === 'fullsize-authentic') {
                counts.authentic++;
            } else if (type === 'replica' || type === 'fullsize-replica') {
                counts.replica++;
            } else {
                counts.other++;
            }
        });

        console.log('═══════════════════════════════════════');
        console.log('📊 HELMET DATABASE SUMMARY');
        console.log('═══════════════════════════════════════');
        console.log(`Total Helmets:        ${counts.total}`);
        console.log('───────────────────────────────────────');
        console.log(`Full Size (Authentic): ${counts.authentic}`);
        console.log(`Full Size (Replica):   ${counts.replica}`);
        console.log(`Mini Helmets:          ${counts.mini}`);
        console.log(`Other/Unspecified:     ${counts.other}`);
        console.log('═══════════════════════════════════════\n');

        // Get source breakdown
        const { data: helmetsWithSource, error: sourceError } = await supabase
            .from('helmets')
            .select('auth_company, helmet_type');

        if (!sourceError && helmetsWithSource) {
            const sourceCount = {};
            helmetsWithSource.forEach(h => {
                const source = h.auth_company || 'Unknown';
                sourceCount[source] = (sourceCount[source] || 0) + 1;
            });

            console.log('📋 Breakdown by Source:');
            console.log('───────────────────────────────────────');
            Object.entries(sourceCount)
                .sort((a, b) => b[1] - a[1])
                .forEach(([source, count]) => {
                    console.log(`${source.padEnd(20)}: ${count}`);
                });
            console.log('═══════════════════════════════════════\n');
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

countHelmets();
