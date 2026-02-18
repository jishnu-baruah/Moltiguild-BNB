/** Central biome configuration for terrain generation. */

export interface BiomeDef {
  /** Base terrain fill colors (4 variants picked randomly). */
  primaryColors: string[];
  /** Accent dots/patterns drawn on top of base terrain. */
  accentColors: string[];
  /** Water/liquid tile color (null if biome has no water). */
  waterColor: string | null;
  /** Secondary water highlight color for shimmer. */
  waterHighlight: string | null;
  /** Road tile tint — darker for volcanic, lighter for snow, etc. */
  roadTint: string;
}

export const BIOME_CONFIG: Record<string, BiomeDef> = {
  creative: {
    primaryColors: ['#4a8c3f', '#3f7a35', '#54964a', '#468840'],
    accentColors: ['#e88cb0', '#f0d060', '#6db86b', '#c8e070'],
    waterColor: '#3a7a6a',
    waterHighlight: '#5aaa8a',
    roadTint: '#6a6050',
  },
  townsquare: {
    primaryColors: ['#a89878', '#9a8a6c', '#b0a080', '#a09070'],
    accentColors: ['#887860', '#7a6c58', '#c0b090'],
    waterColor: null,
    waterHighlight: null,
    roadTint: '#8a7a68',
  },
  translation: {
    primaryColors: ['#c8b888', '#bca870', '#d0c090', '#c4b480'],
    accentColors: ['#e0d0a0', '#b0a060', '#d8c898'],
    waterColor: '#2868a0',
    waterHighlight: '#4888c0',
    roadTint: '#a09070',
  },
  defi: {
    primaryColors: ['#3a3030', '#443838', '#383030', '#4a3c3c'],
    accentColors: ['#c86030', '#e08840', '#a04820'],
    waterColor: '#c04010',
    waterHighlight: '#f08030',
    roadTint: '#504040',
  },
  research: {
    primaryColors: ['#2a2840', '#322e48', '#282638', '#342e4a'],
    accentColors: ['#8a70c0', '#50c8b0', '#7060a8'],
    waterColor: '#5040a0',
    waterHighlight: '#7060c0',
    roadTint: '#484060',
  },
  code: {
    primaryColors: ['#686878', '#606070', '#707080', '#5c5c6c'],
    accentColors: ['#c8d0e0', '#e0e8f0', '#a0a8b8'],
    waterColor: null,
    waterHighlight: null,
    roadTint: '#585868',
  },
};

/**
 * Water tile placement rules per biome using centroid-relative normalized coordinates.
 * Works with organic Voronoi district shapes (no rectangular grid assumption).
 */
export function shouldBeWater(
  col: number, row: number, biome: string,
  centroidCol: number, centroidRow: number,
  extentCol: number, extentRow: number,
): boolean {
  // Normalize to roughly -1..+1 relative to district centroid
  const nx = (col - centroidCol) / Math.max(1, extentCol);
  const ny = (row - centroidRow) / Math.max(1, extentRow);

  switch (biome) {
    case 'translation':
      // Ocean on the eastern edge of the district
      return nx > 0.6;
    case 'creative':
      // Small pond near district center
      return nx * nx + ny * ny < 0.06;
    case 'defi':
      // Diagonal lava river through the district
      return Math.abs(nx - ny) < 0.05;
    case 'research':
      // Scattered mystic pools using trig for pseudo-random placement
      return Math.sin(col * 3.7) * Math.cos(row * 2.3) > 0.85;
    default:
      return false;
  }
}
