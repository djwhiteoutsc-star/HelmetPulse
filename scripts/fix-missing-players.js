const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Parse player name from helmet name
function parsePlayerName(name) {
    if (!name) return null;

    // Remove common prefixes and suffixes
    let cleaned = name
        .replace(/^(NEW LISTING|🔥|Fanatics Authentic|NFL|Signed|Autographed)/gi, '')
        .replace(/Opens in a new window or tab$/gi, '')
        .replace(/-\s*with COA$/gi, '')
        .replace(/\n.*$/g, '') // Remove everything after newline
        .trim();

    // Remove all team-related words (both team names and city/state names)
    const teamPattern = /(NEW ENGLAND|NEW YORK|NEW ORLEANS|LAS VEGAS|SAN FRANCISCO|TAMPA BAY|GREEN BAY|KANSAS CITY|ARIZONA|ATLANTA|BALTIMORE|BUFFALO|CAROLINA|CHICAGO|CINCINNATI|CLEVELAND|DALLAS|DENVER|DETROIT|HOUSTON|INDIANAPOLIS|JACKSONVILLE|MIAMI|MINNESOTA|NASHVILLE|PHILADELPHIA|PITTSBURGH|SEATTLE|CARDINALS|FALCONS|RAVENS|BILLS|PANTHERS|BEARS|BENGALS|BROWNS|COWBOYS|BRONCOS|LIONS|PACKERS|TEXANS|COLTS|JAGUARS|CHIEFS|RAIDERS|CHARGERS|RAMS|DOLPHINS|VIKINGS|PATRIOTS|SAINTS|GIANTS|JETS|EAGLES|STEELERS|49ERS|NINERS|SEAHAWKS|BUCCANEERS|BUCS|TITANS|COMMANDERS|WASHINGTON|REDSKINS)/gi;

    cleaned = cleaned.replace(teamPattern, '').trim();

    // Remove common words
    cleaned = cleaned.replace(/\b(SIGNED|AUTOGRAPHED|SPEED|MINI|HELMET|FULL|SIZE|AUTHENTIC|REPLICA|THROWBACK|ECLIPSE|FLASH|RAVE|ALTERNATE|BLAZE|AUTOGRAPH)\b/gi, ' ').trim();

    // Clean up multiple spaces
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    // Try to extract first two words (usually player name)
    const words = cleaned.split(/\s+/).filter(w => w.length > 0);
    if (words.length >= 2) {
        const firstName = words[0];
        const lastName = words[1];

        // Skip if first word is a common word or too short
        const skipWords = ['Official', 'New', 'The', 'A', 'An', 'With'];
        if (skipWords.some(w => w.toLowerCase() === firstName.toLowerCase()) || firstName.length < 2) {
            return null;
        }

        // Check if it looks like a name (starts with capital letter, reasonable length)
        if (lastName.length >= 2 && /^[A-Z]/.test(firstName) && /^[A-Z]/.test(lastName)) {
            return `${firstName} ${lastName}`;
        }
    }

    return null;
}

async function fixMissingPlayers() {
    console.log('🔧 Fixing helmets with missing player names...\n');

    try {
        // Find all helmets with null or empty player names
        const { data: helmets, error } = await supabase
            .from('helmets')
            .select('*')
            .or('player.is.null,player.eq.');

        if (error) throw error;

        console.log(`Found ${helmets?.length || 0} helmets with missing player names\n`);

        let fixed = 0;
        let couldNotParse = [];

        for (const helmet of helmets || []) {
            const parsedPlayer = parsePlayerName(helmet.name);

            if (parsedPlayer) {
                console.log(`  ✅ ID ${helmet.id}: Filling "${parsedPlayer}" from "${helmet.name.substring(0, 80)}..."`);

                await supabase
                    .from('helmets')
                    .update({ player: parsedPlayer })
                    .eq('id', helmet.id);

                fixed++;
            } else {
                console.log(`  ⚠️  ID ${helmet.id}: Could not parse player from "${helmet.name.substring(0, 80)}..."`);
                couldNotParse.push({ id: helmet.id, name: helmet.name });
            }
        }

        console.log('\n═══════════════════════════════════════');
        console.log('✅ MISSING PLAYER NAMES FIXED');
        console.log('═══════════════════════════════════════');
        console.log(`Player names filled:     ${fixed}`);
        console.log(`Could not parse:         ${couldNotParse.length}`);
        console.log('═══════════════════════════════════════\n');

        if (couldNotParse.length > 0) {
            console.log('⚠️  Helmets that need manual review:\n');
            couldNotParse.forEach(h => {
                console.log(`  ID ${h.id}: ${h.name.substring(0, 100)}`);
            });
            console.log('\nThese helmets may need to be deleted or manually updated.\n');
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

fixMissingPlayers();
