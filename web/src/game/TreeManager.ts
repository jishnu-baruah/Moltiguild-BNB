import * as Phaser from 'phaser';
import { TilemapManager, GRID_COLS, GRID_ROWS } from './TilemapManager';
import { seededRng, ValueNoise2D } from './noise';

/* ── Frame definitions for tree textures extracted from spritesheet ── */
interface TreeFrame {
  name: string;
  category: 'large' | 'medium' | 'conifer' | 'dead' | 'bush';
  weight: number;
}

const TREE_FRAMES: TreeFrame[] = [
  { name: 'tree-large-a', category: 'large',   weight: 1 },
  { name: 'tree-large-b', category: 'large',   weight: 1 },
  { name: 'tree-medium',  category: 'medium',  weight: 3 },
  { name: 'tree-conifer',  category: 'conifer', weight: 2 },
  { name: 'tree-dead',     category: 'dead',    weight: 1 },
  { name: 'bush-a',        category: 'bush',    weight: 4 },
  { name: 'bush-b',        category: 'bush',    weight: 4 },
];

/* Default green tint variations for non-biome trees */
const TREE_TINTS = [0xffffff, 0xe8ffe8, 0xd8f0d8, 0xf0ffe0];

/* Per-biome tree tint palettes */
const BIOME_TREE_TINTS: Record<string, number[]> = {
  creative:    [0xe0ffe0, 0xffd8e8, 0xd8ffd8, 0xf8e8f0],  // greens + pinks
  townsquare:  [0xf0e8d0, 0xe8dcc8, 0xffffff, 0xf0ead8],  // warm neutrals
  translation: [0xd0f0d0, 0xc8e8c0, 0xe0ffd0, 0xd8f0c8],  // tropical greens
  defi:        [0xc8a878, 0xb89868, 0xa08058, 0xd0b080],   // burnt browns
  research:    [0xd0c8e8, 0xc0d8e0, 0xb8b0d8, 0xd0e0e8],  // purple/teal tints
  code:        [0xe0e8f0, 0xd0d8e8, 0xf0f0f8, 0xd8e0e8],  // frosty whites
};

/* Per-biome tree type weight overrides (category → weight multiplier) */
const BIOME_TREE_WEIGHTS: Record<string, Record<string, number>> = {
  creative:    { bush: 2, medium: 2, dead: 0 },
  defi:        { dead: 3, bush: 0.5, large: 0.5 },
  code:        { conifer: 3, dead: 1.5, bush: 0.5 },
  research:    { bush: 2, medium: 1.5, dead: 0 },
  translation: { medium: 2, bush: 2 },
  townsquare:  { bush: 3, medium: 1, large: 0.3, dead: 0 },
};

/* seededRng and ValueNoise2D imported from noise.ts */

/* ── TreeManager ───────────────────────────────────────────────────── */
export class TreeManager {
  private sprites: Phaser.GameObjects.Image[] = [];
  private shadows: Phaser.GameObjects.Image[] = [];
  /** Map "col,row" → index into sprites/shadows arrays for clearing. */
  private tileIndex: Map<string, number[]> = new Map();

  private static readonly NOISE_SEED = 1337;
  private static readonly NOISE_GRID = 6;
  private static readonly BUILDING_CLEARANCE_SQ = 16; // 4-tile radius
  private static readonly TARGET_PERCENT = 0.12;      // target: 12% of total grass tiles

  constructor(
    private scene: Phaser.Scene,
    private tilemapManager: TilemapManager,
    private buildingPositions: { gx: number; gy: number }[],
  ) {}

  scatter(): void {
    const {
      NOISE_SEED, NOISE_GRID,
      BUILDING_CLEARANCE_SQ, TARGET_PERCENT,
    } = TreeManager;

    const noise = new ValueNoise2D(NOISE_GRID, NOISE_SEED);
    const noise2 = new ValueNoise2D(NOISE_GRID + 2, NOISE_SEED + 99);
    const rand = seededRng(NOISE_SEED + 7);

    // Build weighted selection array
    const weighted: TreeFrame[] = [];
    for (const f of TREE_FRAMES) {
      for (let i = 0; i < f.weight; i++) weighted.push(f);
    }

    // Pass 1: collect all eligible tiles and score them (districts + edges)
    const candidates: { col: number; row: number; score: number; biome: string | undefined }[] = [];
    let totalEligible = 0;

    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        // Skip tiles outside the organic world boundary
        if (!this.tilemapManager.isInWorld(col, row)) continue;

        // Skip road tiles
        if (this.tilemapManager.isRoad(col, row)) continue;

        totalEligible++;

        // Skip tiles too close to buildings (4-tile radius)
        const nearBuilding = this.buildingPositions.some(
          b => (b.gx - col) ** 2 + (b.gy - row) ** 2 < BUILDING_CLEARANCE_SQ,
        );
        if (nearBuilding) continue;

        // Skip tiles on district borders (within 1 tile of a different district)
        if (this.isDistrictBorder(col, row)) continue;

        // Sample two noise octaves for organic clustering
        const nx = (col / GRID_COLS) * NOISE_GRID;
        const ny = (row / GRID_ROWS) * NOISE_GRID;
        const n1 = noise.sample(nx, ny);
        const n2 = noise2.sample(nx * 1.5, ny * 1.5);
        let score = n1 * 0.7 + n2 * 0.3;

        // Boost tiles near the world boundary — natural forest border
        // Uses same screen-space ellipse radii as the world mask
        const sx = (col - row) - (GRID_COLS / 2 - GRID_ROWS / 2);
        const sy = (col + row) - (GRID_COLS / 2 + GRID_ROWS / 2);
        const maskRx = (GRID_COLS + GRID_ROWS) * 0.38;
        const maskRy = (GRID_COLS + GRID_ROWS) * 0.36;
        const edgeDist = (sx / maskRx) ** 2 + (sy / maskRy) ** 2;
        if (edgeDist > 0.55) {
          score += 0.35 * Math.min(1, (edgeDist - 0.55) / 0.4);
        }

        // Boost areas between districts (mid-ground dividers)
        const betweenDistricts = this.isBetweenDistricts(col, row);
        if (betweenDistricts) {
          score += 0.15;
        }

        // Slight reduction in dead center to keep town area open
        const cDist = Math.sqrt((col - GRID_COLS / 2) ** 2 + (row - GRID_ROWS / 2) ** 2);
        if (cDist < 6) {
          score *= 0.5;
        }

        candidates.push({ col, row, score, biome: this.tilemapManager.getTileDistrict(col, row) });
      }
    }

    // Sort by score descending — pick the top N
    candidates.sort((a, b) => b.score - a.score);

    const targetCount = Math.floor(totalEligible * TARGET_PERCENT);
    const toPlace = candidates.slice(0, targetCount);

    // Place trees
    for (const { col, row, biome } of toPlace) {
      const jx = (rand() - 0.5) * 0.5;
      const jy = (rand() - 0.5) * 0.5;
      const pos = this.tilemapManager.gridToScreen(col + jx, row + jy);

      // Use biome-weighted selection if inside a district
      const biomeWeights = biome ? BIOME_TREE_WEIGHTS[biome] : undefined;
      const frame = biomeWeights
        ? this.selectBiomeFrame(rand, biomeWeights)
        : this.selectFrame(rand, weighted);
      const scale = this.getScale(frame.category, rand);

      // Biome-specific tint
      const tintPalette = biome ? (BIOME_TREE_TINTS[biome] ?? TREE_TINTS) : TREE_TINTS;
      const tint = tintPalette[Math.floor(rand() * tintPalette.length)];

      // Shadow
      const shadow = this.scene.add.image(pos.x + 3, pos.y + 4, 'building-shadow');
      shadow.setOrigin(0.5, 0.5);
      shadow.setScale(scale * 1.4, scale * 0.7);
      shadow.setDepth(0.5);
      shadow.setAlpha(0.25);
      this.shadows.push(shadow);

      // Tree sprite
      const sprite = this.scene.add.image(pos.x, pos.y, frame.name);
      sprite.setOrigin(0.5, 0.85);
      sprite.setScale(scale);
      sprite.setDepth(6.5 + (col + row) * 0.01);
      if (tint !== 0xffffff) sprite.setTint(tint);

      const idx = this.sprites.length;
      this.sprites.push(sprite);

      // Track which tile this tree sits on for clearing
      const tileKey = `${col},${row}`;
      const existing = this.tileIndex.get(tileKey);
      if (existing) existing.push(idx);
      else this.tileIndex.set(tileKey, [idx]);
    }

    // Log stats for verification
    const pct = (toPlace.length / Math.max(1, totalEligible) * 100).toFixed(1);
    console.log(
      `[TreeManager] eligible=${totalEligible} placed=${toPlace.length} (${pct}%)`,
    );
  }

  /** Check if tile is on the border between two different districts. */
  private isDistrictBorder(col: number, row: number): boolean {
    const myDistrict = this.tilemapManager.getTileDistrict(col, row);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nc = col + dx;
        const nr = row + dy;
        if (nc < 0 || nr < 0 || nc >= GRID_COLS || nr >= GRID_ROWS) continue;
        const neighbor = this.tilemapManager.getTileDistrict(nc, nr);
        if (neighbor !== myDistrict) return true;
      }
    }
    return false;
  }

  /** Check if tile sits in the gap between two or more district regions. */
  private isBetweenDistricts(col: number, row: number): boolean {
    const seen = new Set<string>();
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const nc = col + dx;
        const nr = row + dy;
        if (nc < 0 || nr < 0 || nc >= GRID_COLS || nr >= GRID_ROWS) continue;
        const cat = this.tilemapManager.getTileDistrict(nc, nr);
        if (cat) seen.add(cat);
      }
    }
    return seen.size >= 2;
  }

  /** Select a tree frame using biome-specific weight overrides. */
  private selectBiomeFrame(rand: () => number, weightOverrides: Record<string, number>): TreeFrame {
    const biomeWeighted: TreeFrame[] = [];
    for (const f of TREE_FRAMES) {
      const mult = weightOverrides[f.category] ?? 1;
      const count = Math.round(f.weight * mult);
      for (let i = 0; i < count; i++) biomeWeighted.push(f);
    }
    if (biomeWeighted.length === 0) return TREE_FRAMES[2]; // fallback to medium
    return biomeWeighted[Math.floor(rand() * biomeWeighted.length)];
  }

  private selectFrame(rand: () => number, weighted: TreeFrame[]): TreeFrame {
    if (rand() < 0.10) {
      return rand() < 0.5 ? TREE_FRAMES[0] : TREE_FRAMES[1]; // large
    }
    if (rand() < 0.20) {
      return TREE_FRAMES[2]; // medium
    }
    return weighted[Math.floor(rand() * weighted.length)];
  }

  private getScale(category: string, rand: () => number): number {
    switch (category) {
      case 'large':   return 0.35 + rand() * 0.15;
      case 'medium':  return 0.28 + rand() * 0.12;
      case 'conifer': return 0.28 + rand() * 0.12;
      case 'dead':    return 0.22 + rand() * 0.10;
      case 'bush':    return 0.22 + rand() * 0.10;
      default:        return 0.28;
    }
  }

  /** Clear tree sprites within a building footprint area. */
  clearTilesForBuilding(col: number, row: number, size: number): void {
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const key = `${col + dx},${row + dy}`;
        const indices = this.tileIndex.get(key);
        if (!indices) continue;
        for (const idx of indices) {
          if (this.sprites[idx]) {
            this.sprites[idx].destroy();
            (this.sprites as (Phaser.GameObjects.Image | null)[])[idx] = null;
          }
          if (this.shadows[idx]) {
            this.shadows[idx].destroy();
            (this.shadows as (Phaser.GameObjects.Image | null)[])[idx] = null;
          }
        }
        this.tileIndex.delete(key);
      }
    }
  }

  destroy(): void {
    for (const s of this.sprites) if (s) s.destroy();
    for (const s of this.shadows) if (s) s.destroy();
    this.sprites = [];
    this.shadows = [];
    this.tileIndex.clear();
  }
}
