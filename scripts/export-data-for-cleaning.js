const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function exportDataForCleaning() {
    console.log('📊 Exporting helmet data for cleaning analysis...\n');

    try {
        // Get all helmets with key fields
        const { data: helmets, error } = await supabase
            .from('helmets')
            .select('id, name, player, team, helmet_type, design_type, auth_company')
            .order('id', { ascending: true });

        if (error) throw error;

        console.log(`Exported ${helmets.length} helmets\n`);

        // Save to JSON file
        const outputPath = 'C:\\Users\\18036\\Desktop\\CardPulse\\helmet-data-export.json';
        fs.writeFileSync(outputPath, JSON.stringify(helmets, null, 2));
        console.log(`✅ Data exported to: ${outputPath}\n`);

        // Analyze data quality issues
        console.log('🔍 Data Quality Analysis:\n');

        const issues = {
            missingPlayer: 0,
            missingTeam: 0,
            inconsistentTeams: new Set(),
            inconsistentTypes: new Set(),
            suspiciousNames: [],
            duplicateNames: new Map()
        };

        helmets.forEach(h => {
            // Missing data
            if (!h.player || h.player.trim() === '') issues.missingPlayer++;
            if (!h.team || h.team.trim() === '') issues.missingTeam++;

            // Track all unique teams and types
            if (h.team) issues.inconsistentTeams.add(h.team);
            if (h.helmet_type) issues.inconsistentTypes.add(h.helmet_type);

            // Suspicious names (all caps, weird characters, too long)
            if (h.name) {
                if (h.name === h.name.toUpperCase() && h.name.length > 10) {
                    issues.suspiciousNames.push({ id: h.id, name: h.name.substring(0, 60) });
                }
            }

            // Track duplicates
            const key = `${h.player}|${h.team}|${h.helmet_type}|${h.design_type}`;
            if (issues.duplicateNames.has(key)) {
                issues.duplicateNames.get(key).push(h.id);
            } else {
                issues.duplicateNames.set(key, [h.id]);
            }
        });

        // Find actual duplicates
        const realDuplicates = Array.from(issues.duplicateNames.entries())
            .filter(([key, ids]) => ids.length > 1 && key !== '|||');

        console.log(`Missing player names:     ${issues.missingPlayer}`);
        console.log(`Missing team names:       ${issues.missingTeam}`);
        console.log(`Unique teams:             ${issues.inconsistentTeams.size}`);
        console.log(`Unique helmet types:      ${issues.inconsistentTypes.size}`);
        console.log(`Suspicious names (CAPS):  ${issues.suspiciousNames.length}`);
        console.log(`Potential duplicates:     ${realDuplicates.length}\n`);

        console.log('Team variations found:');
        const sortedTeams = Array.from(issues.inconsistentTeams).sort();
        sortedTeams.forEach(team => console.log(`  - ${team || 'NULL'}`));

        console.log('\n\nHelmet type variations found:');
        const sortedTypes = Array.from(issues.inconsistentTypes).sort();
        sortedTypes.forEach(type => console.log(`  - ${type || 'NULL'}`));

        if (issues.suspiciousNames.length > 0) {
            console.log('\n\nSuspicious names (first 10):');
            issues.suspiciousNames.slice(0, 10).forEach(s => {
                console.log(`  ID ${s.id}: ${s.name}...`);
            });
        }

        if (realDuplicates.length > 0) {
            console.log('\n\nPotential duplicates (first 10):');
            realDuplicates.slice(0, 10).forEach(([key, ids]) => {
                const [player, team, type, design] = key.split('|');
                console.log(`  IDs ${ids.join(', ')}: ${player} - ${team} - ${type} - ${design}`);
            });
        }

        console.log('\n═══════════════════════════════════════');
        console.log('✅ Export complete!');
        console.log('═══════════════════════════════════════\n');

    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

exportDataForCleaning();
