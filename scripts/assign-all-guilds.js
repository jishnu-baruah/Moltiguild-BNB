#!/usr/bin/env node
/**
 * Batch-assign plots to all guilds that don't have one yet.
 * Usage: node scripts/assign-all-guilds.js [API_URL]
 */

const API = process.argv[2] || 'https://moltiguild-api.onrender.com';

// Map guild categories to districts
const CAT_TO_DISTRICT = {
  meme: 'creative', 'content-creation': 'creative', writing: 'creative',
  art: 'creative', design: 'creative',
  math: 'research', science: 'research', analytics: 'research',
  trading: 'defi', finance: 'defi',
  dev: 'code', engineering: 'code',
  language: 'translation',
  test: 'townsquare', general: 'townsquare',
};

function mapDistrict(cat) {
  return CAT_TO_DISTRICT[cat] || cat;
}

function tierForGuild(g) {
  const missions = g.totalMissions || 0;
  const rating = parseFloat(g.avgRating) || 0;
  if (missions >= 200 && rating >= 4.5) return 'diamond';
  if (missions >= 50 && rating >= 4.0) return 'gold';
  if (missions >= 10 && rating >= 3.5) return 'silver';
  return 'bronze';
}

async function main() {
  // 1. Fetch all guilds
  const guildsRes = await fetch(`${API}/api/guilds`);
  const guildsData = await guildsRes.json();
  const guilds = guildsData.data.guilds;

  const unassigned = guilds.filter(g => !g.assignedPlot);
  console.log(`Total guilds: ${guilds.length}, unassigned: ${unassigned.length}`);

  let assigned = 0, failed = 0;

  for (const g of unassigned) {
    const guildId = Number(g.guildId);
    const district = mapDistrict(g.category);
    const tier = tierForGuild(g);

    // Get available plots for this district/tier
    const plotsRes = await fetch(`${API}/api/world/plots?district=${district}&tier=${tier}`);
    const plotsData = await plotsRes.json();
    const plots = plotsData.data?.plots || [];

    if (plots.length === 0) {
      // Fallback: try townsquare
      const fallbackRes = await fetch(`${API}/api/world/plots?district=townsquare&tier=${tier}`);
      const fallbackData = await fallbackRes.json();
      const fallbackPlots = fallbackData.data?.plots || [];
      if (fallbackPlots.length === 0) {
        console.log(`  SKIP guild ${guildId} (${g.name}) — no plots in ${district} or townsquare`);
        failed++;
        continue;
      }
      plots.push(...fallbackPlots);
    }

    // Pick the top-scored plot
    const plot = plots[0];

    const assignRes = await fetch(`${API}/api/world/plots/${plot.plotId}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guildId, tier }),
    });
    const assignData = await assignRes.json();

    if (assignData.ok) {
      console.log(`  OK guild ${guildId} (${g.name}) → ${plot.plotId} [${district}/${tier}]`);
      assigned++;
    } else {
      console.log(`  FAIL guild ${guildId} (${g.name}): ${assignData.error}`);
      failed++;
    }
  }

  console.log(`\nDone: ${assigned} assigned, ${failed} failed`);
}

main().catch(err => { console.error(err); process.exit(1); });
