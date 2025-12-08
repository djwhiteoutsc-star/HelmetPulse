const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function fixMiniAuthenticIssue() {
    console.log('🔧 Finding and fixing helmet categorization issues...\n');

    try {
        // STEP 1: Find all helmets with mini + authentic issue
        console.log('Step 1: Finding all helmets with "mini / authentic" combination...\n');

        const { data: problematicHelmets, error: searchError } = await supabase
            .from('helmets')
            .select('*')
            .eq('helmet_type', 'mini')
            .eq('design_type', 'authentic');

        if (searchError) throw searchError;

        console.log(`Found ${problematicHelmets?.length || 0} helmets with this issue\n`);

        if (problematicHelmets && problematicHelmets.length > 0) {
            console.log('Helmets to fix:');
            problematicHelmets.forEach(h => {
                console.log(`  - ID ${h.id}: ${h.name.substring(0, 60)}...`);
            });
            console.log('');

            // STEP 2: Fix them by updating design_type to 'regular'
            console.log('Step 2: Updating design_type from "authentic" to "regular"...\n');

            for (const helmet of problematicHelmets) {
                const { error: updateError } = await supabase
                    .from('helmets')
                    .update({ design_type: 'regular' })
                    .eq('id', helmet.id);

                if (updateError) {
                    console.log(`  ❌ Error updating ID ${helmet.id}: ${updateError.message}`);
                } else {
                    console.log(`  ✅ Updated ID ${helmet.id}`);
                }
            }
            console.log('');
        }

        // STEP 3: Check for prices from Fanatics spreadsheets
        console.log('Step 3: Checking Fanatics spreadsheets for Bo Nix prices...\n');

        const files = [
            'C:\\Users\\18036\\Desktop\\CardPulse\\Fanatics\\Fanatics in stock FULL SIZE HELMETS.xlsx',
            'C:\\Users\\18036\\Desktop\\CardPulse\\Fanatics\\Fanatics in stock MINI HELMETS.xlsx'
        ];

        const boNixHelmets = [];

        for (const file of files) {
            try {
                const workbook = XLSX.readFile(file);
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const data = XLSX.utils.sheet_to_json(worksheet);

                for (const row of data) {
                    const description = row.Description || row.description || row.Title || row.title || '';
                    const srp = row.SRP || row.srp || row.Price || row.price || 0;

                    if (description.toLowerCase().includes('bo nix')) {
                        boNixHelmets.push({
                            description,
                            price: typeof srp === 'number' ? srp : parseFloat(String(srp).replace(/[$,]/g, '')) || 0,
                            file: file.includes('FULL SIZE') ? 'Full Size' : 'Mini'
                        });
                    }
                }
            } catch (error) {
                console.log(`  ⚠️ Error reading ${file.split('\\').pop()}: ${error.message}`);
            }
        }

        if (boNixHelmets.length > 0) {
            console.log(`Found ${boNixHelmets.length} Bo Nix helmets in Fanatics spreadsheets:\n`);
            boNixHelmets.forEach((h, i) => {
                console.log(`  ${i + 1}. [${h.file}] $${h.price} - ${h.description.substring(0, 60)}...`);
            });
            console.log('');

            // Add prices to matching helmets
            console.log('Step 4: Adding prices to Bo Nix helmets...\n');

            const { data: allBoNixHelmets } = await supabase
                .from('helmets')
                .select('*')
                .or('name.ilike.%bo%nix%,player.ilike.%bo%nix%');

            let pricesAdded = 0;
            let pricesSkipped = 0;

            for (const fanaticsHelmet of boNixHelmets) {
                // Try to match with database helmet
                const searchQuery = fanaticsHelmet.description.toLowerCase().replace(/[^a-z0-9\s]/g, '').substring(0, 200);

                const matchingHelmet = allBoNixHelmets?.find(h => {
                    const dbQuery = h.name.toLowerCase().replace(/[^a-z0-9\s]/g, '').substring(0, 200);
                    return dbQuery.includes(searchQuery.substring(0, 30)) || searchQuery.includes(dbQuery.substring(0, 30));
                });

                if (matchingHelmet) {
                    // Check if price already exists
                    const { data: existingPrices } = await supabase
                        .from('helmet_prices')
                        .select('id')
                        .eq('helmet_id', matchingHelmet.id)
                        .eq('source', 'fanatics');

                    if (existingPrices && existingPrices.length > 0) {
                        console.log(`  ⏭️  Skipped ID ${matchingHelmet.id} - already has Fanatics price`);
                        pricesSkipped++;
                    } else {
                        // Add price
                        const { error: priceError } = await supabase
                            .from('helmet_prices')
                            .insert({
                                helmet_id: matchingHelmet.id,
                                median_price: fanaticsHelmet.price,
                                min_price: fanaticsHelmet.price,
                                max_price: fanaticsHelmet.price,
                                total_results: 1,
                                source: 'fanatics'
                            });

                        if (priceError) {
                            console.log(`  ❌ Error adding price to ID ${matchingHelmet.id}: ${priceError.message}`);
                        } else {
                            console.log(`  ✅ Added $${fanaticsHelmet.price} to ID ${matchingHelmet.id} - ${matchingHelmet.name.substring(0, 50)}...`);
                            pricesAdded++;
                        }
                    }
                }
            }

            console.log(`\n  Prices added: ${pricesAdded}`);
            console.log(`  Prices skipped (already exists): ${pricesSkipped}`);
            console.log(`  Not matched: ${boNixHelmets.length - pricesAdded - pricesSkipped}`);
        } else {
            console.log('No Bo Nix helmets found in Fanatics spreadsheets\n');
        }

        console.log('\n═══════════════════════════════════════');
        console.log('✅ PROCESS COMPLETE');
        console.log('═══════════════════════════════════════\n');

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

fixMiniAuthenticIssue();
