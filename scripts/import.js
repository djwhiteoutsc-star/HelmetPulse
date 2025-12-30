#!/usr/bin/env node
/**
 * HelmetPulse - Master Import Controller
 *
 * Usage:
 *   node scripts/import.js <source> [--use-cache] [--dry-run]
 *
 * Sources:
 *   radtke    - Import from Radtke Sports (3000+ helmets)
 *   rsa       - Import from Shop RSA (1400+ helmets)
 *   fanatics  - Import from Fanatics Excel file
 *   all       - Run all importers sequentially
 *   status    - Show current database stats
 *
 * Options:
 *   --use-cache   Skip scraping, use cached data from previous run
 *   --dry-run     Validate data but don't import to database
 *
 * Examples:
 *   npm run import radtke
 *   npm run import rsa -- --use-cache
 *   npm run import all
 *   npm run import status
 */

const { spawn } = require('child_process');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Available import sources
const SOURCES = {
    radtke: {
        script: 'import-radtke-all.js',
        description: 'Radtke Sports - Full helmet catalog via web scraping',
        url: 'https://www.radtkesports.com/?s=helmet&product_cat=0&post_type=product'
    },
    rsa: {
        script: 'import-rsa-all.js',
        description: 'Shop RSA - Full helmet catalog via Shopify API',
        url: 'https://www.shoprsa.com/collections/signed-nfl-football-helmets'
    },
    fanatics: {
        script: 'import-fanatics-inventory.js',
        description: 'Fanatics - Import from Excel inventory file',
        url: 'Local Excel file'
    }
};

function printUsage() {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║           HELMETPULSE - DATA IMPORT CONTROLLER                ║
╚═══════════════════════════════════════════════════════════════╝

USAGE:
  npm run import <source> [options]

SOURCES:
  radtke     Import from Radtke Sports (~3000 helmets, web scraping)
  rsa        Import from Shop RSA (~1400 helmets, Shopify API)
  fanatics   Import from Fanatics Excel file
  all        Run all importers sequentially
  status     Show current database statistics

OPTIONS:
  --use-cache   Use cached data from previous scrape (skip network)
  --dry-run     Validate only, don't write to database

EXAMPLES:
  npm run import radtke              # Fresh scrape from Radtke
  npm run import rsa -- --use-cache  # Use cached RSA data
  npm run import all                 # Import from all sources
  npm run import status              # Check database stats

INDIVIDUAL SCRIPTS:
  npm run import:radtke     # Direct Radtke import
  npm run import:rsa        # Direct RSA import
  npm run import:fanatics   # Direct Fanatics import
`);
}

async function showStatus() {
    console.log('\n╔═══════════════════════════════════════════════════════════════╗');
    console.log('║               DATABASE STATUS                                 ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝\n');

    // Get helmet count
    const { count: totalHelmets } = await supabase
        .from('helmets')
        .select('*', { count: 'exact', head: true });

    console.log(`📊 Total Helmets: ${totalHelmets}\n`);

    // Get price counts by source
    const sources = ['fanatics', 'rsa', 'radtke', 'pristine', 'signaturesports', 'greatsports'];
    console.log('💰 Prices by Source:');

    for (const source of sources) {
        const { count } = await supabase
            .from('helmet_prices')
            .select('*', { count: 'exact', head: true })
            .eq('source', source);

        if (count > 0) {
            console.log(`   ${source.padEnd(12)} ${count} prices`);
        }
    }

    // Get helmet type distribution
    const { data: helmets } = await supabase
        .from('helmets')
        .select('helmet_type');

    const typeCounts = {};
    (helmets || []).forEach(h => {
        typeCounts[h.helmet_type] = (typeCounts[h.helmet_type] || 0) + 1;
    });

    console.log('\n🎯 Helmet Types:');
    Object.entries(typeCounts)
        .sort((a, b) => b[1] - a[1])
        .forEach(([type, count]) => {
            console.log(`   ${type.padEnd(20)} ${count}`);
        });

    // Get team distribution (top 10)
    const { data: teamData } = await supabase
        .from('helmets')
        .select('team');

    const teamCounts = {};
    (teamData || []).forEach(h => {
        const team = h.team || 'Unknown';
        teamCounts[team] = (teamCounts[team] || 0) + 1;
    });

    console.log('\n🏈 Top 10 Teams:');
    Object.entries(teamCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .forEach(([team, count]) => {
            console.log(`   ${team.padEnd(15)} ${count}`);
        });

    console.log('\n═══════════════════════════════════════════════════════════════\n');
}

function runScript(scriptName, args = []) {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, scriptName);
        console.log(`\n🚀 Running: ${scriptName} ${args.join(' ')}\n`);
        console.log('─'.repeat(60) + '\n');

        const child = spawn('node', [scriptPath, ...args], {
            stdio: 'inherit',
            cwd: path.join(__dirname, '..')
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Script exited with code ${code}`));
            }
        });

        child.on('error', reject);
    });
}

async function main() {
    const args = process.argv.slice(2);
    const source = args[0]?.toLowerCase();
    const options = args.slice(1);

    if (!source || source === 'help' || source === '-h' || source === '--help') {
        printUsage();
        process.exit(0);
    }

    if (source === 'status') {
        await showStatus();
        process.exit(0);
    }

    if (source === 'all') {
        console.log('\n🔄 Running ALL importers sequentially...\n');

        for (const [name, config] of Object.entries(SOURCES)) {
            try {
                console.log(`\n${'═'.repeat(60)}`);
                console.log(`  IMPORTING FROM: ${name.toUpperCase()}`);
                console.log(`  ${config.description}`);
                console.log('═'.repeat(60));

                await runScript(config.script, options);
            } catch (error) {
                console.error(`\n❌ Error importing from ${name}: ${error.message}`);
            }
        }

        console.log('\n✅ All imports complete!\n');
        await showStatus();
        process.exit(0);
    }

    if (!SOURCES[source]) {
        console.error(`\n❌ Unknown source: ${source}`);
        console.log(`   Valid sources: ${Object.keys(SOURCES).join(', ')}, all, status`);
        process.exit(1);
    }

    try {
        const config = SOURCES[source];
        console.log(`\n${'═'.repeat(60)}`);
        console.log(`  IMPORTING FROM: ${source.toUpperCase()}`);
        console.log(`  ${config.description}`);
        console.log('═'.repeat(60));

        await runScript(config.script, options);

        console.log('\n✅ Import complete!\n');
    } catch (error) {
        console.error(`\n❌ Import failed: ${error.message}`);
        process.exit(1);
    }
}

main().catch(console.error);
