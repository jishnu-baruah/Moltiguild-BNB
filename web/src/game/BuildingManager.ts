import * as Phaser from 'phaser';
import { TilemapManager } from './TilemapManager';
import { TreeManager } from './TreeManager';
import { GuildVisual, AgentVisual, getAgentTier } from '@/lib/world-state';

/** Tier → footprint size (1x1 or 2x2) and base scale. */
const TIER_CONFIG: Record<string, { footprint: number; scale: number }> = {
  tent:      { footprint: 1, scale: 0.35 },
  shack:     { footprint: 1, scale: 0.55 },
  house:     { footprint: 1, scale: 0.60 },
  townhouse: { footprint: 1, scale: 0.08 },  // source image is 1824×2336
  workshop:  { footprint: 2, scale: 0.55 },
  tower:     { footprint: 2, scale: 0.65 },
  landmark:  { footprint: 2, scale: 0.75 },
};

/**
 * Per-tier sprite keys — 6-phase building progression:
 * Phase 1 (tent):      Sailor tent
 * Phase 2 (shack):     Small wooden shack
 * Phase 3 (house):     Stone cottage with red roof
 * Phase 4 (townhouse): Two-story stone/wood building
 * Phase 5 (workshop):  Large stone workshop with lit windows
 * Phase 6 (tower+):    Crystal tower / town hall
 */
const TIER_SPRITES: Record<string, string[]> = {
  tent:      ['tent-hunter'],
  shack:     ['custom-shack'],
  house:     ['bldg-house'],
  townhouse: ['custom-townhouse'],
  workshop:  ['bldg-workshop'],
  tower:     ['guild-townhall'],
  landmark:  ['guild-townhall'],
};

interface PlacedBuilding {
  sprite: Phaser.GameObjects.Image;
  col: number;
  row: number;
  footprint: number;
  owner: string;
  tier: string;
}

export class BuildingManager {
  private buildings: PlacedBuilding[] = [];
  private tilemapManager: TilemapManager | null = null;
  private treeManager: TreeManager | null = null;

  constructor(private scene: Phaser.Scene) {}

  /** Wire dependencies after construction (called from WorldScene.create). */
  setDependencies(tilemapManager: TilemapManager, treeManager: TreeManager): void {
    this.tilemapManager = tilemapManager;
    this.treeManager = treeManager;
  }

  /**
   * Update buildings from live world state. Handles:
   * - Placing new agents that don't have a building yet
   * - Upgrading existing buildings when tier changes
   * - Removing buildings for agents no longer present
   */
  updateBuildings(guilds: GuildVisual[], agents: AgentVisual[]): void {
    if (!this.tilemapManager) return;

    // Remove buildings for agents no longer present
    const activeAddresses = new Set(agents.map(a => a.address));
    this.buildings = this.buildings.filter(b => {
      if (activeAddresses.has(b.owner)) return true;
      this.removeBuilding(b);
      return false;
    });

    // Place or upgrade buildings for each agent
    for (const agent of agents) {
      const tier = getAgentTier(agent.rating, agent.missions);
      const existing = this.buildings.find(b => b.owner === agent.address);

      if (existing) {
        // Check if tier changed — if so, upgrade
        if (existing.tier !== tier) {
          this.removeBuilding(existing);
          this.buildings = this.buildings.filter(b => b !== existing);
          this.placeBuilding(agent.address, tier, agent.guildId, guilds);
        }
      } else {
        // New agent — place building
        this.placeBuilding(agent.address, tier, agent.guildId, guilds);
      }
    }
  }

  private placeBuilding(owner: string, tier: string, guildId: number, guilds: GuildVisual[]): void {
    if (!this.tilemapManager) return;

    const config = TIER_CONFIG[tier] ?? TIER_CONFIG.tent;
    const footprint = config.footprint;

    // Find the agent's guild category
    const guild = guilds.find(g => g.guildId === guildId);
    const category = guild?.category ?? 'creative';

    // Find an unoccupied spot in the district
    const spot = this.findSpot(category, footprint);
    if (!spot) return;

    // Occupy tiles
    for (let dy = 0; dy < footprint; dy++) {
      for (let dx = 0; dx < footprint; dx++) {
        this.tilemapManager.occupyTile(spot.col + dx, spot.row + dy, owner, tier);
      }
    }

    // Clear trees if 2x2
    if (footprint === 2 && this.treeManager) {
      this.treeManager.clearTilesForBuilding(spot.col, spot.row, footprint);
    }

    // Place sprite at footprint center
    const centerCol = spot.col + (footprint - 1) * 0.5;
    const centerRow = spot.row + (footprint - 1) * 0.5;
    const pos = this.tilemapManager.gridToScreen(centerCol, centerRow);

    const sprites = TIER_SPRITES[tier] ?? TIER_SPRITES.tent;
    const key = sprites[Math.floor(Math.random() * sprites.length)];

    // Building sprite
    const sprite = this.scene.add.image(pos.x, pos.y, key);
    sprite.setOrigin(0.5, 0.95);
    sprite.setScale(config.scale);
    sprite.setDepth(7 + (centerCol + centerRow) * 0.01);

    this.buildings.push({
      sprite,
      col: spot.col, row: spot.row,
      footprint, owner, tier,
    });
  }

  private removeBuilding(building: PlacedBuilding): void {
    if (!this.tilemapManager) return;

    // Clear tile occupation
    for (let dy = 0; dy < building.footprint; dy++) {
      for (let dx = 0; dx < building.footprint; dx++) {
        this.tilemapManager.clearOccupation(building.col + dx, building.row + dy);
      }
    }

    building.sprite.destroy();
  }

  /** Find an unoccupied spot in a district. Uses seeded hash for deterministic, O(1) probing. */
  private findSpot(category: string, footprint: number): { col: number; row: number } | null {
    if (!this.tilemapManager) return null;

    const tiles = this.tilemapManager.getDistrictTiles(category);
    if (!tiles) return null;

    // Cache tile arrays per category to avoid repeated Array.from
    if (!this.tileCache) this.tileCache = new Map();
    let tileArr = this.tileCache.get(category);
    if (!tileArr) {
      tileArr = Array.from(tiles).map(k => {
        const [c, r] = k.split(',').map(Number);
        return { col: c, row: r };
      });
      this.tileCache.set(category, tileArr);
    }

    // Linear probe from a seeded starting index (avoids full shuffle)
    const seed = this.buildings.length * 7919 + category.charCodeAt(0) * 31;
    const start = ((seed >>> 0) % tileArr.length);
    const len = tileArr.length;

    for (let i = 0; i < len; i++) {
      const tile = tileArr[(start + i) % len];
      if (this.canPlace(tile.col, tile.row, footprint, category)) {
        return tile;
      }
    }
    return null;
  }

  private tileCache: Map<string, { col: number; row: number }[]> | null = null;

  /** Check if a footprint can be placed at (col, row). */
  private canPlace(col: number, row: number, footprint: number, category: string): boolean {
    if (!this.tilemapManager) return false;

    for (let dy = 0; dy < footprint; dy++) {
      for (let dx = 0; dx < footprint; dx++) {
        const c = col + dx;
        const r = row + dy;
        if (this.tilemapManager.isOccupied(c, r)) return false;
        if (this.tilemapManager.isRoad(c, r)) return false;
        if (this.tilemapManager.isWater(c, r)) return false;
        // For 2x2, all tiles must be in the same district
        if (footprint > 1 && this.tilemapManager.getTileDistrict(c, r) !== category) return false;
      }
    }
    return true;
  }

  destroy(): void {
    for (const b of this.buildings) {
      b.sprite.destroy();
    }
    this.buildings = [];
  }
}
