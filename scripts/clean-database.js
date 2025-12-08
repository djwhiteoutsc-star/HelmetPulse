const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Parse player name from helmet name
function parsePlayerName(name) {
    if (!name) return null;

    // Remove common prefixes
    let cleaned = name.replace(/^(NEW LISTING|🔥|Fanatics Authentic)/gi, '').trim();

    // Try to extract first two words (usually player name)
    const words = cleaned.split(/\s+/);
    if (words.length >= 2) {
        const firstName = words[0];
        const lastName = words[1];

        // Skip if first word is a team name or common word
        const skipWords = ['Signed', 'Autographed', 'Official', 'NFL', 'New', 'Mini', 'Full'];
        if (skipWords.includes(firstName)) return null;

        return `${firstName} ${lastName}`;
    }

    return null;
}

// Parse team name from helmet name
function parseTeamName(name) {
    if (!name) return null;

    const nameLower = name.toLowerCase();
    const teams = {
        'cardinals': 'Cardinals',
        'falcons': 'Falcons',
        'ravens': 'Ravens',
        'bills': 'Bills',
        'panthers': 'Panthers',
        'bears': 'Bears',
        'bengals': 'Bengals',
        'browns': 'Browns',
        'cowboys': 'Cowboys',
        'broncos': 'Broncos',
        'lions': 'Lions',
        'packers': 'Packers',
        'texans': 'Texans',
        'colts': 'Colts',
        'jaguars': 'Jaguars',
        'chiefs': 'Chiefs',
        'raiders': 'Raiders',
        'chargers': 'Chargers',
        'rams': 'Rams',
        'dolphins': 'Dolphins',
        'vikings': 'Vikings',
        'patriots': 'Patriots',
        'saints': 'Saints',
        'giants': 'Giants',
        'jets': 'Jets',
        'eagles': 'Eagles',
        'steelers': 'Steelers',
        '49ers': '49ers',
        'seahawks': 'Seahawks',
        'buccaneers': 'Buccaneers',
        'titans': 'Titans',
        'commanders': 'Commanders'
    };

    for (const [key, value] of Object.entries(teams)) {
        if (nameLower.includes(key)) {
            return value;
        }
    }

    return null;
}

async function cleanDatabase() {
    console.log('🧹 Starting comprehensive database cleaning...\n');

    const report = {
        duplicatesFound: 0,
        duplicatesRemoved: 0,
        pricesMerged: 0,
        playerNamesFilled: 0,
        teamNamesFilled: 0
    };

    try {
        // STEP 1: Fill missing player and team names
        console.log('Step 1: Filling missing player and team names...\n');

        const { data: helmetsWithMissing } = await supabase
            .from('helmets')
            .select('*')
            .or('player.is.null,team.is.null');

        console.log(`Found ${helmetsWithMissing?.length || 0} helmets with missing data\n`);

        for (const helmet of helmetsWithMissing || []) {
            const updates = {};

            if (!helmet.player) {
                const parsedPlayer = parsePlayerName(helmet.name);
                if (parsedPlayer) {
                    updates.player = parsedPlayer;
                    report.playerNamesFilled++;
                    console.log(`  ✅ ID ${helmet.id}: Added player "${parsedPlayer}"`);
                }
            }

            if (!helmet.team) {
                const parsedTeam = parseTeamName(helmet.name);
                if (parsedTeam) {
                    updates.team = parsedTeam;
                    report.teamNamesFilled++;
                    console.log(`  ✅ ID ${helmet.id}: Added team "${parsedTeam}"`);
                }
            }

            if (Object.keys(updates).length > 0) {
                await supabase
                    .from('helmets')
                    .update(updates)
                    .eq('id', helmet.id);
            }
        }

        console.log('');

        // STEP 2: Find and analyze duplicates
        console.log('Step 2: Analyzing duplicates...\n');

        const { data: allHelmets } = await supabase
            .from('helmets')
            .select('*')
            .order('id', { ascending: true });

        // Group by player + team + type + design
        const groups = new Map();

        for (const helmet of allHelmets || []) {
            const key = `${helmet.player || 'NULL'}|${helmet.team || 'NULL'}|${helmet.helmet_type}|${helmet.design_type}`;

            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key).push(helmet);
        }

        // Find groups with duplicates
        const duplicateGroups = Array.from(groups.entries())
            .filter(([key, helmets]) => helmets.length > 1);

        console.log(`Found ${duplicateGroups.length} duplicate groups\n`);
        report.duplicatesFound = duplicateGroups.length;

        // STEP 3: Merge duplicates
        console.log('Step 3: Merging duplicates...\n');

        for (const [key, helmets] of duplicateGroups) {
            console.log(`\n  Duplicate group: ${key}`);
            console.log(`    ${helmets.length} helmets: ${helmets.map(h => h.id).join(', ')}`);

            // Get price count for each helmet
            const helmetPrices = [];
            for (const helmet of helmets) {
                const { data: prices } = await supabase
                    .from('helmet_prices')
                    .select('*')
                    .eq('helmet_id', helmet.id);

                helmetPrices.push({
                    helmet,
                    priceCount: prices?.length || 0,
                    prices: prices || []
                });
            }

            // Sort by price count (descending) and ID (ascending as tiebreaker)
            helmetPrices.sort((a, b) => {
                if (b.priceCount !== a.priceCount) {
                    return b.priceCount - a.priceCount;
                }
                return a.helmet.id - b.helmet.id;
            });

            // Keep the first one (most prices or lowest ID)
            const toKeep = helmetPrices[0];
            const toDelete = helmetPrices.slice(1);

            console.log(`    Keeping ID ${toKeep.helmet.id} (${toKeep.priceCount} prices)`);

            // Merge prices from duplicates to the one we're keeping
            for (const dup of toDelete) {
                console.log(`    Merging/Deleting ID ${dup.helmet.id} (${dup.priceCount} prices)`);

                // Move unique prices to keeper
                for (const price of dup.prices) {
                    // Check if similar price already exists for keeper
                    const existing = toKeep.prices.find(p =>
                        p.source === price.source &&
                        Math.abs(p.median_price - price.median_price) < 1
                    );

                    if (!existing) {
                        // Move this price to keeper
                        await supabase
                            .from('helmet_prices')
                            .update({ helmet_id: toKeep.helmet.id })
                            .eq('id', price.id);

                        report.pricesMerged++;
                    } else {
                        // Delete duplicate price
                        await supabase
                            .from('helmet_prices')
                            .delete()
                            .eq('id', price.id);
                    }
                }

                // Delete the duplicate helmet
                await supabase
                    .from('helmets')
                    .delete()
                    .eq('id', dup.helmet.id);

                report.duplicatesRemoved++;
            }
        }

        console.log('\n\n═══════════════════════════════════════');
        console.log('✅ DATABASE CLEANING COMPLETE');
        console.log('═══════════════════════════════════════');
        console.log(`Player names filled:    ${report.playerNamesFilled}`);
        console.log(`Team names filled:      ${report.teamNamesFilled}`);
        console.log(`Duplicate groups found: ${report.duplicatesFound}`);
        console.log(`Helmets removed:        ${report.duplicatesRemoved}`);
        console.log(`Prices merged:          ${report.pricesMerged}`);
        console.log('═══════════════════════════════════════\n');

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error.stack);
    }
}

cleanDatabase();
