const XLSX = require('xlsx');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { upsertPrice, findHelmet, validateSchema, extractTeamFromName } = require('./lib/price-utils');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const filePath = path.join(__dirname, '..', 'DenverAutographs', 'Breakers List 1-3-2026.xls');

// Map design types from spreadsheet to our format
function parseDesignType(helmetTypeCol, notesCol = '') {
    const text = (helmetTypeCol + ' ' + notesCol).toLowerCase();

    if (text.includes('eclipse')) return 'eclipse';
    if (text.includes('flash')) return 'flash';
    if (text.includes('slate')) return 'slate';
    if (text.includes('camo')) return 'camo';
    if (text.includes('salute')) return 'salute';
    if (text.includes('amp')) return 'amp';
    if (text.includes('rave')) return 'rave';
    if (text.includes('lunar')) return 'lunar';
    if (text.includes('blaze')) return 'blaze';
    if (text.includes('flat white')) return 'flat-white';
    if (text.includes('chrome')) return 'chrome';
    if (text.includes('throwback') || text.includes(' tb ') || /\d{2}-\d{2}/.test(text)) return 'throwback';
    if (text.includes('alternate') || text.includes('alt')) return 'alternate';

    return 'regular';
}

// Map helmet type from spreadsheet to our format
function parseHelmetType(sheetName, helmetTypeCol) {
    const text = (helmetTypeCol || '').toLowerCase();

    // Mini & Midi sheet
    if (sheetName === 'MINI & MIDI HELMET') {
        if (text.includes('midi')) return 'midi';
        return 'mini';
    }

    // Full Size sheet
    if (text.includes('proline') || text.includes('authentic') || text.includes('speedflex')) {
        return 'fullsize-authentic';
    }
    if (text.includes('replica') || text.includes('rep')) {
        return 'fullsize-replica';
    }

    // Default for full size
    return 'fullsize-replica';
}

// Normalize player name (Last, First -> First Last)
function normalizePlayerName(name) {
    if (!name) return '';

    // Handle "Last, First" format
    if (name.includes(',')) {
        const parts = name.split(',').map(p => p.trim());
        if (parts.length === 2) {
            return `${parts[1]} ${parts[0]}`;
        }
    }
    return name.trim();
}

// Normalize team names
function normalizeTeam(team) {
    if (!team) return '';

    // Remove common prefixes/suffixes and standardize
    let normalized = team.trim();

    // Map full names to short names used in database
    const teamMap = {
        'arizona cardinals': 'Cardinals',
        'atlanta falcons': 'Falcons',
        'baltimore ravens': 'Ravens',
        'buffalo bills': 'Bills',
        'carolina panthers': 'Panthers',
        'chicago bears': 'Bears',
        'cincinnati bengals': 'Bengals',
        'cleveland browns': 'Browns',
        'dallas cowboys': 'Cowboys',
        'denver broncos': 'Broncos',
        'detroit lions': 'Lions',
        'green bay packers': 'Packers',
        'houston texans': 'Texans',
        'indianapolis colts': 'Colts',
        'jacksonville jaguars': 'Jaguars',
        'kansas city chiefs': 'Chiefs',
        'las vegas raiders': 'Raiders',
        'los angeles chargers': 'Chargers',
        'los angeles rams': 'Rams',
        'miami dolphins': 'Dolphins',
        'minnesota vikings': 'Vikings',
        'new england patriots': 'Patriots',
        'new orleans saints': 'Saints',
        'new york giants': 'Giants',
        'new york jets': 'Jets',
        'oakland raiders': 'Raiders',
        'philadelphia eagles': 'Eagles',
        'pittsburgh steelers': 'Steelers',
        'san francisco 49ers': '49ers',
        'seattle seahawks': 'Seahawks',
        'tampa bay buccaneers': 'Buccaneers',
        'tennessee titans': 'Titans',
        'washington commanders': 'Commanders',
    };

    const lower = normalized.toLowerCase();
    return teamMap[lower] || normalized;
}

async function importSheet(sheetName, sheet) {
    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    // Skip header row and filter empty rows
    const data = rawData.slice(1).filter(row => row.length > 0 && row[0]);

    console.log(`\n=== Importing ${sheetName} (${data.length} rows) ===\n`);

    let added = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of data) {
        try {
            let player, team, helmetTypeCol, helmetTypeCol2, price;

            if (sheetName === 'FS HELMET') {
                // FS HELMET: PLAYER, TEAM NAME, Helmet Type, Helmet Type 2, PRICE
                [player, team, helmetTypeCol, helmetTypeCol2, price] = row;
            } else {
                // MINI & MIDI: PLAYER, TEAM NAME, DEPARTMENT NAME, Helmet Type, PRICE
                [player, team, , helmetTypeCol, price] = row;
                helmetTypeCol2 = '';
            }

            player = normalizePlayerName(player);
            team = normalizeTeam(team);

            if (!player || player === ' ') {
                skipped++;
                continue;
            }

            if (!price || price <= 0) {
                skipped++;
                continue;
            }

            const helmetType = parseHelmetType(sheetName, helmetTypeCol);
            const designType = parseDesignType(helmetTypeCol2 || helmetTypeCol, '');

            // Create a descriptive name
            const designSuffix = designType !== 'regular' ? ` ${designType}` : '';
            const name = `${player} ${team} Autographed ${helmetType} Helmet${designSuffix}`.trim();

            // If team is still empty, try to extract from the name
            if (!team) {
                team = extractTeamFromName(name) || '';
            }

            // Use the unified findHelmet utility (handles flexible matching)
            const existing = await findHelmet(player, team, helmetType, designType);

            if (existing) {
                // Helmet exists - add/update Denver Autographs price
                const result = await upsertPrice(existing.id, 'denverautographs', price);
                if (!result.success) {
                    console.error(`  ✗ Error updating price for ${player}:`, result.error);
                    errors++;
                    continue;
                }
                updated++;
                console.log(`  ↺ Updated: ${player} - ${team} ${helmetType} ${designType} ($${price})`);
            } else {
                // Insert new helmet
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

                // Add price record
                if (newHelmet && newHelmet[0]) {
                    const result = await upsertPrice(newHelmet[0].id, 'denverautographs', price);
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
    console.log('  DENVER AUTOGRAPHS INVENTORY IMPORT');
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

    // Import helmet tabs
    const helmetTabs = ['FS HELMET', 'MINI & MIDI HELMET'];

    let totalAdded = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const sheetName of helmetTabs) {
        if (!workbook.SheetNames.includes(sheetName)) {
            console.log(`\n⚠️  Sheet "${sheetName}" not found, skipping`);
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
