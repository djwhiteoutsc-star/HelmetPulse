const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function healthCheck() {
    console.log('═'.repeat(60));
    console.log('  DATABASE HEALTH CHECK');
    console.log('═'.repeat(60));

    // 1. Total counts
    const { count: helmetCount } = await supabase.from('helmets').select('*', { count: 'exact', head: true });
    const { count: priceCount } = await supabase.from('helmet_prices').select('*', { count: 'exact', head: true });
    console.log('\n📊 TOTALS:');
    console.log('   Helmets:', helmetCount);
    console.log('   Prices:', priceCount);

    // 2. Check for helmets missing required fields
    const { data: missingPlayer } = await supabase.from('helmets').select('id').is('player', null);
    const { data: emptyPlayer } = await supabase.from('helmets').select('id').eq('player', '');
    const { data: missingType } = await supabase.from('helmets').select('id').is('helmet_type', null);
    const { data: missingDesign } = await supabase.from('helmets').select('id').is('design_type', null);
    const { data: missingQuery } = await supabase.from('helmets').select('id').is('ebay_search_query', null);

    console.log('\n⚠️  MISSING/EMPTY REQUIRED FIELDS:');
    console.log('   Missing player (null):', missingPlayer?.length || 0);
    console.log('   Empty player (""):', emptyPlayer?.length || 0);
    console.log('   Missing helmet_type:', missingType?.length || 0);
    console.log('   Missing design_type:', missingDesign?.length || 0);
    console.log('   Missing ebay_search_query:', missingQuery?.length || 0);

    // 3. Check helmet_type distribution
    const { data: types } = await supabase.from('helmets').select('helmet_type');
    const typeCounts = {};
    types?.forEach(h => { typeCounts[h.helmet_type || 'NULL'] = (typeCounts[h.helmet_type || 'NULL'] || 0) + 1; });
    console.log('\n📦 HELMET TYPES:');
    Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('   ' + k + ':', v));

    // 4. Check design_type distribution
    const { data: designs } = await supabase.from('helmets').select('design_type');
    const designCounts = {};
    designs?.forEach(h => { designCounts[h.design_type || 'NULL'] = (designCounts[h.design_type || 'NULL'] || 0) + 1; });
    console.log('\n🎨 DESIGN TYPES:');
    Object.entries(designCounts).sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([k, v]) => console.log('   ' + k + ':', v));

    // 5. Check price sources
    const { data: sources } = await supabase.from('helmet_prices').select('source');
    const sourceCounts = {};
    sources?.forEach(p => { sourceCounts[p.source || 'NULL'] = (sourceCounts[p.source || 'NULL'] || 0) + 1; });
    console.log('\n💰 PRICE SOURCES:');
    Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('   ' + k + ':', v));

    // 6. Check for orphaned prices (prices without helmets)
    const { data: allPrices } = await supabase.from('helmet_prices').select('helmet_id');
    const { data: allHelmets } = await supabase.from('helmets').select('id');
    const helmetIds = new Set(allHelmets?.map(h => h.id) || []);
    const orphanedPrices = allPrices?.filter(p => !helmetIds.has(p.helmet_id)) || [];
    console.log('\n🔗 DATA INTEGRITY:');
    console.log('   Orphaned prices (no helmet):', orphanedPrices.length);

    // 7. Check for helmets with NO prices at all
    const priceHelmetIds = new Set(allPrices?.map(p => p.helmet_id) || []);
    const helmetsNoPrices = allHelmets?.filter(h => !priceHelmetIds.has(h.id)) || [];
    console.log('   Helmets with no prices:', helmetsNoPrices.length);

    // 8. Check for potential duplicate helmets (same player+team+type+design)
    const { data: allHelmetsFull } = await supabase.from('helmets').select('player, team, helmet_type, design_type');
    const seen = new Map();
    let dupes = 0;
    const dupeExamples = [];
    allHelmetsFull?.forEach(h => {
        const key = `${h.player}|${h.team}|${h.helmet_type}|${h.design_type}`.toLowerCase();
        if (seen.has(key)) {
            dupes++;
            if (dupeExamples.length < 3) dupeExamples.push(key);
        }
        seen.set(key, true);
    });
    console.log('   Potential duplicates (same player+team+type+design):', dupes);
    if (dupeExamples.length > 0) {
        console.log('   Examples:', dupeExamples.slice(0, 3).join(', '));
    }

    // 9. Check for invalid helmet types
    const validTypes = ['mini', 'midi', 'fullsize-authentic', 'fullsize-replica', 'fullsize-speedflex'];
    const invalidTypes = Object.keys(typeCounts).filter(t => t !== 'NULL' && !validTypes.includes(t));
    if (invalidTypes.length > 0) {
        console.log('\n⚠️  INVALID HELMET TYPES FOUND:');
        invalidTypes.forEach(t => console.log('   ' + t + ':', typeCounts[t]));
    }

    // 10. Sample of helmets with empty player
    if ((emptyPlayer?.length || 0) > 0) {
        const { data: emptyPlayerSamples } = await supabase
            .from('helmets')
            .select('id, name, player, team')
            .eq('player', '')
            .limit(5);
        console.log('\n⚠️  SAMPLE HELMETS WITH EMPTY PLAYER:');
        emptyPlayerSamples?.forEach(h => console.log(`   ID ${h.id}: "${h.name?.substring(0, 50)}"`));
    }

    // Summary
    console.log('\n' + '═'.repeat(60));
    console.log('  SUMMARY');
    console.log('═'.repeat(60));

    const issues = [];
    if ((missingPlayer?.length || 0) + (emptyPlayer?.length || 0) > 0) issues.push('helmets with missing/empty player');
    if ((missingType?.length || 0) > 0) issues.push('helmets with missing type');
    if (orphanedPrices.length > 0) issues.push('orphaned prices');
    if (dupes > 0) issues.push('potential duplicate helmets');
    if (invalidTypes.length > 0) issues.push('invalid helmet types');

    if (issues.length === 0) {
        console.log('\n✅ DATABASE LOOKS GOOD!');
    } else {
        console.log('\n⚠️  ISSUES FOUND:');
        issues.forEach(i => console.log('   - ' + i));
    }

    console.log('\n' + '═'.repeat(60));
}

healthCheck();
