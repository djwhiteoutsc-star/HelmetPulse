const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

function parseHelmetTitle(title) {
    const result = { helmetType: 'fullsize-authentic', designType: 'regular' };
    const titleLower = title.toLowerCase();

    // Parse helmet type - order matters! Check specific types first
    if (titleLower.includes('mini')) {
        result.helmetType = 'mini';
    } else if (titleLower.includes('midi') || titleLower.includes('mid-size') || titleLower.includes('mid size')) {
        result.helmetType = 'midi';
    } else if (titleLower.includes('speedflex')) {
        result.helmetType = 'fullsize-speedflex';
    } else if (titleLower.includes('full-size replica') || titleLower.includes('full size replica') || titleLower.includes('f/s replica')) {
        result.helmetType = 'fullsize-replica';
    } else if (titleLower.includes('replica')) {
        result.helmetType = 'fullsize-replica';
    } else if (titleLower.includes('authentic') || titleLower.includes('f/s') || titleLower.includes('full-size') || titleLower.includes('full size')) {
        result.helmetType = 'fullsize-authentic';
    }

    // Parse design type/variation
    if (titleLower.includes('lunar') || titleLower.includes('lunar eclipse')) {
        result.designType = 'lunar-eclipse';
    } else if (titleLower.includes('eclipse')) {
        result.designType = 'eclipse';
    } else if (titleLower.includes('flash')) {
        result.designType = 'flash';
    } else if (titleLower.includes('camo')) {
        result.designType = 'camo';
    } else if (titleLower.includes('salute to service') || titleLower.includes('sts') || titleLower.includes('salute')) {
        result.designType = 'salute-to-service';
    } else if (titleLower.includes('rave')) {
        result.designType = 'rave';
    } else if (titleLower.includes('amp')) {
        result.designType = 'amp';
    } else if (titleLower.includes('slate')) {
        result.designType = 'slate';
    } else if (titleLower.includes('flat white')) {
        result.designType = 'flat-white';
    } else if (titleLower.includes('chrome')) {
        result.designType = 'chrome';
    } else if (titleLower.includes('throwback') || titleLower.includes('tb ')) {
        result.designType = 'throwback';
    } else if (titleLower.includes('alternate') || titleLower.includes('alt ')) {
        result.designType = 'alternate';
    } else if (titleLower.includes('rivalries')) {
        result.designType = 'rivalries';
    }

    return result;
}

async function updateHelmetTypes() {
    console.log('🔄 Updating helmet types in database...\n');

    const { data: helmets, error } = await supabase
        .from('helmets')
        .select('id, name, helmet_type, design_type');

    if (error) {
        console.error('Error fetching helmets:', error);
        return;
    }

    console.log(`Found ${helmets.length} helmets to process\n`);

    let updated = 0;
    let unchanged = 0;

    for (const helmet of helmets) {
        const parsed = parseHelmetTitle(helmet.name);

        // Check if update is needed
        if (helmet.helmet_type !== parsed.helmetType || helmet.design_type !== parsed.designType) {
            const { error: updateError } = await supabase
                .from('helmets')
                .update({
                    helmet_type: parsed.helmetType,
                    design_type: parsed.designType
                })
                .eq('id', helmet.id);

            if (updateError) {
                console.log(`❌ Error updating ID ${helmet.id}: ${updateError.message}`);
            } else {
                updated++;
                if (updated <= 20) {
                    console.log(`✅ Updated [${helmet.id}]: ${helmet.helmet_type} → ${parsed.helmetType}, ${helmet.design_type} → ${parsed.designType}`);
                    console.log(`   ${helmet.name.substring(0, 60)}...`);
                }
            }
        } else {
            unchanged++;
        }
    }

    console.log(`\n${'═'.repeat(50)}`);
    console.log(`📊 SUMMARY`);
    console.log(`${'═'.repeat(50)}`);
    console.log(`   Updated: ${updated} helmets`);
    console.log(`   Unchanged: ${unchanged} helmets`);
    console.log(`${'═'.repeat(50)}\n`);
}

updateHelmetTypes().catch(console.error);
