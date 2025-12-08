const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Helper to parse helmet title into components
function parseHelmetTitle(title) {
    const titleLower = title.toLowerCase();

    // Determine type
    let type = 'authentic';
    if (titleLower.includes('mini')) type = 'mini';
    else if (titleLower.includes('replica') || titleLower.includes('speed')) type = 'replica';

    // Try to extract player name (usually at start)
    let playerName = '';
    let team = '';

    // Simple extraction - take first few words as player name
    const words = title.split(' ');
    if (words.length >= 2) {
        playerName = `${words[0]} ${words[1]}`;
    }

    // Extract team from common patterns
    const nflTeams = [
        'Cardinals', 'Falcons', 'Ravens', 'Bills', 'Panthers', 'Bears', 'Bengals', 'Browns',
        'Cowboys', 'Broncos', 'Lions', 'Packers', 'Texans', 'Colts', 'Jaguars', 'Chiefs',
        'Raiders', 'Chargers', 'Rams', 'Dolphins', 'Vikings', 'Patriots', 'Saints',
        'Giants', 'Jets', 'Eagles', 'Steelers', '49ers', 'Seahawks', 'Buccaneers',
        'Titans', 'Commanders', 'Football Team'
    ];

    for (const nflTeam of nflTeams) {
        if (titleLower.includes(nflTeam.toLowerCase())) {
            team = nflTeam;
            break;
        }
    }

    return { playerName, team, type };
}

async function importFanaticsSpreadsheets() {
    console.log('📊 Importing Fanatics Spreadsheets...\n');

    const files = [
        'C:\\Users\\18036\\Desktop\\CardPulse\\Fanatics\\Fanatics in stock FULL SIZE HELMETS.xlsx',
        'C:\\Users\\18036\\Desktop\\CardPulse\\Fanatics\\Fanatics in stock MINI HELMETS.xlsx'
    ];

    let totalHelmets = [];

    for (const file of files) {
        console.log(`\n📁 Reading: ${file.split('\\').pop()}`);

        try {
            const workbook = XLSX.readFile(file);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json(worksheet);

            console.log(`   Found ${data.length} rows`);

            // Show first row to understand structure
            if (data.length > 0) {
                console.log('\n   Column names:', Object.keys(data[0]).join(', '));
                console.log('\n   Sample row:', data[0]);
            }

            // Process each row
            for (const row of data) {
                // Find title column (might be "Title", "Product Name", "Description", etc.)
                const titleColumn = Object.keys(row).find(key =>
                    key.toLowerCase().includes('title') ||
                    key.toLowerCase().includes('product') ||
                    key.toLowerCase().includes('description') ||
                    key.toLowerCase().includes('name')
                );

                // Find SRP column for price
                const priceColumn = Object.keys(row).find(key =>
                    key.toUpperCase().includes('SRP') ||
                    key.toLowerCase().includes('price') ||
                    key.toLowerCase().includes('retail')
                );

                if (!titleColumn || !priceColumn) {
                    console.log('   ⚠️ Could not find title or price columns');
                    continue;
                }

                const title = row[titleColumn];
                let price = row[priceColumn];

                // Parse price (remove $ and commas)
                if (typeof price === 'string') {
                    price = parseFloat(price.replace(/[$,]/g, ''));
                } else if (typeof price === 'number') {
                    price = parseFloat(price);
                }

                // Skip if invalid
                if (!title || !price || isNaN(price) || price <= 0) {
                    continue;
                }

                // Only include helmets
                const titleLower = title.toLowerCase();
                if (!titleLower.includes('helmet')) {
                    continue;
                }

                totalHelmets.push({
                    title,
                    price,
                    source: 'fanatics'
                });
            }

        } catch (error) {
            console.log(`   ❌ Error reading file: ${error.message}`);
        }
    }

    console.log(`\n\n═══════════════════════════════════════`);
    console.log(`📊 IMPORT SUMMARY`);
    console.log(`═══════════════════════════════════════`);
    console.log(`Total helmets found: ${totalHelmets.length}`);
    console.log(`═══════════════════════════════════════\n`);

    if (totalHelmets.length === 0) {
        console.log('⚠️  No helmets to import\n');
        return;
    }

    // Show samples
    console.log('📋 Sample helmets:');
    totalHelmets.slice(0, 5).forEach((h, i) => {
        console.log(`   ${i + 1}. $${h.price} - ${h.title.substring(0, 60)}...`);
    });

    // Upload to database
    console.log('\n\n💾 Uploading to database...\n');

    let saved = 0;
    let pricesAdded = 0;
    let errors = 0;

    for (const helmet of totalHelmets) {
        try {
            const parsed = parseHelmetTitle(helmet.title);

            // Create search query for lookup
            const searchQuery = helmet.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').substring(0, 200);

            // Check if helmet exists
            const { data: existing } = await supabase
                .from('helmets')
                .select('id')
                .eq('ebay_search_query', searchQuery)
                .single();

            let helmetId;

            if (existing) {
                // Update existing
                helmetId = existing.id;
            } else {
                // Insert new
                const { data: newHelmet, error } = await supabase
                    .from('helmets')
                    .insert({
                        name: helmet.title.substring(0, 250),
                        player: parsed.playerName || null,
                        team: parsed.team || null,
                        helmet_type: parsed.type,
                        design_type: 'authentic',
                        auth_company: 'Fanatics',
                        ebay_search_query: searchQuery
                    })
                    .select()
                    .single();

                if (error) throw error;
                helmetId = newHelmet.id;
                saved++;
            }

            // Add price record
            const { error: priceError } = await supabase
                .from('helmet_prices')
                .insert({
                    helmet_id: helmetId,
                    median_price: helmet.price,
                    min_price: helmet.price,
                    max_price: helmet.price,
                    total_results: 1,
                    source: helmet.source
                });

            if (priceError) {
                // If source column doesn't exist, try without it
                if (priceError.message.includes('source')) {
                    const { error: retry } = await supabase.from('helmet_prices').insert({
                        helmet_id: helmetId,
                        median_price: helmet.price,
                        min_price: helmet.price,
                        max_price: helmet.price,
                        total_results: 1
                    });
                    if (!retry) pricesAdded++;
                } else if (pricesAdded === 0) {
                    console.log(`   ⚠️ Price error: ${priceError.message}`);
                }
            } else {
                pricesAdded++;
            }

        } catch (error) {
            errors++;
            if (errors <= 5) {
                console.log(`   ⚠️ Error: ${error.message.substring(0, 100)}`);
            }
        }
    }

    console.log('\n═══════════════════════════════════════');
    console.log('✅ UPLOAD COMPLETE');
    console.log('═══════════════════════════════════════');
    console.log(`   New helmets: ${saved}`);
    console.log(`   Prices recorded: ${pricesAdded}`);
    console.log(`   Errors: ${errors}`);
    console.log('═══════════════════════════════════════\n');
}

// Run
importFanaticsSpreadsheets()
    .then(() => { console.log('🎉 Done!\n'); process.exit(0); })
    .catch(error => { console.error('❌ Fatal:', error); process.exit(1); });
