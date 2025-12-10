const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

(async () => {
    const { data: all } = await supabase.from('helmets').select('id, player, team, name').order('player');

    const teamNames = ['Eagles', 'Cowboys', 'Patriots', 'Chiefs', 'Broncos', 'Packers', 'Bears',
        'Lions', 'Vikings', 'Rams', 'Seahawks', 'Cardinals', 'Falcons', 'Saints', 'Buccaneers',
        'Panthers', 'Giants', 'Jets', 'Bills', 'Dolphins', 'Ravens', 'Steelers', 'Bengals',
        'Browns', 'Texans', 'Colts', 'Jaguars', 'Titans', 'Raiders', 'Chargers', '49ers',
        'Commanders', 'Redskins', 'Philadelphia', 'New England', 'Kansas City',
        'Denver', 'Green Bay', 'Chicago', 'Detroit', 'Minnesota', 'Los Angeles', 'Seattle',
        'Arizona', 'Atlanta', 'New Orleans', 'Tampa Bay', 'Carolina', 'New York', 'Buffalo',
        'Miami', 'Baltimore', 'Pittsburgh', 'Cincinnati', 'Cleveland', 'Houston', 'Indianapolis',
        'Jacksonville', 'Tennessee', 'Las Vegas', 'San Francisco', 'Washington'];

    const badPatterns = [/^Super Bowl/i, /^NFL /i, /^Full Size/i, /^Mini /i, /^Authentic/i, /^Replica/i];

    const issues = [];

    for (const h of all || []) {
        const player = h.player || '';

        if (!player || player.trim() === '') {
            issues.push({ id: h.id, player: 'EMPTY', issue: 'Missing player' });
            continue;
        }

        // Skip Dallas - it's a valid first name
        if (player.startsWith('Dallas ')) continue;

        if (teamNames.some(t => player.toLowerCase() === t.toLowerCase() ||
            player.toLowerCase().startsWith(t.toLowerCase() + ' '))) {
            issues.push({ id: h.id, player, issue: 'Team name issue' });
            continue;
        }

        for (const pattern of badPatterns) {
            if (pattern.test(player)) {
                issues.push({ id: h.id, player, issue: 'Bad pattern' });
                break;
            }
        }
    }

    console.log('=== FINAL DATABASE CHECK ===');
    console.log('Total helmets:', all?.length);
    console.log('Remaining issues:', issues.length);

    if (issues.length > 0) {
        console.log('\nStill need attention:');
        issues.forEach(i => console.log('  ID', i.id, ':', i.player, '-', i.issue));
    } else {
        console.log('\n✅ All entries look good!');
    }
})();
