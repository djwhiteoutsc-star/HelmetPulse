/**
 * Database Consistency Check
 *
 * Validates and reports on database integrity:
 * - Orphaned price records (prices pointing to non-existent helmets)
 * - Helmets without prices
 * - Invalid player names (team names as players, bad patterns)
 * - Duplicate entries
 * - Schema validation
 */

const { createClient } = require('@supabase/supabase-js');
const { getPriceStats, validateSchema } = require('./lib/price-utils');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Known team names that shouldn't be player names
const TEAM_NAMES = [
    '49ers', 'Bears', 'Bengals', 'Bills', 'Broncos', 'Browns', 'Buccaneers',
    'Cardinals', 'Chargers', 'Chiefs', 'Colts', 'Commanders', 'Cowboys',
    'Dolphins', 'Eagles', 'Falcons', 'Giants', 'Jaguars', 'Jets', 'Lions',
    'Packers', 'Panthers', 'Patriots', 'Raiders', 'Rams', 'Ravens', 'Saints',
    'Seahawks', 'Steelers', 'Texans', 'Titans', 'Vikings', 'Washington',
    'Redskins', 'Philadelphia', 'New York', 'San Francisco', 'Los Angeles',
    'New England', 'Green Bay', 'Kansas City', 'Tampa Bay', 'Las Vegas'
];

async function checkOrphanedPrices() {
    console.log('\n=== Checking for Orphaned Prices ===');

    const { data: prices } = await supabase
        .from('helmet_prices')
        .select('id, helmet_id, source');

    const { data: helmets } = await supabase
        .from('helmets')
        .select('id');

    const helmetIds = new Set(helmets.map(h => h.id));
    const orphaned = prices.filter(p => !helmetIds.has(p.helmet_id));

    if (orphaned.length === 0) {
        console.log('✓ No orphaned prices found');
    } else {
        console.log(`✗ Found ${orphaned.length} orphaned price records:`);
        orphaned.slice(0, 10).forEach(p => {
            console.log(`  - Price ID ${p.id}: helmet_id=${p.helmet_id}, source=${p.source}`);
        });
        if (orphaned.length > 10) {
            console.log(`  ... and ${orphaned.length - 10} more`);
        }
    }

    return { orphaned: orphaned.length };
}

async function checkHelmetsWithoutPrices() {
    console.log('\n=== Checking Helmets Without Prices ===');

    const { data: helmets } = await supabase
        .from('helmets')
        .select('id, player, team, helmet_type');

    const { data: prices } = await supabase
        .from('helmet_prices')
        .select('helmet_id');

    const helmetIdsWithPrices = new Set(prices.map(p => p.helmet_id));
    const noPrices = helmets.filter(h => !helmetIdsWithPrices.has(h.id));

    console.log(`Found ${noPrices.length} helmets without any price data`);

    if (noPrices.length > 0) {
        console.log('Sample helmets without prices:');
        noPrices.slice(0, 5).forEach(h => {
            console.log(`  - ID ${h.id}: ${h.player} - ${h.team} (${h.helmet_type})`);
        });
        if (noPrices.length > 5) {
            console.log(`  ... and ${noPrices.length - 5} more`);
        }
    }

    return { withoutPrices: noPrices.length };
}

async function checkInvalidPlayerNames() {
    console.log('\n=== Checking for Invalid Player Names ===');

    const { data: helmets } = await supabase
        .from('helmets')
        .select('id, player, team');

    const issues = [];

    for (const helmet of helmets) {
        const player = helmet.player || '';

        // Check if player name is a team name
        if (TEAM_NAMES.some(team => player.toLowerCase().includes(team.toLowerCase()))) {
            issues.push({
                id: helmet.id,
                player: player,
                team: helmet.team,
                reason: 'Player name contains team name'
            });
            continue;
        }

        // Check for common bad patterns
        if (player.match(/^\d+$/)) {
            issues.push({
                id: helmet.id,
                player: player,
                team: helmet.team,
                reason: 'Player name is only numbers'
            });
        } else if (player.toLowerCase().includes('helmet')) {
            issues.push({
                id: helmet.id,
                player: player,
                team: helmet.team,
                reason: 'Player name contains "helmet"'
            });
        } else if (player.toLowerCase().includes('autograph')) {
            issues.push({
                id: helmet.id,
                player: player,
                team: helmet.team,
                reason: 'Player name contains "autograph"'
            });
        } else if (player.toLowerCase().includes('signed')) {
            issues.push({
                id: helmet.id,
                player: player,
                team: helmet.team,
                reason: 'Player name contains "signed"'
            });
        } else if (player.length < 3) {
            issues.push({
                id: helmet.id,
                player: player,
                team: helmet.team,
                reason: 'Player name too short'
            });
        }
    }

    if (issues.length === 0) {
        console.log('✓ No invalid player names found');
    } else {
        console.log(`✗ Found ${issues.length} helmets with invalid player names:`);
        issues.slice(0, 10).forEach(issue => {
            console.log(`  - ID ${issue.id}: "${issue.player}" - ${issue.team} (${issue.reason})`);
        });
        if (issues.length > 10) {
            console.log(`  ... and ${issues.length - 10} more`);
        }
    }

    return { invalidNames: issues.length, issues };
}

async function checkDuplicates() {
    console.log('\n=== Checking for Duplicate Helmets ===');

    const { data: helmets } = await supabase
        .from('helmets')
        .select('id, player, team, helmet_type, design_type, ebay_search_query');

    // Group by player + team + helmet_type + design_type
    const groups = {};
    for (const helmet of helmets) {
        const key = `${helmet.player}|${helmet.team}|${helmet.helmet_type}|${helmet.design_type}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(helmet);
    }

    const duplicates = Object.values(groups).filter(group => group.length > 1);

    if (duplicates.length === 0) {
        console.log('✓ No duplicate helmets found');
    } else {
        console.log(`✗ Found ${duplicates.length} sets of duplicate helmets:`);
        duplicates.slice(0, 5).forEach(group => {
            console.log(`  - ${group[0].player} - ${group[0].team} ${group[0].helmet_type} ${group[0].design_type}:`);
            group.forEach(h => console.log(`    ID ${h.id}`));
        });
        if (duplicates.length > 5) {
            console.log(`  ... and ${duplicates.length - 5} more duplicate sets`);
        }
    }

    return { duplicateSets: duplicates.length };
}

async function checkPriceStats() {
    console.log('\n=== Price Statistics ===');

    const stats = await getPriceStats();

    console.log(`Total helmets in database: ${stats.totalHelmets}`);
    console.log('\nPrices by source:');

    for (const source of ['ebay', 'fanatics', 'rsa', 'radtke', 'pristine']) {
        if (stats[source]) {
            console.log(`  ${source.padEnd(10)}: ${stats[source].records} records, ${stats[source].uniqueHelmets} unique helmets`);
        }
    }

    // Calculate helmets with at least one price
    const { data: prices } = await supabase
        .from('helmet_prices')
        .select('helmet_id');

    const uniqueHelmetsWithPrices = new Set(prices.map(p => p.helmet_id)).size;
    const helmetsWithoutPrices = stats.totalHelmets - uniqueHelmetsWithPrices;

    console.log(`\nHelmets with at least one price: ${uniqueHelmetsWithPrices}`);
    console.log(`Helmets without any price: ${helmetsWithoutPrices}`);

    return stats;
}

async function checkSchema() {
    console.log('\n=== Validating Database Schema ===');

    const result = await validateSchema();

    if (result.valid) {
        console.log('✓ Schema validation passed');
    } else {
        console.log('✗ Schema validation failed:');
        result.errors.forEach(err => console.log(`  - ${err}`));
    }

    return result;
}

async function main() {
    console.log('===========================================');
    console.log('  DATABASE CONSISTENCY CHECK');
    console.log('===========================================');

    const results = {};

    // Run all checks
    results.schema = await checkSchema();
    results.orphanedPrices = await checkOrphanedPrices();
    results.invalidNames = await checkInvalidPlayerNames();
    results.duplicates = await checkDuplicates();
    results.priceStats = await checkPriceStats();
    results.withoutPrices = await checkHelmetsWithoutPrices();

    // Summary
    console.log('\n===========================================');
    console.log('  SUMMARY');
    console.log('===========================================');

    const issues = [];
    if (!results.schema.valid) issues.push(`Schema validation errors: ${results.schema.errors.length}`);
    if (results.orphanedPrices.orphaned > 0) issues.push(`Orphaned prices: ${results.orphanedPrices.orphaned}`);
    if (results.invalidNames.invalidNames > 0) issues.push(`Invalid player names: ${results.invalidNames.invalidNames}`);
    if (results.duplicates.duplicateSets > 0) issues.push(`Duplicate helmet sets: ${results.duplicates.duplicateSets}`);

    if (issues.length === 0) {
        console.log('✓ Database is consistent');
    } else {
        console.log('✗ Issues found:');
        issues.forEach(issue => console.log(`  - ${issue}`));
    }

    console.log('===========================================');

    return results;
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { main };
