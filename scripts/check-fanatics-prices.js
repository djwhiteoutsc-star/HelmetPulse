const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function checkFanaticsPrices() {
    console.log('🔍 Checking Fanatics helmet prices...\n');

    try {
        // Get all Fanatics helmets
        const { data: fanaticsHelmets, error: helmetsError } = await supabase
            .from('helmets')
            .select('*')
            .eq('auth_company', 'Fanatics')
            .order('id', { ascending: true });

        if (helmetsError) throw helmetsError;

        console.log(`Found ${fanaticsHelmets?.length || 0} Fanatics helmets in database\n`);

        // Check each for prices
        let withPrices = 0;
        let withoutPrices = 0;
        const missingPrices = [];

        for (const helmet of fanaticsHelmets) {
            const { data: prices } = await supabase
                .from('helmet_prices')
                .select('*')
                .eq('helmet_id', helmet.id)
                .eq('source', 'fanatics');

            if (prices && prices.length > 0) {
                withPrices++;
            } else {
                withoutPrices++;
                missingPrices.push(helmet);
            }
        }

        console.log('═══════════════════════════════════════');
        console.log('📊 FANATICS PRICE COVERAGE');
        console.log('═══════════════════════════════════════');
        console.log(`Total Fanatics helmets:    ${fanaticsHelmets?.length || 0}`);
        console.log(`With Fanatics prices:      ${withPrices}`);
        console.log(`WITHOUT Fanatics prices:   ${withoutPrices}`);
        console.log('═══════════════════════════════════════\n');

        if (missingPrices.length > 0) {
            console.log(`Helmets missing Fanatics prices (showing first 10):\n`);
            missingPrices.slice(0, 10).forEach(h => {
                console.log(`  ID ${h.id}: ${h.name.substring(0, 60)}...`);
            });
            console.log('');

            // Now load spreadsheets and add missing prices
            console.log('📊 Loading Fanatics spreadsheets to add missing prices...\n');

            const files = [
                'C:\\Users\\18036\\Desktop\\CardPulse\\Fanatics\\Fanatics in stock FULL SIZE HELMETS.xlsx',
                'C:\\Users\\18036\\Desktop\\CardPulse\\Fanatics\\Fanatics in stock MINI HELMETS.xlsx'
            ];

            const spreadsheetData = [];

            for (const file of files) {
                try {
                    const workbook = XLSX.readFile(file);
                    const sheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[sheetName];
                    const data = XLSX.utils.sheet_to_json(worksheet);

                    for (const row of data) {
                        const description = row.Description || row.description || row.Title || row.title || '';
                        const srp = row.SRP || row.srp || row.Price || row.price || 0;

                        if (description && description.toLowerCase().includes('helmet')) {
                            const searchQuery = description.toLowerCase().replace(/[^a-z0-9\s]/g, '').substring(0, 200);
                            spreadsheetData.push({
                                description,
                                searchQuery,
                                price: typeof srp === 'number' ? srp : parseFloat(String(srp).replace(/[$,]/g, '')) || 0
                            });
                        }
                    }
                } catch (error) {
                    console.log(`  ⚠️ Error reading ${file.split('\\').pop()}: ${error.message}`);
                }
            }

            console.log(`Loaded ${spreadsheetData.length} helmets from spreadsheets\n`);
            console.log('Adding missing prices...\n');

            let pricesAdded = 0;
            let notMatched = 0;

            for (const helmet of missingPrices) {
                // Try to match with spreadsheet data
                const helmetQuery = helmet.name.toLowerCase().replace(/[^a-z0-9\s]/g, '').substring(0, 200);

                const match = spreadsheetData.find(s => {
                    return s.searchQuery === helmetQuery ||
                           s.description.toLowerCase() === helmet.name.toLowerCase();
                });

                if (match && match.price > 0) {
                    // Add price
                    const { error: priceError } = await supabase
                        .from('helmet_prices')
                        .insert({
                            helmet_id: helmet.id,
                            median_price: match.price,
                            min_price: match.price,
                            max_price: match.price,
                            total_results: 1,
                            source: 'fanatics'
                        });

                    if (priceError) {
                        console.log(`  ❌ Error adding price to ID ${helmet.id}: ${priceError.message}`);
                    } else {
                        console.log(`  ✅ Added $${match.price} to ID ${helmet.id}`);
                        pricesAdded++;
                    }
                } else {
                    notMatched++;
                    if (notMatched <= 5) {
                        console.log(`  ⚠️ No match found for ID ${helmet.id}: ${helmet.name.substring(0, 50)}...`);
                    }
                }
            }

            console.log('\n═══════════════════════════════════════');
            console.log('✅ PROCESS COMPLETE');
            console.log('═══════════════════════════════════════');
            console.log(`Prices added:     ${pricesAdded}`);
            console.log(`Not matched:      ${notMatched}`);
            console.log('═══════════════════════════════════════\n');
        } else {
            console.log('✅ All Fanatics helmets have prices!\n');
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

checkFanaticsPrices();
