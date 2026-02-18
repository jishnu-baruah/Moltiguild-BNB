#!/usr/bin/env node
/**
 * Release all guild plots and re-assign with updated placement algorithm.
 * Usage: node scripts/reassign-all-guilds.js [API_URL]
 */

const API = process.argv[2] || 'https://moltiguild-api.onrender.com';

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
  console.log(`Total guilds: ${guilds.length}`);

  // 2. Release all existing assignments
  const assigned = guilds.filter(g => g.assignedPlot);
  console.log(`Releasing ${assigned.length} existing plots...`);
  for (const g of assigned) {
    const plot = g.assignedPlot;
    const res = await fetch(`${API}/api/world/plots/${plot.plotId}/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guildId: Number(g.guildId) }),
    });
    const data = await res.json();
    if (data.ok) {
      console.log(`  Released ${plot.plotId} from guild ${g.guildId}`);
    } else {
      console.log(`  FAIL release ${plot.plotId}: ${data.error}`);
    }
  }

  console.log('\nRe-assigning all guilds with new algorithm...');

  // 3. Re-assign all guilds
  let ok = 0, fail = 0;
  for (const g of guilds) {
    const guildId = Number(g.guildId);
    const district = mapDistrict(g.category);
    const tier = tierForGuild(g);

    const plotsRes = await fetch(`${API}/api/world/plots?district=${district}&tier=${tier}`);
    const plotsData = await plotsRes.json();
    let plots = plotsData.data?.plots || [];

    if (plots.length === 0) {
      const fbRes = await fetch(`${API}/api/world/plots?district=townsquare&tier=${tier}`);
      const fbData = await fbRes.json();
      plots = fbData.data?.plots || [];
    }

    if (plots.length === 0) {
      console.log(`  SKIP guild ${guildId} (${g.name}) — no plots available`);
      fail++;
      continue;
    }

    const plot = plots[0];
    const assignRes = await fetch(`${API}/api/world/plots/${plot.plotId}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guildId, tier }),
    });
    const assignData = await assignRes.json();

    if (assignData.ok) {
      const roadAdj = plot.reasons.includes('Road adjacent') ? '(road)' : '(interior)';
      console.log(`  OK guild ${guildId} (${g.name}) → ${plot.plotId} [${district}] ${roadAdj}`);
      ok++;
    } else {
      console.log(`  FAIL guild ${guildId} (${g.name}): ${assignData.error}`);
      fail++;
    }
  }

  console.log(`\nDone: ${ok} assigned, ${fail} failed`);
}

main().catch(err => { console.error(err); process.exit(1); });
