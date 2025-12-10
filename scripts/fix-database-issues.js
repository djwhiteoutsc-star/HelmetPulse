/**
 * Fix Database Issues
 *
 * Automatically fixes common database consistency issues:
 * - Removes orphaned price records
 * - Fixes invalid player names
 * - Merges duplicate helmets
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function removeOrphanedPrices() {
    console.log('\n=== Removing Orphaned Prices ===');

    const { data: prices } = await supabase
        .from('helmet_prices')
        .select('id, helmet_id');

    const { data: helmets } = await supabase
        .from('helmets')
        .select('id');

    const helmetIds = new Set(helmets.map(h => h.id));
    const orphaned = prices.filter(p => !helmetIds.has(p.helmet_id));

    if (orphaned.length === 0) {
        console.log('✓ No orphaned prices to remove');
        return 0;
    }

    console.log(`Removing ${orphaned.length} orphaned price records...`);

    for (const price of orphaned) {
        await supabase
            .from('helmet_prices')
            .delete()
            .eq('id', price.id);
    }

    console.log(`✓ Removed ${orphaned.length} orphaned prices`);
    return orphaned.length;
}

async function fixInvalidPlayerNames() {
    console.log('\n=== Fixing Invalid Player Names ===');

    const fixes = [
        { id: 149, correctPlayer: 'Y.A. Tittle' },
        { id: 153, correctPlayer: 'Y.A. Tittle' },
        { id: 201, correctPlayer: 'J.K. Dobbins' },
        { id: 238, correctPlayer: 'D.J. Moore' },
        { id: 649, correctPlayer: 'O.J. Simpson' },
        { id: 653, correctPlayer: 'T.J. Hockenson' },
        { id: 895, correctPlayer: 'C.J. Stroud' }
    ];

    let fixed = 0;

    for (const fix of fixes) {
        const { data: helmet } = await supabase
            .from('helmets')
            .select('player')
            .eq('id', fix.id)
            .single();

        if (helmet) {
            console.log(`  ID ${fix.id}: "${helmet.player}" → "${fix.correctPlayer}"`);

            await supabase
                .from('helmets')
                .update({ player: fix.correctPlayer })
                .eq('id', fix.id);

            fixed++;
        }
    }

    // Delete invalid entries that can't be fixed
    const deleteIds = [794, 2296]; // "Helmet Mini" and multi-signed entries

    for (const id of deleteIds) {
        const { data: helmet } = await supabase
            .from('helmets')
            .select('player')
            .eq('id', id)
            .single();

        if (helmet) {
            console.log(`  Deleting ID ${id}: "${helmet.player}"`);

            // Delete prices first
            await supabase
                .from('helmet_prices')
                .delete()
                .eq('helmet_id', id);

            // Delete helmet
            await supabase
                .from('helmets')
                .delete()
                .eq('id', id);

            fixed++;
        }
    }

    console.log(`✓ Fixed/removed ${fixed} invalid player names`);
    return fixed;
}

async function mergeDuplicateHelmets() {
    console.log('\n=== Merging Duplicate Helmets ===');

    // Known duplicates to merge (keep first ID, merge prices from second)
    const duplicatePairs = [
        { keep: 14, merge: 589 },   // Quinshon Judkins
        { keep: 429, merge: 490 },  // Travis Hunter
        { keep: 525, merge: 645 },  // Ray Lewis
        { keep: 583, merge: 955 },  // Abdul Carter
        { keep: 807, merge: 986 }   // Bob Griese
    ];

    let merged = 0;

    for (const pair of duplicatePairs) {
        const { data: keepHelmet } = await supabase
            .from('helmets')
            .select('player, team')
            .eq('id', pair.keep)
            .single();

        const { data: mergeHelmet } = await supabase
            .from('helmets')
            .select('player, team')
            .eq('id', pair.merge)
            .single();

        if (!keepHelmet || !mergeHelmet) {
            console.log(`  Skipping pair ${pair.keep}/${pair.merge} - helmet not found`);
            continue;
        }

        console.log(`  Merging ${mergeHelmet.player} - ${mergeHelmet.team} (ID ${pair.merge} → ${pair.keep})`);

        // Move prices from merge helmet to keep helmet
        const { data: pricesToMove } = await supabase
            .from('helmet_prices')
            .select('*')
            .eq('helmet_id', pair.merge);

        for (const price of pricesToMove || []) {
            // Check if keep helmet already has this source
            const { data: existing } = await supabase
                .from('helmet_prices')
                .select('id')
                .eq('helmet_id', pair.keep)
                .eq('source', price.source);

            if (existing && existing.length > 0) {
                // Keep helmet already has this source, just delete the duplicate
                await supabase
                    .from('helmet_prices')
                    .delete()
                    .eq('id', price.id);
            } else {
                // Move the price to keep helmet
                await supabase
                    .from('helmet_prices')
                    .update({ helmet_id: pair.keep })
                    .eq('id', price.id);
            }
        }

        // Delete the merge helmet
        await supabase
            .from('helmets')
            .delete()
            .eq('id', pair.merge);

        merged++;
    }

    console.log(`✓ Merged ${merged} duplicate helmets`);
    return merged;
}

async function main() {
    console.log('===========================================');
    console.log('  DATABASE CLEANUP');
    console.log('===========================================');

    const results = {
        orphanedRemoved: 0,
        invalidNamesFixed: 0,
        duplicatesMerged: 0
    };

    results.orphanedRemoved = await removeOrphanedPrices();
    results.invalidNamesFixed = await fixInvalidPlayerNames();
    results.duplicatesMerged = await mergeDuplicateHelmets();

    console.log('\n===========================================');
    console.log('  CLEANUP COMPLETE');
    console.log('===========================================');
    console.log(`  Orphaned prices removed:  ${results.orphanedRemoved}`);
    console.log(`  Invalid names fixed:      ${results.invalidNamesFixed}`);
    console.log(`  Duplicates merged:        ${results.duplicatesMerged}`);
    console.log('===========================================');

    // Get final count
    const { count } = await supabase
        .from('helmets')
        .select('*', { count: 'exact', head: true });

    console.log(`\nTotal helmets in database: ${count}`);

    return results;
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { main };
