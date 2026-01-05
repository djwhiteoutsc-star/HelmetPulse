/**
 * Migration: Add current_price column to helmets table
 *
 * This migration:
 * 1. Adds current_price column to helmets table (run manually in Supabase dashboard)
 * 2. Calculates median price for each helmet from helmet_prices
 * 3. Updates each helmet with its calculated median
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function calculateMedian(numbers) {
    if (!numbers || numbers.length === 0) return null;
    const sorted = [...numbers].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function migrate() {
    console.log('═══════════════════════════════════════════════════════');
    console.log('Migration: Add current_price to helmets');
    console.log('═══════════════════════════════════════════════════════\n');

    // Step 1: Check if column exists by trying to read it
    console.log('Step 1: Checking if current_price column exists...\n');

    const { data: testHelmet, error: testError } = await supabase
        .from('helmets')
        .select('id, current_price')
        .limit(1);

    if (testError && testError.message.includes('current_price')) {
        console.log('❌ Column "current_price" does not exist.\n');
        console.log('Please run this SQL in Supabase Dashboard (SQL Editor):\n');
        console.log('─────────────────────────────────────────────────────');
        console.log('ALTER TABLE helmets ADD COLUMN current_price DECIMAL(10,2);');
        console.log('CREATE INDEX idx_helmets_current_price ON helmets(current_price);');
        console.log('─────────────────────────────────────────────────────\n');
        console.log('After running the SQL, run this migration again.');
        process.exit(1);
    }

    console.log('✓ Column current_price exists\n');

    // Step 2: Get all helmets with their prices
    console.log('Step 2: Fetching all helmets and their prices...\n');

    // Get helmet count
    const { count: totalHelmets } = await supabase
        .from('helmets')
        .select('*', { count: 'exact', head: true });

    console.log(`   Total helmets: ${totalHelmets}\n`);

    // Process in batches to handle large datasets
    const BATCH_SIZE = 100;
    let processed = 0;
    let updated = 0;
    let offset = 0;

    while (offset < totalHelmets) {
        // Fetch batch of helmets
        const { data: helmets, error: helmetsError } = await supabase
            .from('helmets')
            .select('id')
            .range(offset, offset + BATCH_SIZE - 1);

        if (helmetsError) {
            console.error('Error fetching helmets:', helmetsError);
            break;
        }

        if (!helmets || helmets.length === 0) break;

        // For each helmet, get all prices and calculate median
        for (const helmet of helmets) {
            const { data: prices } = await supabase
                .from('helmet_prices')
                .select('median_price')
                .eq('helmet_id', helmet.id);

            if (prices && prices.length > 0) {
                const priceValues = prices.map(p => p.median_price).filter(p => p !== null && p > 0);
                const medianPrice = calculateMedian(priceValues);

                if (medianPrice !== null) {
                    // Update helmet with median price
                    const { error: updateError } = await supabase
                        .from('helmets')
                        .update({ current_price: medianPrice })
                        .eq('id', helmet.id);

                    if (!updateError) {
                        updated++;
                    }
                }
            }

            processed++;

            // Progress indicator
            if (processed % 100 === 0) {
                console.log(`   Processed: ${processed}/${totalHelmets} (${updated} updated)`);
            }
        }

        offset += BATCH_SIZE;
    }

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('Migration Complete');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`   Helmets processed: ${processed}`);
    console.log(`   Helmets updated with prices: ${updated}`);
    console.log('═══════════════════════════════════════════════════════\n');
}

migrate()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Migration failed:', err);
        process.exit(1);
    });
