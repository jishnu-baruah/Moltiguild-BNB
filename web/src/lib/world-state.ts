export interface WorldState {
  districts: District[];
  guilds: GuildVisual[];
  agents: AgentVisual[];
  feed: FeedEvent[];
  stats: GlobalStats;
}

export interface District {
  name: string;
  category: string;
  color: string;
  position: { x: number; y: number };
  width: number;
  height: number;
}

export interface PlotAssignment {
  plotId: string;
  col: number;
  row: number;
  tier: string;
  district: string;
  assignedAt: number;
}

export interface GuildVisual {
  guildId: number;
  name: string;
  category: string;
  tier: 'bronze' | 'silver' | 'gold' | 'diamond';
  avgRating: number;
  totalMissions: number;
  position: { x: number; y: number };
  agents: AgentVisual[];
  isAnimating: boolean;
  animationType: 'none' | 'construction' | 'fireworks' | 'decay';
  assignedPlot?: PlotAssignment | null;
}

export interface AgentVisual {
  address: string;
  role: string;
  guildId: number;
  tier: 'tent' | 'shack' | 'house' | 'townhouse' | 'workshop' | 'tower' | 'landmark';
  rating: number;
  missions: number;
  position: { x: number; y: number };
}

export interface FeedEvent {
  type: 'mission_completed' | 'mission_created' | 'mission_rated' | 'mission_claimed' | 'guild_created' | 'agent_registered' | 'plot_assigned' | 'plot_released';
  guildId: number;
  missionId?: number;
  score?: number;
  budget?: string;
  paid?: string;
  agent?: string;
  timestamp: number;
  txHash: string;
  plotId?: string;
  col?: number;
  row?: number;
  tier?: string;
  district?: string;
}

export interface GlobalStats {
  totalGuilds: number;
  totalAgents: number;
  totalMissions: number;
  totalEarned: string;
  avgRating: number;
}

export function getGuildTier(missions: number, rating: number): GuildVisual['tier'] {
  if (missions >= 200 && rating >= 4.5) return 'diamond';
  if (missions >= 50 && rating >= 4.0) return 'gold';
  if (missions >= 10 && rating >= 3.5) return 'silver';
  return 'bronze';
}

export function getAgentTier(rating: number, missions: number): AgentVisual['tier'] {
  if (rating >= 4.8 && missions >= 100) return 'landmark';
  if (rating >= 4.5 && missions >= 50) return 'tower';
  if (rating >= 4.0 && missions >= 25) return 'workshop';
  if (rating >= 3.5 && missions >= 10) return 'townhouse';
  if (rating >= 3.0 && missions >= 5) return 'house';
  if (missions > 0) return 'shack';
  return 'tent';
}

/** Voronoi seed positions (grid coordinates) matching TilemapManager districts. */
export const DISTRICT_CENTERS: Record<string, { x: number; y: number; width: number }> = {
  townsquare:  { x: 28, y: 28, width: 14 },
  creative:    { x: 19, y: 19, width: 12 },
  translation: { x: 34, y: 17, width: 12 },
  code:        { x: 40, y: 30, width: 12 },
  research:    { x: 30, y: 40, width: 12 },
  defi:        { x: 17, y: 34, width: 12 },
};

/** Valid district categories on the tilemap. */
const VALID_DISTRICTS = new Set(Object.keys(DISTRICT_CENTERS));

/** Map guild categories to district categories (some categories share a district). */
export function categoryToDistrict(category: string): string {
  const mapping: Record<string, string> = {
    meme: 'creative',
    'content-creation': 'creative',
    math: 'research',
    science: 'research',
    analytics: 'research',
    trading: 'defi',
    finance: 'defi',
    writing: 'creative',
    art: 'creative',
    design: 'creative',
    dev: 'code',
    engineering: 'code',
    language: 'translation',
    test: 'townsquare',
    general: 'townsquare',
  };
  const mapped = mapping[category] ?? category;
  // Fallback: if the mapped category isn't a real district, place in townsquare
  return VALID_DISTRICTS.has(mapped) ? mapped : 'townsquare';
}

/** Simple seeded hash for deterministic placement per guild. */
function guildHash(guildId: number): number {
  let h = guildId * 2654435761;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  h = ((h >>> 16) ^ h) * 0x45d9f3b;
  return (h >>> 16) ^ h;
}

/**
 * Get a deterministic grid position for a guild within its district.
 * Returns grid tile coordinates (not pixel positions).
 */
export function getGuildPosition(guildId: number, category: string): { x: number; y: number } {
  const districtKey = categoryToDistrict(category);
  const district = DISTRICT_CENTERS[districtKey] || DISTRICT_CENTERS['creative'];
  const hash = guildHash(guildId);
  const halfW = Math.floor(district.width / 2);
  // Spread guilds in a spiral-like pattern around district center
  const offsetX = ((hash & 0xFF) % (district.width - 2)) - halfW + 1;
  const offsetY = (((hash >> 8) & 0xFF) % (district.width - 2)) - halfW + 1;
  return {
    x: district.x + offsetX,
    y: district.y + offsetY,
  };
}
