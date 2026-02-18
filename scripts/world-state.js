/**
 * world-state.js — Server-side plot engine for guild tile governance.
 *
 * Manages the 56x56 isometric world grid with:
 *   - Plot assignment/release with validation pipeline
 *   - Road adjacency enforcement
 *   - Tier-based limits (bronze=1, silver=2, gold=4, diamond=6)
 *   - Minimum spacing between buildings (2 tiles)
 *   - District density cap (35 weighted units)
 *   - JSON persistence (auto-save every 5min + SIGTERM)
 *
 * Loaded as a module by api.js.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const PLOTS_FILE = path.join(DATA_DIR, 'world-plots.json');
const MAP_FILE = path.join(DATA_DIR, 'district-map.json');

/* ── Tier config ────────────────────────────────────────────────────── */

const TIER_MAX_PLOTS = { bronze: 1, silver: 2, gold: 4, diamond: 6 };
const TIER_FOOTPRINT = { bronze: 1, silver: 1, gold: 2, diamond: 2 };
const TIER_DENSITY_WEIGHT = { bronze: 1.0, silver: 1.0, gold: 1.5, diamond: 2.5 };
const MAX_DISTRICT_WEIGHT = 35.0;
const MIN_SPACING = 2; // minimum tile gap between building centers

/* ── State ──────────────────────────────────────────────────────────── */

/** @type {Map<string, object>} plotId "col,row" → assignment info */
const assignments = new Map();

/** @type {{ roads: Set<string>, water: Set<string>, worldMask: Set<string>, roadAdjacent: Set<string>, districts: Record<string, Set<string>>, districtBounds: Record<string, object> } | null} */
let mapData = null;

/** Injectable persistence adapter — set via setPersistence() from api.js */
let persistence = null;

/* ── Loading ────────────────────────────────────────────────────────── */

function loadDistrictMap() {
  if (mapData) return mapData;

  const raw = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));

  mapData = {
    gridCols: raw.gridCols,
    gridRows: raw.gridRows,
    roads: new Set(raw.roads),
    water: new Set(raw.water),
    worldMask: new Set(raw.worldMask),
    roadAdjacent: new Set(raw.roadAdjacent),
    decorations: new Set(raw.decorations || []),
    districts: {},
    districtBounds: raw.districtBounds,
    districtDefs: raw.districtDefs,
  };

  for (const [cat, tiles] of Object.entries(raw.districts)) {
    mapData.districts[cat] = new Set(tiles);
  }

  console.log(`[world-state] Loaded district map: ${mapData.worldMask.size} tiles, ${mapData.roads.size} roads, ${Object.keys(mapData.districts).length} districts`);
  return mapData;
}

async function loadPlotAssignments() {
  // Try persistence adapter (Redis) first
  if (persistence) {
    try {
      const data = await persistence.get('world:plots');
      if (data && data.assignments) {
        for (const a of data.assignments) {
          assignments.set(a.plotId, a);
        }
        console.log(`[world-state] Loaded ${assignments.size} plot assignments from Redis`);
        return;
      }
    } catch (err) {
      console.warn('[world-state] Redis load failed, trying JSON file:', err.message);
    }
  }

  // Fallback to JSON file
  try {
    const raw = JSON.parse(fs.readFileSync(PLOTS_FILE, 'utf8'));
    for (const a of raw.assignments || []) {
      assignments.set(a.plotId, a);
    }
    console.log(`[world-state] Loaded ${assignments.size} plot assignments from file`);
  } catch {
    console.log('[world-state] No existing plot assignments, starting fresh');
  }
}

async function savePlotAssignments() {
  const data = {
    version: 1,
    savedAt: new Date().toISOString(),
    assignments: [...assignments.values()],
  };

  // Save to persistence adapter (Redis) if available
  if (persistence) {
    try {
      await persistence.set('world:plots', data);
      return;
    } catch (err) {
      console.warn('[world-state] Redis save failed, falling back to file:', err.message);
    }
  }

  // Fallback to JSON file
  fs.mkdirSync(path.dirname(PLOTS_FILE), { recursive: true });
  fs.writeFileSync(PLOTS_FILE, JSON.stringify(data, null, 2));
}

/* ── Validation helpers ─────────────────────────────────────────────── */

function getPlotDistrict(plotId) {
  const map = loadDistrictMap();
  for (const [cat, tiles] of Object.entries(map.districts)) {
    if (tiles.has(plotId)) return cat;
  }
  return null;
}

function isRoadAdjacent(plotId) {
  const map = loadDistrictMap();
  return map.roadAdjacent.has(plotId);
}

function isBuildable(plotId) {
  const map = loadDistrictMap();
  if (!map.worldMask.has(plotId)) return false;
  if (map.roads.has(plotId)) return false;
  if (map.water.has(plotId)) return false;
  if (map.decorations.has(plotId)) return false;
  return true;
}

function getGuildPlotCount(guildId) {
  let count = 0;
  for (const a of assignments.values()) {
    if (a.guildId === guildId) count++;
  }
  return count;
}

function getGuildPlots(guildId) {
  const plots = [];
  for (const a of assignments.values()) {
    if (a.guildId === guildId) plots.push(a);
  }
  return plots;
}

function getDistrictDensity(district) {
  let weight = 0;
  for (const a of assignments.values()) {
    if (a.district === district) {
      weight += TIER_DENSITY_WEIGHT[a.tier] || 1.0;
    }
  }
  return weight;
}

function getSpacingViolation(col, row, footprint) {
  for (const a of assignments.values()) {
    const [ac, ar] = a.plotId.split(',').map(Number);
    const af = TIER_FOOTPRINT[a.tier] || 1;
    // Center of existing building
    const ecx = ac + (af - 1) * 0.5;
    const ecy = ar + (af - 1) * 0.5;
    // Center of new building
    const ncx = col + (footprint - 1) * 0.5;
    const ncy = row + (footprint - 1) * 0.5;
    const dist = Math.sqrt((ecx - ncx) ** 2 + (ecy - ncy) ** 2);
    if (dist < MIN_SPACING) {
      return { tooClose: a, distance: dist };
    }
  }
  return null;
}

/* ── Core operations ────────────────────────────────────────────────── */

/**
 * Assign a plot to a guild.
 * Returns { ok, assignment } or { ok: false, error, code }.
 */
function assignPlot(plotId, guildId, tier) {
  const map = loadDistrictMap();
  const [col, row] = plotId.split(',').map(Number);
  const footprint = TIER_FOOTPRINT[tier] || 1;

  // 1. Plot exists and is buildable
  if (!isBuildable(plotId)) {
    return { ok: false, error: 'Plot is not buildable (road, water, or outside world)', code: 'NOT_BUILDABLE' };
  }

  // 2. Plot is unoccupied
  if (assignments.has(plotId)) {
    return { ok: false, error: 'Plot is already assigned', code: 'OCCUPIED' };
  }

  // 3. Road adjacency (soft — preferred but not required)
  // Road-adjacent plots score higher but non-adjacent plots are allowed

  // 4. Tier limit
  const maxPlots = TIER_MAX_PLOTS[tier] || 1;
  const currentPlots = getGuildPlotCount(guildId);
  if (currentPlots >= maxPlots) {
    return { ok: false, error: `Guild at tier limit (${currentPlots}/${maxPlots} for ${tier})`, code: 'TIER_LIMIT' };
  }

  // 5. District identification
  const district = getPlotDistrict(plotId);
  if (!district) {
    return { ok: false, error: 'Plot not in any district', code: 'NO_DISTRICT' };
  }

  // 6. Minimum spacing
  const spacingViolation = getSpacingViolation(col, row, footprint);
  if (spacingViolation) {
    return {
      ok: false,
      error: `Too close to guild ${spacingViolation.tooClose.guildId} (${spacingViolation.distance.toFixed(1)} tiles, need ${MIN_SPACING})`,
      code: 'SPACING_VIOLATION',
    };
  }

  // 7. District density
  const density = getDistrictDensity(district);
  const newWeight = TIER_DENSITY_WEIGHT[tier] || 1.0;
  if (density + newWeight > MAX_DISTRICT_WEIGHT) {
    return {
      ok: false,
      error: `District ${district} at density limit (${density.toFixed(1)}/${MAX_DISTRICT_WEIGHT})`,
      code: 'DENSITY_LIMIT',
    };
  }

  // 8. 2x2 footprint check for gold/diamond
  if (footprint === 2) {
    const tiles = [
      `${col},${row}`, `${col + 1},${row}`,
      `${col},${row + 1}`, `${col + 1},${row + 1}`,
    ];
    for (const t of tiles) {
      if (!isBuildable(t)) {
        return { ok: false, error: `Footprint tile ${t} is not buildable`, code: 'FOOTPRINT_BLOCKED' };
      }
      if (assignments.has(t)) {
        return { ok: false, error: `Footprint tile ${t} is occupied`, code: 'FOOTPRINT_OCCUPIED' };
      }
      if (getPlotDistrict(t) !== district) {
        return { ok: false, error: `Footprint tile ${t} is in a different district`, code: 'FOOTPRINT_DISTRICT' };
      }
    }
  }

  // All checks passed — assign
  const assignment = {
    plotId,
    col,
    row,
    guildId,
    tier,
    district,
    footprint,
    assignedAt: Date.now(),
  };

  assignments.set(plotId, assignment);

  // For 2x2, also mark extra tiles
  if (footprint === 2) {
    for (const t of [`${col + 1},${row}`, `${col},${row + 1}`, `${col + 1},${row + 1}`]) {
      assignments.set(t, { ...assignment, plotId: t, isPrimary: false, primaryPlot: plotId });
    }
  }

  return { ok: true, assignment };
}

/**
 * Release a plot from a guild.
 */
function releasePlot(plotId, guildId) {
  const assignment = assignments.get(plotId);
  if (!assignment) {
    return { ok: false, error: 'Plot is not assigned', code: 'NOT_ASSIGNED' };
  }

  // Check for primary plot reference (2x2 buildings)
  const primaryId = assignment.primaryPlot || plotId;
  const primary = assignments.get(primaryId);
  if (!primary) {
    return { ok: false, error: 'Primary plot not found', code: 'NOT_FOUND' };
  }

  if (primary.guildId !== guildId) {
    return { ok: false, error: 'Guild does not own this plot', code: 'NOT_OWNER' };
  }

  // Remove all tiles (including 2x2 footprint)
  const footprint = primary.footprint || 1;
  const [col, row] = primaryId.split(',').map(Number);

  for (let dy = 0; dy < footprint; dy++) {
    for (let dx = 0; dx < footprint; dx++) {
      assignments.delete(`${col + dx},${row + dy}`);
    }
  }

  return { ok: true, released: primaryId };
}

/**
 * Get available plots in a district, scored by desirability.
 */
function getAvailablePlots(district, tier) {
  const map = loadDistrictMap();
  const districtTiles = map.districts[district];
  if (!districtTiles) return [];

  const footprint = TIER_FOOTPRINT[tier] || 1;
  const available = [];

  for (const key of districtTiles) {
    const [col, row] = key.split(',').map(Number);

    // Skip occupied, water, non-buildable
    if (assignments.has(key)) continue;
    if (map.water.has(key)) continue;
    if (!isBuildable(key)) continue;

    // Check spacing
    if (getSpacingViolation(col, row, footprint)) continue;

    // 2x2 footprint check
    if (footprint === 2) {
      const tiles = [key, `${col + 1},${row}`, `${col},${row + 1}`, `${col + 1},${row + 1}`];
      const allOk = tiles.every(t =>
        isBuildable(t) && !assignments.has(t) && getPlotDistrict(t) === district
      );
      if (!allOk) continue;
    }

    // Score: prefer center of district with moderate road proximity
    const bounds = map.districtBounds[district];
    const distFromCenter = bounds
      ? Math.sqrt((col - bounds.centerCol) ** 2 + (row - bounds.centerRow) ** 2)
      : 10;

    // Count adjacent roads
    let roadCount = 0;
    for (const [dc, dr] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      if (map.roads.has(`${col + dc},${row + dr}`)) roadCount++;
    }

    // Scoring: heavily favor district center, mild road bonus
    // Tiles 1-2 away from road = ideal (visible but not crammed on road)
    const isRoadAdj = map.roadAdjacent.has(key);
    const roadBonus = isRoadAdj ? 3 : 0;  // mild bonus, not dominant
    const score = 100 - distFromCenter * 3 + roadBonus;

    const reasons = [];
    if (isRoadAdj) reasons.push('Road adjacent');
    if (roadCount >= 2) reasons.push(`${roadCount} road sides`);
    if (distFromCenter < 5) reasons.push('Near district center');
    if (!isRoadAdj) reasons.push('Interior plot');

    available.push({ plotId: key, col, row, district, score: Math.round(score), reasons });
  }

  available.sort((a, b) => b.score - a.score);
  return available;
}

/**
 * Get all assignments (for /api/guilds enrichment).
 */
function getAllAssignments() {
  const result = {};
  for (const a of assignments.values()) {
    if (a.isPrimary === false) continue; // skip secondary 2x2 tiles
    if (!result[a.guildId]) result[a.guildId] = [];
    result[a.guildId].push({
      plotId: a.plotId,
      col: a.col,
      row: a.row,
      tier: a.tier,
      district: a.district,
      assignedAt: a.assignedAt,
    });
  }
  return result;
}

/**
 * Get the primary assignment for a guild (first plot).
 */
function getGuildPrimaryPlot(guildId) {
  for (const a of assignments.values()) {
    if (a.guildId === guildId && a.isPrimary !== false) {
      return {
        plotId: a.plotId,
        col: a.col,
        row: a.row,
        tier: a.tier,
        district: a.district,
        assignedAt: a.assignedAt,
      };
    }
  }
  return null;
}

/**
 * Get district stats.
 */
function getDistrictStats() {
  const map = loadDistrictMap();
  const stats = {};
  for (const [cat, tiles] of Object.entries(map.districts)) {
    const density = getDistrictDensity(cat);
    const buildingCount = [...assignments.values()].filter(
      a => a.district === cat && a.isPrimary !== false
    ).length;
    stats[cat] = {
      category: cat,
      totalTiles: tiles.size,
      buildableRoadAdjacentTiles: [...tiles].filter(t => map.roadAdjacent.has(t) && !map.water.has(t)).length,
      buildings: buildingCount,
      densityWeight: Math.round(density * 10) / 10,
      maxDensity: MAX_DISTRICT_WEIGHT,
      bounds: map.districtBounds[cat],
    };
  }
  return stats;
}

/* ── Initialization + persistence ───────────────────────────────────── */

/**
 * Set persistence adapter (e.g. Upstash Redis).
 * Must be called BEFORE init(). Adapter needs get(key) and set(key, value).
 */
function setPersistence(adapter) {
  persistence = adapter;
}

async function init() {
  loadDistrictMap();
  await loadPlotAssignments();

  // Auto-save every 5 minutes
  setInterval(() => {
    savePlotAssignments();
  }, 5 * 60 * 1000);

  // Save on exit
  process.on('SIGTERM', () => {
    console.log('[world-state] SIGTERM — saving plots...');
    savePlotAssignments();
    process.exit(0);
  });
  process.on('SIGINT', () => {
    console.log('[world-state] SIGINT — saving plots...');
    savePlotAssignments();
    process.exit(0);
  });
}

/* ── Exports ────────────────────────────────────────────────────────── */

module.exports = {
  init,
  setPersistence,
  assignPlot,
  releasePlot,
  getAvailablePlots,
  getAllAssignments,
  getGuildPrimaryPlot,
  getGuildPlots,
  getDistrictStats,
  savePlotAssignments,
  loadDistrictMap,
};
