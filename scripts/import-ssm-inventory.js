/**
 * Import SSM (Signature Sports Memorabilia) Inventory
 * Source file: SSM/Authentic Helmet Inventory 12.23.25 (1).xls
 */

const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
const { upsertPrice } = require('./lib/price-utils');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const SOURCE = 'signaturesports';

async function importSSMInventory() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('SSM Authentic Helmet Inventory Import');
    console.log('═══════════════════════════════════════════════════════\n');

    // Read the spreadsheet
    const filePath = 'SSM/Authentic Helmet Inventory 12.23.25 (1).xls';
    console.log(`Reading: ${filePath}\n`);

    const workbook = XLSX.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    // Skip header row
    const rows = data.slice(1).filter(row => row.length >= 4 && row[1] && row[3]);

    console.log(`Found ${rows.length} helmet records\n`);

    let processed = 0;
    let newHelmets = 0;
    let existingHelmets = 0;
    let pricesAdded = 0;
    let errors = 0;

    for (const row of rows) {
        try {
            const team = String(row[0] || '').trim();
            const player = String(row[1] || '').trim();
            const helmetType = String(row[2] || '').trim();
            const price = parseFloat(row[3]);

            if (!player || !price || price <= 0) {
                continue;
            }

            // Build helmet name
            const name = `${player} ${team} ${helmetType} Autographed Helmet`.trim();

            // Check if helmet exists
            const { data: existing } = await supabase
                .from('helmets')
                .select('id')
                .eq('player', player)
                .eq('team', team)
                .eq('helmet_type', helmetType)
                .single();

            let helmetId;

            if (existing) {
                helmetId = existing.id;
                existingHelmets++;
            } else {
                // Insert new helmet
                const { data: newHelmet, error } = await supabase
                    .from('helmets')
                    .insert({
                        name,
                        player,
                        team,
                        helmet_type: helmetType,
                        design_type: 'Standard'
                    })
                    .select()
                    .single();

                if (error) {
                    errors++;
                    if (errors <= 5) {
                        console.log(`   Error inserting ${player}: ${error.message}`);
                    }
                    continue;
                }

                helmetId = newHelmet.id;
                newHelmets++;
            }

            // Add price using shared utility
            const result = await upsertPrice(helmetId, SOURCE, price);
            if (result.success) {
                pricesAdded++;
            }

            processed++;

            if (processed % 100 === 0) {
                console.log(`   Processed: ${processed}/${rows.length}`);
            }

        } catch (err) {
            errors++;
            if (errors <= 5) {
                console.log(`   Error: ${err.message}`);
            }
        }
    }

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('Import Complete');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`   Total processed: ${processed}`);
    console.log(`   New helmets: ${newHelmets}`);
    console.log(`   Existing helmets: ${existingHelmets}`);
    console.log(`   Prices recorded: ${pricesAdded}`);
    console.log(`   Errors: ${errors}`);
    console.log('═══════════════════════════════════════════════════════\n');
}

importSSMInventory()
    .then(() => { console.log('Done!\n'); process.exit(0); })
    .catch(err => { console.error('Fatal:', err); process.exit(1); });
