const XLSX = require('xlsx');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { upsertPrice, findHelmet, validateSchema, extractTeamFromName } = require('./lib/price-utils');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const filePath = path.join(__dirname, '..', 'GreatSports', 'Inventory.xls');

// Map design types from spreadsheet to our format
function parseDesignType(item, type, description = '') {
    const text = (item + ' ' + type + ' ' + description).toLowerCase();

    if (text.includes('eclipse')) return 'eclipse';
    if (text.includes('flash')) return 'flash';
    if (text.includes('slate')) return 'slate';
    if (text.includes('camo')) return 'camo';
    if (text.includes('salute')) return 'salute';
    if (text.includes('amp')) return 'amp';
    if (text.includes('rave')) return 'rave';
    if (text.includes('lunar')) return 'lunar';
    if (text.includes('blaze')) return 'blaze';
    if (text.includes('throwback')) return 'throwback';
    if (text.includes('alternate') || text.includes('alt')) return 'alternate';
    if (text.includes('chrome')) return 'chrome';

    return 'regular';
}

// Map helmet type from spreadsheet to our format
function parseHelmetType(sheetName, type, item) {
    const text = (type + ' ' + item).toLowerCase();

    if (sheetName === 'Minis') return 'mini';
    if (sheetName === 'MIDI') return 'midi';

    // Full Size
    if (text.includes('authentic') || text.includes('speedflex')) {
        return 'fullsize-authentic';
    }
    if (text.includes('replica') || text.includes('rep')) {
        return 'fullsize-replica';
    }

    // Default for full size
    return 'fullsize-authentic';
}

// Normalize team names
function normalizeTeam(team) {
    const teamMap = {
        '49ers': '49ers',
        'niners': '49ers',
        'san francisco': '49ers',
        'bears': 'Bears',
        'bengals': 'Bengals',
        'bills': 'Bills',
        'broncos': 'Broncos',
        'browns': 'Browns',
        'buccaneers': 'Buccaneers',
        'bucs': 'Buccaneers',
        'cardinals': 'Cardinals',
        'chargers': 'Chargers',
        'chiefs': 'Chiefs',
        'colts': 'Colts',
        'commanders': 'Commanders',
        'cowboys': 'Cowboys',
        'dolphins': 'Dolphins',
        'eagles': 'Eagles',
        'falcons': 'Falcons',
        'giants': 'Giants',
        'jaguars': 'Jaguars',
        'jets': 'Jets',
        'lions': 'Lions',
        'packers': 'Packers',
        'panthers': 'Panthers',
        'patriots': 'Patriots',
        'raiders': 'Raiders',
        'rams': 'Rams',
        'ravens': 'Ravens',
        'saints': 'Saints',
        'seahawks': 'Seahawks',
        'steelers': 'Steelers',
        'texans': 'Texans',
        'titans': 'Titans',
        'vikings': 'Vikings',
    };

    const lower = (team || '').toLowerCase();
    return teamMap[lower] || team;
}

async function importSheet(sheetName, sheet) {
    const data = XLSX.utils.sheet_to_json(sheet);

    console.log(`\n=== Importing ${sheetName} (${data.length} rows) ===\n`);

    let added = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of data) {
        try {
            const firstName = row.PlayerFirst || '';
            const lastName = row.PlayerLast || '';
            const player = `${firstName} ${lastName}`.trim();

            if (!player || player === ' ') {
                skipped++;
                continue;
            }

            let team = normalizeTeam(row.Team || '');
            const type = row.Type || '';
            const item = row.Item || row.Description || '';
            const description = row.Description || '';

            // Get price - different column names per tab
            const price = row.Retail || row.Price || null;

            if (!price || price <= 0) {
                skipped++;
                continue;
            }

            const helmetType = parseHelmetType(sheetName, type, item);
            const designType = parseDesignType(item, type, description);

            // Create a descriptive name
            const name = `${player} ${team} Autographed ${helmetType} Helmet ${designType !== 'regular' ? designType : ''}`.trim();

            // If team is still empty, try to extract from the name/item
            if (!team) {
                team = extractTeamFromName(name) || extractTeamFromName(item) || '';
            }

            // Use the unified findHelmet utility (handles flexible matching)
            const existing = await findHelmet(player, team, helmetType, designType);

            if (existing) {
                // Helmet exists - add/update GreatSports price using unified utility
                const result = await upsertPrice(existing.id, 'greatsports', price);
                if (!result.success) {
                    console.error(`  ✗ Error updating price for ${player}:`, result.error);
                    errors++;
                    continue;
                }
                updated++;
                console.log(`  ↺ Updated: ${player} - ${team} ${helmetType} ${designType} ($${price})`);
            } else {
                // Insert new helmet - generate unique identifier (no eBay searches)
                const uniqueId = `${player}-${team}-${helmetType}-${designType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
                const { data: newHelmet, error } = await supabase
                    .from('helmets')
                    .insert({
                        name: name,
                        player: player,
                        team: team,
                        helmet_type: helmetType,
                        design_type: designType,
                        ebay_search_query: uniqueId,
                        is_active: true
                    })
                    .select();

                if (error) {
                    console.error(`  ✗ Error inserting ${player}:`, error.message);
                    errors++;
                    continue;
                }

                // Add price record using unified utility
                if (newHelmet && newHelmet[0]) {
                    const result = await upsertPrice(newHelmet[0].id, 'greatsports', price);
                    if (!result.success) {
                        console.error(`  ✗ Error adding price for ${player}:`, result.error);
                    }
                }

                added++;
                console.log(`  ✓ Added: ${player} - ${team} ${helmetType} ${designType} ($${price})`);
            }
        } catch (err) {
            console.error(`  ✗ Error processing row:`, err.message);
            errors++;
        }
    }

    return { added, updated, skipped, errors };
}

async function main() {
    console.log('===========================================');
    console.log('  GREATSPORTS INVENTORY IMPORT');
    console.log('===========================================');

    // Validate schema before starting
    console.log('Validating database schema...');
    const schemaCheck = await validateSchema();
    if (!schemaCheck.valid) {
        console.error('✗ Schema validation failed:');
        schemaCheck.errors.forEach(err => console.error(`  - ${err}`));
        process.exit(1);
    }
    console.log('✓ Schema validation passed\n');

    console.log('Reading:', filePath);

    const workbook = XLSX.readFile(filePath);

    // Only import helmet tabs (skip jerseys)
    const helmetTabs = ['Full Size', 'Minis', 'MIDI'];

    let totalAdded = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const sheetName of workbook.SheetNames) {
        // Skip non-helmet tabs
        if (!helmetTabs.includes(sheetName)) {
            console.log(`\n⏭️  Skipping ${sheetName} tab (not helmets)`);
            continue;
        }

        const sheet = workbook.Sheets[sheetName];
        const result = await importSheet(sheetName, sheet);

        totalAdded += result.added;
        totalUpdated += result.updated;
        totalSkipped += result.skipped;
        totalErrors += result.errors;
    }

    console.log('\n===========================================');
    console.log('  IMPORT COMPLETE');
    console.log('===========================================');
    console.log(`  New helmets added:    ${totalAdded}`);
    console.log(`  Existing updated:     ${totalUpdated}`);
    console.log(`  Skipped (no data):    ${totalSkipped}`);
    console.log(`  Errors:               ${totalErrors}`);
    console.log('===========================================');

    // Get final count
    const { count } = await supabase
        .from('helmets')
        .select('*', { count: 'exact', head: true });

    console.log(`\n  Total helmets in database: ${count}`);
}

main().catch(console.error);
