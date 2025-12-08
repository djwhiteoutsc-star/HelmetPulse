const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

async function checkDuplicates() {
    console.log('🔍 Checking for duplicates in helmets database...\n');

    const { data: helmets, error } = await supabase
        .from('helmets')
        .select('id, name, player, team, helmet_type, design_type')
        .order('player');

    if (error) {
        console.error('Error fetching helmets:', error);
        return;
    }

    console.log(`Total helmets in database: ${helmets.length}\n`);

    // Check for duplicates based on key fields
    const seen = new Map();
    const duplicates = [];

    helmets.forEach(helmet => {
        // Create a unique key from structured fields
        const key = [
            helmet.player || '',
            helmet.team || '',
            helmet.helmet_type || '',
            helmet.design_type || ''
        ].map(s => s.toLowerCase().trim()).join('|');

        if (seen.has(key)) {
            duplicates.push({
                original: seen.get(key),
                duplicate: helmet,
                key
            });
        } else {
            seen.set(key, helmet);
        }
    });

    if (duplicates.length === 0) {
        console.log('✅ No duplicates found based on Player + Team + Helmet Type + Design Type\n');
    } else {
        console.log(`⚠️  Found ${duplicates.length} potential duplicates:\n`);
        duplicates.forEach((dup, i) => {
            console.log(`${i + 1}. Duplicate Set:`);
            console.log(`   Original [ID ${dup.original.id}]:`);
            console.log(`     Name: ${dup.original.name}`);
            console.log(`     Player: ${dup.original.player} | Team: ${dup.original.team}`);
            console.log(`     Type: ${dup.original.helmet_type} | Design: ${dup.original.design_type}`);
            console.log(`   Duplicate [ID ${dup.duplicate.id}]:`);
            console.log(`     Name: ${dup.duplicate.name}`);
            console.log(`     Player: ${dup.duplicate.player} | Team: ${dup.duplicate.team}`);
            console.log(`     Type: ${dup.duplicate.helmet_type} | Design: ${dup.duplicate.design_type}`);
            console.log('');
        });
    }

    // Also check for exact name duplicates
    console.log('\n🔍 Checking for exact name duplicates...\n');
    const nameMap = new Map();
    const nameDuplicates = [];

    helmets.forEach(helmet => {
        const cleanName = helmet.name.toLowerCase().trim();
        if (nameMap.has(cleanName)) {
            nameDuplicates.push({
                original: nameMap.get(cleanName),
                duplicate: helmet
            });
        } else {
            nameMap.set(cleanName, helmet);
        }
    });

    if (nameDuplicates.length === 0) {
        console.log('✅ No exact name duplicates found\n');
    } else {
        console.log(`⚠️  Found ${nameDuplicates.length} exact name duplicates:\n`);
        nameDuplicates.slice(0, 10).forEach((dup, i) => {
            console.log(`${i + 1}. [ID ${dup.original.id}] vs [ID ${dup.duplicate.id}]:`);
            console.log(`   ${dup.duplicate.name}\n`);
        });
    }

    // Check for helmets with missing key fields
    console.log('\n🔍 Checking for helmets with missing data...\n');
    const missing = helmets.filter(h => !h.player || !h.team || !h.helmet_type || !h.design_type);

    if (missing.length === 0) {
        console.log('✅ All helmets have complete data\n');
    } else {
        console.log(`⚠️  Found ${missing.length} helmets with missing fields:\n`);
        missing.slice(0, 10).forEach((h, i) => {
            console.log(`${i + 1}. [ID ${h.id}] ${h.name}`);
            const missingFields = [];
            if (!h.player) missingFields.push('player');
            if (!h.team) missingFields.push('team');
            if (!h.helmet_type) missingFields.push('helmet_type');
            if (!h.design_type) missingFields.push('design_type');
            console.log(`   Missing: ${missingFields.join(', ')}\n`);
        });
    }
}

checkDuplicates().catch(console.error);
