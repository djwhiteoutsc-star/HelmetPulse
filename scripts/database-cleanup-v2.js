const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ============================================
// PLAYER NAME CORRECTIONS
// ============================================

// Direct name replacements (truncated names, spelling errors, case fixes)
const NAME_CORRECTIONS = {
    // Truncated names
    'Sam La': 'Sam LaPorta',
    'Jim Mc': 'Jim McMahon',
    'Trey Mc': 'Trey McBride',
    'Ed Mc': 'Ed McCaffrey',
    'Elly De': 'Elly De La Cruz',
    'Sean Mc': 'LeSean McCoy',
    'Christian Mc': 'Christian McCaffrey',
    'Isaac Te': 'Isaac TeSlaa',
    'Jalen Mc': 'Jalen McMillan',
    'Terry Mc': 'Terry McLaurin',
    'Broncos Ed': 'Ed McCaffrey',

    // Case/spelling corrections
    'Ceedee Lamb': 'CeeDee Lamb',
    'Cooper Dejean': 'Cooper DeJean',
    'Devonta Smith': 'DeVonta Smith',
    'Emmit Smith': 'Emmitt Smith',
    'Jaxon Smith': 'Jaxon Smith-Njigba',

    // ALL CAPS to proper case
    'ASHTON JEANTY': 'Ashton Jeanty',
    'BARRY SANDERS': 'Barry Sanders',
    'BRIAN KELLY': 'Brian Kelly',
    'CALEB DOWNS': 'Caleb Downs',
    'CHARLEY TRIPPI': 'Charley Trippi',
    'CHRISTIAN MCCAFFREY': 'Christian McCaffrey',
    'DENVER BRONCOS': null, // Will be deleted - not a player
    'DICK BUTKUS': 'Dick Butkus',
    'EMEKA EGBUKA': 'Emeka Egbuka',
    'GEORGE KITTLE': 'George Kittle',
    'JAHMYR GIBBS': 'Jahmyr Gibbs',
    'JAMES HARRISON': 'James Harrison',
    'JAXON SMITH-NJIGBA': 'Jaxon Smith-Njigba',
    'JOE MONTANA': 'Joe Montana',
    'KYLE WHITTINGHAM': 'Kyle Whittingham',
    'MATT RHULE': 'Matt Rhule',
    'NOTRE DAME': null, // Will be deleted - not a player
    'PATRICK MAHOMES': 'Patrick Mahomes',
    'RUDY RUETTIGER': 'Rudy Ruettiger',
    'SHAUN ALEXANDER': 'Shaun Alexander',
    'TRAVIS KELCE': 'Travis Kelce',
    'TYREEK HILL': 'Tyreek Hill',
    'WARREN MOON': 'Warren Moon',
    'WILLIE ROAF': 'Willie Roaf',
    'GEORGIA BULLDOGS': null, // Will be deleted - not a player
};

// Non-player entries that should be deleted
const NON_PLAYER_PATTERNS = [
    /^20\d{2}\s/i,           // Starts with year (2025, 2024, etc.)
    /^Autographed\s/i,       // Starts with "Autographed"
    /^Signed\s/i,            // Starts with "Signed"
    /^Speed\s/i,             // Starts with "Speed"
    /^Brown\s/i,             // Starts with "Brown" (not a player name in context)
    /^Bengals\s/i,           // Starts with team name
    /^Buccaneers\s/i,
    /^Cowboys\s/i,
    /^Dolphins\s/i,
    /^Patriots\s/i,
    /^Rams\s/i,
    /^Ravens\s/i,
    /^Steelers\s/i,
    /^Vikings\s/i,
    /^Dallas\sCowboys$/i,
    /^Kansas\sCity$/i,
    /^Kansas\sState$/i,
];

const report = {
    namesFixed: 0,
    caseCorrected: 0,
    deleted: 0,
    helmetsDeleted: [],
    errors: []
};

async function fixTruncatedAndMisspelledNames() {
    console.log('\n=== STEP 1: Fixing Truncated & Misspelled Names ===\n');

    for (const [oldName, newName] of Object.entries(NAME_CORRECTIONS)) {
        if (newName === null) continue; // Skip deletions for now

        const { data: helmets } = await supabase
            .from('helmets')
            .select('id, player')
            .eq('player', oldName);

        if (helmets && helmets.length > 0) {
            console.log(`  "${oldName}" → "${newName}" (${helmets.length} helmets)`);

            const { error } = await supabase
                .from('helmets')
                .update({ player: newName })
                .eq('player', oldName);

            if (error) {
                report.errors.push(`Failed to update "${oldName}": ${error.message}`);
            } else {
                report.namesFixed += helmets.length;
            }
        }
    }
}

async function deleteNonPlayerEntries() {
    console.log('\n=== STEP 2: Removing Non-Player Entries ===\n');

    // Get all helmets
    const { data: allHelmets } = await supabase
        .from('helmets')
        .select('id, player, name');

    const toDelete = [];

    for (const helmet of allHelmets || []) {
        const player = helmet.player || '';

        // Check if it matches a non-player pattern
        const isNonPlayer = NON_PLAYER_PATTERNS.some(pattern => pattern.test(player));

        // Check if it's a null correction
        const isNullCorrection = NAME_CORRECTIONS[player] === null;

        if (isNonPlayer || isNullCorrection) {
            toDelete.push(helmet);
        }
    }

    console.log(`  Found ${toDelete.length} non-player entries to delete:\n`);

    for (const helmet of toDelete) {
        console.log(`    ID ${helmet.id}: "${helmet.player}"`);

        // Delete prices first
        await supabase
            .from('helmet_prices')
            .delete()
            .eq('helmet_id', helmet.id);

        // Delete helmet
        const { error } = await supabase
            .from('helmets')
            .delete()
            .eq('id', helmet.id);

        if (error) {
            report.errors.push(`Failed to delete ID ${helmet.id}: ${error.message}`);
        } else {
            report.deleted++;
            report.helmetsDeleted.push({ id: helmet.id, player: helmet.player });
        }
    }
}

async function runDuplicateCheck() {
    console.log('\n=== STEP 3: Checking for Duplicates After Fixes ===\n');

    const { data: allHelmets } = await supabase
        .from('helmets')
        .select('*')
        .order('id');

    // Group by player + team + type + design
    const groups = new Map();

    for (const helmet of allHelmets || []) {
        const key = `${helmet.player || 'NULL'}|${helmet.team || 'NULL'}|${helmet.helmet_type}|${helmet.design_type}`;

        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key).push(helmet);
    }

    // Find duplicates
    const duplicates = Array.from(groups.entries())
        .filter(([key, helmets]) => helmets.length > 1);

    if (duplicates.length > 0) {
        console.log(`  Found ${duplicates.length} duplicate groups:\n`);
        duplicates.slice(0, 10).forEach(([key, helmets]) => {
            console.log(`    ${key}`);
            console.log(`      IDs: ${helmets.map(h => h.id).join(', ')}`);
        });

        if (duplicates.length > 10) {
            console.log(`    ... and ${duplicates.length - 10} more`);
        }
    } else {
        console.log('  No duplicates found!');
    }

    return duplicates.length;
}

async function generateReport() {
    console.log('\n═══════════════════════════════════════');
    console.log('  DATABASE CLEANUP REPORT');
    console.log('═══════════════════════════════════════');
    console.log(`  Names fixed:        ${report.namesFixed}`);
    console.log(`  Entries deleted:    ${report.deleted}`);
    console.log(`  Errors:             ${report.errors.length}`);
    console.log('═══════════════════════════════════════\n');

    if (report.errors.length > 0) {
        console.log('Errors encountered:');
        report.errors.forEach(e => console.log(`  - ${e}`));
    }

    // Final stats
    const { data: finalHelmets } = await supabase
        .from('helmets')
        .select('id, player')
        .order('player');

    const uniquePlayers = [...new Set(finalHelmets.map(h => h.player).filter(Boolean))];

    console.log('\nFinal Database Stats:');
    console.log(`  Total helmets:    ${finalHelmets.length}`);
    console.log(`  Unique players:   ${uniquePlayers.length}`);
}

async function main() {
    console.log('🔧 DATABASE CLEANUP V2 - Starting...\n');

    await fixTruncatedAndMisspelledNames();
    await deleteNonPlayerEntries();
    const dupCount = await runDuplicateCheck();
    await generateReport();

    if (dupCount > 0) {
        console.log('\n⚠️  Duplicates were created by name fixes. Run clean-database.js to merge them.');
    }

    console.log('\n✅ Cleanup complete!');
}

main();
