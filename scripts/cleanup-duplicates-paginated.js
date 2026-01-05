#!/usr/bin/env node
/**
 * Cleanup duplicate price records with proper pagination
 * Supabase has a default limit of 1000 records, so we need to paginate
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function fetchAllPriceRecords() {
    const allRecords = [];
    const pageSize = 1000;
    let offset = 0;
    let hasMore = true;

    console.log('Fetching all price records with pagination...');

    while (hasMore) {
        const { data, error } = await supabase
            .from('helmet_prices')
            .select('id, helmet_id, source, median_price, scraped_at')
            .range(offset, offset + pageSize - 1)
            .order('id', { ascending: true });

        if (error) {
            console.error('Error fetching records:', error);
            break;
        }

        if (data && data.length > 0) {
            allRecords.push(...data);
            console.log(`  Fetched ${allRecords.length} records so far...`);
            offset += pageSize;
            hasMore = data.length === pageSize;
        } else {
            hasMore = false;
        }
    }

    console.log(`Total records fetched: ${allRecords.length}\n`);
    return allRecords;
}

async function main() {
    console.log('===========================================');
    console.log('  DUPLICATE PRICE CLEANUP (Paginated)');
    console.log('===========================================\n');

    // Fetch ALL records with pagination
    const allRecords = await fetchAllPriceRecords();

    // Group by helmet_id + source to find duplicates
    const groups = {};
    for (const record of allRecords) {
        const key = `${record.helmet_id}-${record.source}`;
        if (!groups[key]) {
            groups[key] = [];
        }
        groups[key].push(record);
    }

    // Find groups with more than 1 record (duplicates)
    const duplicateGroups = Object.entries(groups).filter(([, records]) => records.length > 1);

    console.log(`Found ${duplicateGroups.length} helmet+source combinations with duplicates\n`);

    if (duplicateGroups.length === 0) {
        console.log('No duplicates found!');
        return;
    }

    // Collect IDs to delete (keep the most recent record in each group)
    const idsToDelete = [];

    for (const [key, records] of duplicateGroups) {
        // Sort by scraped_at descending (most recent first)
        records.sort((a, b) => new Date(b.scraped_at) - new Date(a.scraped_at));

        // Keep the first (most recent), delete the rest
        const toDelete = records.slice(1);
        idsToDelete.push(...toDelete.map(r => r.id));

        if (records.length > 2) {
            console.log(`  ${key}: ${records.length} records -> keeping 1, deleting ${records.length - 1}`);
        }
    }

    console.log(`\nTotal records to delete: ${idsToDelete.length}`);

    // Delete in batches of 100
    const batchSize = 100;
    let deleted = 0;

    for (let i = 0; i < idsToDelete.length; i += batchSize) {
        const batch = idsToDelete.slice(i, i + batchSize);
        const { error } = await supabase
            .from('helmet_prices')
            .delete()
            .in('id', batch);

        if (error) {
            console.error(`Error deleting batch at ${i}:`, error);
        } else {
            deleted += batch.length;
            console.log(`  Deleted ${deleted}/${idsToDelete.length} records...`);
        }
    }

    // Get final count
    const { count } = await supabase
        .from('helmet_prices')
        .select('*', { count: 'exact', head: true });

    console.log(`\n===========================================`);
    console.log(`  CLEANUP COMPLETE`);
    console.log(`  Deleted: ${deleted} duplicate records`);
    console.log(`  Remaining: ${count} price records`);
    console.log(`===========================================\n`);
}

main().catch(console.error);
