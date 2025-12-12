const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
const { upsertPrice, findHelmet, validateSchema } = require('./lib/price-utils');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const filePath = './SignatureSportsMemorabilia/player_helmets.ods';

// Normalize player name (convert from "PATRICK MAHOMES" to "Patrick Mahomes")
function normalizePlayerName(name) {
    if (!name) return '';
    return name
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
        .trim();
}

// Parse helmet type to database format
function parseHelmetType(type) {
    const lower = (type || '').toLowerCase();

    if (lower.includes('mini')) return 'mini';
    if (lower.includes('midi')) return 'midi';
    if (lower.includes('full size') || lower === 'helmet') {
        // Default full size to replica unless specified
        return 'fullsize-replica';
    }

    return 'fullsize-replica';
}

// Parse design type to database format
function parseDesignType(design) {
    const lower = (design || '').toLowerCase();

    if (lower.includes('eclipse')) return 'eclipse';
    if (lower.includes('flash')) return 'flash';
    if (lower.includes('slate')) return 'slate';
    if (lower.includes('camo')) return 'camo';
    if (lower.includes('salute')) return 'salute';
    if (lower.includes('lunar')) return 'lunar';
    if (lower.includes('rave')) return 'rave';
    if (lower.includes('chrome')) return 'chrome';
    if (lower.includes('throwback')) return 'throwback';
    if (lower.includes('alternate') || lower.includes('alt')) return 'alternate';
    if (lower.includes('super bowl')) return 'superbowl';
    if (lower.includes('rivalries')) return 'rivalries';

    // Default to regular for speed, proline, schutt, etc.
    return 'regular';
}

// Parse price string to number
function parsePrice(priceStr) {
    if (!priceStr) return null;
    const cleaned = priceStr.toString().replace(/[$,]/g, '');
    const price = parseFloat(cleaned);
    return isNaN(price) ? null : price;
}

// Normalize team name
function normalizeTeam(team) {
    if (!team) return '';

    const teamMap = {
        'new york jets': 'Jets',
        'new york giants': 'Giants',
        'detroit lions': 'Lions',
        'chicago bears': 'Bears',
        'buffalo bills': 'Bills',
        'cincinnati bengals': 'Bengals',
        'kansas city chiefs': 'Chiefs',
        'san francisco 49ers': '49ers',
        'dallas cowboys': 'Cowboys',
        'philadelphia eagles': 'Eagles',
        'green bay packers': 'Packers',
        'miami dolphins': 'Dolphins',
        'los angeles rams': 'Rams',
        'las vegas raiders': 'Raiders',
        'denver broncos': 'Broncos',
        'pittsburgh steelers': 'Steelers',
        'seattle seahawks': 'Seahawks',
        'baltimore ravens': 'Ravens',
        'tampa bay buccaneers': 'Buccaneers',
        'los angeles chargers': 'Chargers',
        'minnesota vikings': 'Vikings',
        'atlanta falcons': 'Falcons',
        'carolina panthers': 'Panthers',
        'new orleans saints': 'Saints',
        'arizona cardinals': 'Cardinals',
        'cleveland browns': 'Browns',
        'indianapolis colts': 'Colts',
        'tennessee titans': 'Titans',
        'jacksonville jaguars': 'Jaguars',
        'houston texans': 'Texans',
        'new england patriots': 'Patriots',
        'washington commanders': 'Commanders',
        'tech red raiders': 'Texas Tech Red Raiders',
    };

    const lower = team.toLowerCase();

    // Check for exact match in map
    if (teamMap[lower]) return teamMap[lower];

    // Check if team name contains a mapped key
    for (const [key, value] of Object.entries(teamMap)) {
        if (lower.includes(key.split(' ').pop())) {
            return value;
        }
    }

    // Return as-is if no mapping found
    return team;
}

async function main() {
    console.log('===========================================');
    console.log('  SIGNATURE SPORTS MEMORABILIA IMPORT');
    console.log('===========================================');

    // Validate schema before starting
    console.log('\nValidating database schema...');
    const schemaCheck = await validateSchema();
    if (!schemaCheck.valid) {
        console.error('✗ Schema validation failed:');
        schemaCheck.errors.forEach(err => console.error(`  - ${err}`));
        process.exit(1);
    }
    console.log('✓ Schema validation passed\n');

    console.log('Reading:', filePath);

    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);

    console.log(`\nTotal rows in file: ${data.length}`);

    // Remove duplicates from source data
    const seen = new Set();
    const uniqueData = [];
    let duplicatesInFile = 0;

    for (const row of data) {
        const key = `${row.player}|${row.team}|${row.helmet_type}|${row.design_type}`.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            uniqueData.push(row);
        } else {
            duplicatesInFile++;
        }
    }

    console.log(`Duplicates removed from file: ${duplicatesInFile}`);
    console.log(`Unique entries to process: ${uniqueData.length}\n`);

    let added = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;

    for (const row of uniqueData) {
        try {
            const player = normalizePlayerName(row.player);

            if (!player) {
                skipped++;
                continue;
            }

            const team = normalizeTeam(row.team);
            const helmetType = parseHelmetType(row.helmet_type);
            const designType = parseDesignType(row.design_type);
            const price = parsePrice(row.Price);

            // Create descriptive name
            const name = `${player} ${team} Autographed ${row.helmet_type}`.trim();

            // Create eBay search query
            const ebaySearchQuery = `${player} ${team} autographed signed helmet`.toLowerCase();

            // Check for existing helmet in database
            const existing = await findHelmet(player, team, helmetType, designType);

            if (existing) {
                // Helmet exists - update price
                if (price) {
                    const result = await upsertPrice(existing.id, 'signaturesports', price);
                    if (!result.success) {
                        console.error(`  ✗ Error updating price for ${player}:`, result.error);
                        errors++;
                        continue;
                    }
                }
                updated++;
                console.log(`  ↺ Updated: ${player} - ${team} ${helmetType} ${designType} ($${price})`);
            } else {
                // Insert new helmet
                const { data: newHelmet, error } = await supabase
                    .from('helmets')
                    .insert({
                        name: name,
                        player: player,
                        team: team,
                        helmet_type: helmetType,
                        design_type: designType,
                        ebay_search_query: ebaySearchQuery,
                        is_active: true
                    })
                    .select();

                if (error) {
                    console.error(`  ✗ Error inserting ${player}:`, error.message);
                    errors++;
                    continue;
                }

                // Add price record
                if (price && newHelmet && newHelmet[0]) {
                    const result = await upsertPrice(newHelmet[0].id, 'signaturesports', price);
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

    console.log('\n===========================================');
    console.log('  IMPORT COMPLETE');
    console.log('===========================================');
    console.log(`  New helmets added:       ${added}`);
    console.log(`  Existing updated:        ${updated}`);
    console.log(`  Skipped (no player):     ${skipped}`);
    console.log(`  Duplicates in file:      ${duplicatesInFile}`);
    console.log(`  Errors:                  ${errors}`);
    console.log('===========================================');

    // Get final count
    const { count } = await supabase
        .from('helmets')
        .select('*', { count: 'exact', head: true });

    console.log(`\n  Total helmets in database: ${count}`);
}

main().catch(console.error);
