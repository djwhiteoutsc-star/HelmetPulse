#!/usr/bin/env node
/**
 * Auto-Import - Unified helmet pricing import
 *
 * Automatically detects the source format and imports pricing data.
 *
 * Usage:
 *   node scripts/auto-import.js <file-path>
 *   node scripts/auto-import.js --watch     # Watch for new files
 *
 * Supported Sources (auto-detected by filename):
 *   - Denver Autographs: *denver*, *breakers*
 *   - Fanatics: *fanatics*, *inventory*
 *   - RSA: *rsa*, *shoprsa*
 *   - Radtke: *radtke*
 *   - Signature Sports: *signature*
 *   - Great Sports: *greatsports*, *great-sports*
 */

const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { upsertPrice, findHelmet, validateSchema, extractTeamFromName } = require('./lib/price-utils');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Import folder to watch
const IMPORT_FOLDER = path.join(__dirname, '..', 'imports');
const PROCESSED_FOLDER = path.join(__dirname, '..', 'imports', 'processed');

// Ensure folders exist
if (!fs.existsSync(IMPORT_FOLDER)) fs.mkdirSync(IMPORT_FOLDER, { recursive: true });
if (!fs.existsSync(PROCESSED_FOLDER)) fs.mkdirSync(PROCESSED_FOLDER, { recursive: true });

// ============ SOURCE DETECTION ============

function detectSource(filename) {
    const lower = filename.toLowerCase();

    if (lower.includes('denver') || lower.includes('breakers')) return 'denverautographs';
    if (lower.includes('fanatics')) return 'fanatics';
    if (lower.includes('rsa') || lower.includes('shoprsa')) return 'rsa';
    if (lower.includes('radtke')) return 'radtke';
    if (lower.includes('signature')) return 'signaturesports';
    if (lower.includes('greatsports') || lower.includes('great-sports') || lower.includes('great_sports')) return 'greatsports';
    if (lower.includes('pristine')) return 'pristine';

    return null;
}

// ============ PARSERS ============

// Common team normalizer
function normalizeTeam(team) {
    if (!team) return '';
    const teamMap = {
        'arizona cardinals': 'Cardinals', 'atlanta falcons': 'Falcons',
        'baltimore ravens': 'Ravens', 'buffalo bills': 'Bills',
        'carolina panthers': 'Panthers', 'chicago bears': 'Bears',
        'cincinnati bengals': 'Bengals', 'cleveland browns': 'Browns',
        'dallas cowboys': 'Cowboys', 'denver broncos': 'Broncos',
        'detroit lions': 'Lions', 'green bay packers': 'Packers',
        'houston texans': 'Texans', 'indianapolis colts': 'Colts',
        'jacksonville jaguars': 'Jaguars', 'kansas city chiefs': 'Chiefs',
        'las vegas raiders': 'Raiders', 'los angeles chargers': 'Chargers',
        'los angeles rams': 'Rams', 'miami dolphins': 'Dolphins',
        'minnesota vikings': 'Vikings', 'new england patriots': 'Patriots',
        'new orleans saints': 'Saints', 'new york giants': 'Giants',
        'new york jets': 'Jets', 'oakland raiders': 'Raiders',
        'philadelphia eagles': 'Eagles', 'pittsburgh steelers': 'Steelers',
        'san francisco 49ers': '49ers', 'seattle seahawks': 'Seahawks',
        'tampa bay buccaneers': 'Buccaneers', 'tennessee titans': 'Titans',
        'washington commanders': 'Commanders',
    };
    const lower = team.toLowerCase().trim();
    return teamMap[lower] || team.trim();
}

// Parse design type from text
function parseDesignType(text) {
    const lower = (text || '').toLowerCase();
    if (lower.includes('eclipse')) return 'eclipse';
    if (lower.includes('flash')) return 'flash';
    if (lower.includes('slate')) return 'slate';
    if (lower.includes('camo')) return 'camo';
    if (lower.includes('salute')) return 'salute';
    if (lower.includes('amp')) return 'amp';
    if (lower.includes('rave')) return 'rave';
    if (lower.includes('lunar')) return 'lunar';
    if (lower.includes('blaze')) return 'blaze';
    if (lower.includes('chrome')) return 'chrome';
    if (lower.includes('throwback')) return 'throwback';
    if (lower.includes('alternate') || lower.includes('alt')) return 'alternate';
    return 'regular';
}

// Parse helmet type from text
function parseHelmetType(text, sheetName = '') {
    const lower = (text + ' ' + sheetName).toLowerCase();
    if (lower.includes('mini')) return 'mini';
    if (lower.includes('midi')) return 'midi';
    if (lower.includes('authentic') || lower.includes('proline') || lower.includes('speedflex')) return 'fullsize-authentic';
    if (lower.includes('replica')) return 'fullsize-replica';
    return 'fullsize-replica';
}

// Normalize player name (handles "Last, First" format)
function normalizePlayerName(name) {
    if (!name) return '';
    if (name.includes(',')) {
        const parts = name.split(',').map(p => p.trim());
        if (parts.length === 2) return `${parts[1]} ${parts[0]}`;
    }
    return name.trim();
}

// Parse price from various formats
function parsePrice(value) {
    if (!value) return null;
    if (typeof value === 'number') return value > 0 ? value : null;
    const cleaned = value.toString().replace(/[$,]/g, '');
    const price = parseFloat(cleaned);
    return isNaN(price) || price <= 0 ? null : price;
}

// ============ IMPORT HANDLERS ============

async function importDenverAutographs(filePath) {
    const workbook = XLSX.readFile(filePath);
    const results = { added: 0, updated: 0, skipped: 0, errors: 0 };

    const helmetTabs = ['FS HELMET', 'MINI & MIDI HELMET'];

    for (const sheetName of helmetTabs) {
        if (!workbook.SheetNames.includes(sheetName)) continue;

        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }).slice(1);

        for (const row of data) {
            try {
                let player, team, helmetTypeCol, helmetTypeCol2, price;

                if (sheetName === 'FS HELMET') {
                    [player, team, helmetTypeCol, helmetTypeCol2, price] = row;
                } else {
                    [player, team, , helmetTypeCol, price] = row;
                    helmetTypeCol2 = '';
                }

                player = normalizePlayerName(player);
                team = normalizeTeam(team);
                price = parsePrice(price);

                if (!player || !price) { results.skipped++; continue; }

                const helmetType = parseHelmetType(helmetTypeCol || '', sheetName);
                const designType = parseDesignType(helmetTypeCol2 || helmetTypeCol || '');

                if (!team) team = extractTeamFromName(`${player} helmet`) || '';

                const existing = await findHelmet(player, team, helmetType, designType);

                if (existing) {
                    const result = await upsertPrice(existing.id, 'denverautographs', price);
                    if (result.success) results.updated++;
                    else results.errors++;
                } else {
                    const name = `${player} ${team} Autographed ${helmetType} Helmet`;
                    const uniqueId = `${player}-${team}-${helmetType}-${designType}-${Date.now()}`.toLowerCase().replace(/[^a-z0-9-]/g, '');

                    const { data: newHelmet, error } = await supabase
                        .from('helmets')
                        .insert({ name, player, team, helmet_type: helmetType, design_type: designType, ebay_search_query: uniqueId, is_active: true })
                        .select();

                    if (error) { results.errors++; continue; }

                    if (newHelmet?.[0]) await upsertPrice(newHelmet[0].id, 'denverautographs', price);
                    results.added++;
                }
            } catch (err) {
                results.errors++;
            }
        }
    }

    return results;
}

async function importFanatics(filePath) {
    const workbook = XLSX.readFile(filePath);
    const results = { added: 0, updated: 0, skipped: 0, errors: 0 };

    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet);

        for (const row of data) {
            try {
                const firstName = row.PlayerFirst || '';
                const lastName = row.PlayerLast || '';
                const player = `${firstName} ${lastName}`.trim();

                if (!player) { results.skipped++; continue; }

                let team = normalizeTeam(row.Team || '');
                const type = row.Type || '';
                const item = row.Item || row.Description || '';
                const price = parsePrice(row.Retail || row.Price);

                if (!price) { results.skipped++; continue; }

                const helmetType = parseHelmetType(type + ' ' + item, sheetName);
                const designType = parseDesignType(item + ' ' + type);

                if (!team) team = extractTeamFromName(item) || '';

                const existing = await findHelmet(player, team, helmetType, designType);

                if (existing) {
                    const result = await upsertPrice(existing.id, 'fanatics', price);
                    if (result.success) results.updated++;
                    else results.errors++;
                } else {
                    const name = `${player} ${team} Autographed ${item}`.trim();
                    const ebayQuery = `${player} ${team} autographed signed helmet`.toLowerCase();

                    const { data: newHelmet, error } = await supabase
                        .from('helmets')
                        .insert({ name, player, team, helmet_type: helmetType, design_type: designType, ebay_search_query: ebayQuery, is_active: true })
                        .select();

                    if (error) { results.errors++; continue; }

                    if (newHelmet?.[0]) await upsertPrice(newHelmet[0].id, 'fanatics', price);
                    results.added++;
                }
            } catch (err) {
                results.errors++;
            }
        }
    }

    return results;
}

async function importGreatSports(filePath) {
    const workbook = XLSX.readFile(filePath);
    const results = { added: 0, updated: 0, skipped: 0, errors: 0 };

    const helmetTabs = ['Full Size', 'Minis', 'MIDI'];

    for (const sheetName of workbook.SheetNames) {
        if (!helmetTabs.includes(sheetName)) continue;

        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet);

        for (const row of data) {
            try {
                const firstName = row.PlayerFirst || '';
                const lastName = row.PlayerLast || '';
                const player = `${firstName} ${lastName}`.trim();

                if (!player) { results.skipped++; continue; }

                let team = normalizeTeam(row.Team || '');
                const type = row.Type || '';
                const item = row.Item || row.Description || '';
                const price = parsePrice(row.Retail || row.Price);

                if (!price) { results.skipped++; continue; }

                const helmetType = parseHelmetType(type + ' ' + item, sheetName);
                const designType = parseDesignType(item + ' ' + type);

                if (!team) team = extractTeamFromName(item) || '';

                const existing = await findHelmet(player, team, helmetType, designType);

                if (existing) {
                    const result = await upsertPrice(existing.id, 'greatsports', price);
                    if (result.success) results.updated++;
                    else results.errors++;
                } else {
                    const name = `${player} ${team} Autographed ${helmetType} Helmet`;
                    const uniqueId = `${player}-${team}-${helmetType}-${designType}-${Date.now()}`.toLowerCase().replace(/[^a-z0-9-]/g, '');

                    const { data: newHelmet, error } = await supabase
                        .from('helmets')
                        .insert({ name, player, team, helmet_type: helmetType, design_type: designType, ebay_search_query: uniqueId, is_active: true })
                        .select();

                    if (error) { results.errors++; continue; }

                    if (newHelmet?.[0]) await upsertPrice(newHelmet[0].id, 'greatsports', price);
                    results.added++;
                }
            } catch (err) {
                results.errors++;
            }
        }
    }

    return results;
}

async function importSignatureSports(filePath) {
    const workbook = XLSX.readFile(filePath);
    const results = { added: 0, updated: 0, skipped: 0, errors: 0 };

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet);

    for (const row of data) {
        try {
            const player = normalizePlayerName(row.player);
            if (!player) { results.skipped++; continue; }

            let team = normalizeTeam(row.team || '');
            const helmetType = parseHelmetType(row.helmet_type || '');
            const designType = parseDesignType(row.design_type || '');
            const price = parsePrice(row.Price);

            if (!price) { results.skipped++; continue; }

            const existing = await findHelmet(player, team, helmetType, designType);

            if (existing) {
                const result = await upsertPrice(existing.id, 'signaturesports', price);
                if (result.success) results.updated++;
                else results.errors++;
            } else {
                const name = `${player} ${team} Autographed ${row.helmet_type}`.trim();
                const ebayQuery = `${player} ${team} autographed signed helmet`.toLowerCase();

                const { data: newHelmet, error } = await supabase
                    .from('helmets')
                    .insert({ name, player, team, helmet_type: helmetType, design_type: designType, ebay_search_query: ebayQuery, is_active: true })
                    .select();

                if (error) { results.errors++; continue; }

                if (newHelmet?.[0]) await upsertPrice(newHelmet[0].id, 'signaturesports', price);
                results.added++;
            }
        } catch (err) {
            results.errors++;
        }
    }

    return results;
}

// Generic handler for unknown formats - tries to auto-detect columns
async function importGeneric(filePath, source) {
    const workbook = XLSX.readFile(filePath);
    const results = { added: 0, updated: 0, skipped: 0, errors: 0 };

    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet);

        if (data.length === 0) continue;

        // Try to auto-detect column names
        const cols = Object.keys(data[0]);
        const playerCol = cols.find(c => /player|name/i.test(c));
        const teamCol = cols.find(c => /team/i.test(c));
        const priceCol = cols.find(c => /price|retail|srp|cost/i.test(c));
        const typeCol = cols.find(c => /type|helmet/i.test(c));

        if (!playerCol || !priceCol) {
            console.log(`   Could not detect columns in sheet "${sheetName}"`);
            continue;
        }

        for (const row of data) {
            try {
                const player = normalizePlayerName(row[playerCol]);
                if (!player) { results.skipped++; continue; }

                let team = normalizeTeam(row[teamCol] || '');
                const price = parsePrice(row[priceCol]);

                if (!price) { results.skipped++; continue; }

                const helmetType = parseHelmetType(row[typeCol] || '', sheetName);
                const designType = parseDesignType(row[typeCol] || '');

                const existing = await findHelmet(player, team, helmetType, designType);

                if (existing) {
                    const result = await upsertPrice(existing.id, source, price);
                    if (result.success) results.updated++;
                    else results.errors++;
                } else {
                    const name = `${player} ${team} Autographed ${helmetType} Helmet`;
                    const uniqueId = `${player}-${team}-${helmetType}-${Date.now()}`.toLowerCase().replace(/[^a-z0-9-]/g, '');

                    const { data: newHelmet, error } = await supabase
                        .from('helmets')
                        .insert({ name, player, team, helmet_type: helmetType, design_type: designType, ebay_search_query: uniqueId, is_active: true })
                        .select();

                    if (error) { results.errors++; continue; }

                    if (newHelmet?.[0]) await upsertPrice(newHelmet[0].id, source, price);
                    results.added++;
                }
            } catch (err) {
                results.errors++;
            }
        }
    }

    return results;
}

// ============ MAIN IMPORT FUNCTION ============

async function importFile(filePath) {
    const filename = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();

    // Only process Excel files
    if (!['.xls', '.xlsx', '.ods'].includes(ext)) {
        console.log(`   Skipping non-spreadsheet file: ${filename}`);
        return null;
    }

    const source = detectSource(filename);

    console.log(`\n${'═'.repeat(50)}`);
    console.log(`  IMPORTING: ${filename}`);
    console.log(`  Source: ${source || 'auto-detect'}`);
    console.log(`${'═'.repeat(50)}`);

    let results;

    switch (source) {
        case 'denverautographs':
            results = await importDenverAutographs(filePath);
            break;
        case 'fanatics':
            results = await importFanatics(filePath);
            break;
        case 'greatsports':
            results = await importGreatSports(filePath);
            break;
        case 'signaturesports':
            results = await importSignatureSports(filePath);
            break;
        default:
            // Try generic import with source from filename or 'unknown'
            const inferredSource = source || filename.split(/[_\-\s.]/)[0].toLowerCase();
            results = await importGeneric(filePath, inferredSource);
    }

    console.log(`\n  Results:`);
    console.log(`    New helmets:  ${results.added}`);
    console.log(`    Updated:      ${results.updated}`);
    console.log(`    Skipped:      ${results.skipped}`);
    console.log(`    Errors:       ${results.errors}`);
    console.log(`${'═'.repeat(50)}\n`);

    return results;
}

// ============ FILE WATCHER ============

function watchForFiles() {
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`  AUTO-IMPORT WATCHER`);
    console.log(`${'═'.repeat(50)}`);
    console.log(`  Watching: ${IMPORT_FOLDER}`);
    console.log(`  Drop .xls/.xlsx/.ods files to auto-import`);
    console.log(`  Press Ctrl+C to stop\n`);

    // Process any existing files first
    const existingFiles = fs.readdirSync(IMPORT_FOLDER).filter(f =>
        ['.xls', '.xlsx', '.ods'].includes(path.extname(f).toLowerCase())
    );

    if (existingFiles.length > 0) {
        console.log(`  Found ${existingFiles.length} existing file(s) to process...\n`);
        processExistingFiles(existingFiles);
    }

    // Watch for new files
    fs.watch(IMPORT_FOLDER, async (eventType, filename) => {
        if (eventType === 'rename' && filename) {
            const filePath = path.join(IMPORT_FOLDER, filename);
            const ext = path.extname(filename).toLowerCase();

            // Only process spreadsheet files
            if (!['.xls', '.xlsx', '.ods'].includes(ext)) return;

            // Wait a moment for file to be fully written
            await new Promise(r => setTimeout(r, 1000));

            // Check if file exists (not deleted)
            if (fs.existsSync(filePath)) {
                try {
                    await importFile(filePath);

                    // Move to processed folder
                    const processedPath = path.join(PROCESSED_FOLDER, `${Date.now()}_${filename}`);
                    fs.renameSync(filePath, processedPath);
                    console.log(`  Moved to: processed/${path.basename(processedPath)}\n`);
                } catch (err) {
                    console.error(`  Error processing ${filename}:`, err.message);
                }
            }
        }
    });
}

async function processExistingFiles(files) {
    for (const filename of files) {
        const filePath = path.join(IMPORT_FOLDER, filename);
        try {
            await importFile(filePath);

            // Move to processed folder
            const processedPath = path.join(PROCESSED_FOLDER, `${Date.now()}_${filename}`);
            fs.renameSync(filePath, processedPath);
            console.log(`  Moved to: processed/${path.basename(processedPath)}\n`);
        } catch (err) {
            console.error(`  Error processing ${filename}:`, err.message);
        }
    }
}

// ============ CLI ============

async function main() {
    // Validate database connection
    const schemaCheck = await validateSchema();
    if (!schemaCheck.valid) {
        console.error('Database schema validation failed');
        process.exit(1);
    }

    const args = process.argv.slice(2);

    if (args.includes('--watch') || args.includes('-w')) {
        // Watch mode
        watchForFiles();
    } else if (args.length > 0) {
        // Import specific file(s)
        for (const arg of args) {
            if (arg.startsWith('-')) continue;

            const filePath = path.resolve(arg);
            if (!fs.existsSync(filePath)) {
                console.error(`File not found: ${filePath}`);
                continue;
            }

            await importFile(filePath);
        }
        process.exit(0);
    } else {
        // Show usage
        console.log(`
Auto-Import - Automated helmet pricing import

Usage:
  node scripts/auto-import.js <file>       Import a single file
  node scripts/auto-import.js --watch      Watch imports/ folder for new files
  npm run import <file>                    Shortcut for single file
  npm run import:watch                     Shortcut for watch mode

Supported sources (auto-detected by filename):
  - Denver Autographs:  *denver*, *breakers*
  - Fanatics:           *fanatics*, *inventory*
  - RSA:                *rsa*, *shoprsa*
  - Radtke:             *radtke*
  - Signature Sports:   *signature*
  - Great Sports:       *greatsports*, *great-sports*

Import folder: ${IMPORT_FOLDER}
`);
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
