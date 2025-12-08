const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function reviewBoNix() {
    console.log('🔍 Reviewing all Bo Nix helmets...\n');

    try {
        // Search for all Bo Nix helmets
        const { data: helmets, error: searchError } = await supabase
            .from('helmets')
            .select('*')
            .or('name.ilike.%bo%nix%,player.ilike.%bo%nix%')
            .order('id', { ascending: true });

        if (searchError) throw searchError;

        if (!helmets || helmets.length === 0) {
            console.log('❌ No Bo Nix helmets found');
            return;
        }

        console.log(`Found ${helmets.length} Bo Nix helmet(s):\n`);
        console.log('═'.repeat(80));

        for (const helmet of helmets) {
            // Get prices for this helmet
            const { data: prices } = await supabase
                .from('helmet_prices')
                .select('*')
                .eq('helmet_id', helmet.id)
                .order('created_at', { ascending: false });

            console.log(`\nID: ${helmet.id}`);
            console.log(`Name: ${helmet.name}`);
            console.log(`Player: ${helmet.player || 'N/A'}`);
            console.log(`Team: ${helmet.team || 'N/A'}`);
            console.log(`─────────────────────────────────────────────`);
            console.log(`Helmet Type: ${helmet.helmet_type || 'N/A'}`);
            console.log(`Design Type: ${helmet.design_type || 'N/A'}`);
            console.log(`Auth Company: ${helmet.auth_company || 'N/A'}`);
            console.log(`─────────────────────────────────────────────`);

            if (prices && prices.length > 0) {
                console.log(`Prices (${prices.length} records):`);
                prices.forEach((p, i) => {
                    console.log(`  ${i + 1}. $${p.median_price} (min: $${p.min_price}, max: $${p.max_price})`);
                    console.log(`     Source: ${p.source || 'N/A'}, Results: ${p.total_results || 0}`);
                });
            } else {
                console.log('No prices found');
            }

            console.log('═'.repeat(80));
        }

        console.log('\n📊 SUMMARY BY CATEGORY:\n');

        const categorySummary = {};
        helmets.forEach(h => {
            const key = `${h.helmet_type || 'unknown'} / ${h.design_type || 'unknown'}`;
            categorySummary[key] = (categorySummary[key] || 0) + 1;
        });

        Object.entries(categorySummary).forEach(([category, count]) => {
            console.log(`  ${category}: ${count} helmet(s)`);
        });

        console.log('\n⚠️  ISSUES FOUND:\n');

        const issues = [];
        helmets.forEach(h => {
            // Check for "mini authentic" combination
            if (h.helmet_type === 'mini' && h.design_type === 'authentic') {
                issues.push({
                    id: h.id,
                    name: h.name.substring(0, 60),
                    issue: 'Mini + Authentic combination (should probably be "mini" type with different design)'
                });
            }
            // Check for confusing combinations
            if (h.helmet_type === 'authentic' && h.design_type === 'mini') {
                issues.push({
                    id: h.id,
                    name: h.name.substring(0, 60),
                    issue: 'Authentic + Mini combination (reversed?)'
                });
            }
        });

        if (issues.length > 0) {
            issues.forEach(issue => {
                console.log(`  ⚠️  ID ${issue.id}: ${issue.name}...`);
                console.log(`      ${issue.issue}\n`);
            });
        } else {
            console.log('  ✅ No categorization issues detected\n');
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

reviewBoNix();
