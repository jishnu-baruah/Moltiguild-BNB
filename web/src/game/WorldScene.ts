import * as Phaser from 'phaser';
import { TilemapManager, TILE_WIDTH, TILE_HEIGHT, GRID_COLS, GRID_ROWS, BIOME_NAMES } from './TilemapManager';
import { CameraController } from './CameraController';
import { BuildingManager } from './BuildingManager';
import { GuildHallManager } from './GuildHallManager';
import { ParticleManager } from './ParticleManager';
import { MinimapManager } from './MinimapManager';
import { TreeManager } from './TreeManager';
import { CinematicIntro, SKIP_INTRO } from './CinematicIntro';
import { WorldState } from '@/lib/world-state';
import { seededRng } from './noise';

/** Number of tile variants per biome / terrain type. */
const TILE_VARIANT_COUNT = 4;

export class WorldScene extends Phaser.Scene {
  private tilemapManager!: TilemapManager;
  private cameraController!: CameraController;
  private buildingManager!: BuildingManager;
  private guildHallManager!: GuildHallManager;
  private particleManager!: ParticleManager;
  private minimapManager!: MinimapManager;
  private treeManager!: TreeManager;
  private cinematicIntro: CinematicIntro | null = null;
  private buildingPositions: { gx: number; gy: number }[] = [];
  private buildingSprites: Phaser.GameObjects.Image[] = [];
  private waterSprites: Phaser.GameObjects.Image[] = [];
  /** Maps "col,row" → list of asset keys placed on that tile. */
  private tileAssets: Map<string, string[]> = new Map();

  constructor() {
    super({ key: 'WorldScene' });
  }

  preload(): void {
    // Sailor tent for agent tent-tier buildings
    this.load.image('tent-hunter', '/sailor-tents/hunter/as_hunter0/idle/225/0.png');

    // ── Custom MoltiGuild building sprites ──
    const mg = '/moltiguild-assets';
    this.load.image('custom-shack', `${mg}/shack.png`);
    this.load.image('custom-townhouse', `${mg}/townhouse.png`);
    this.load.image('custom-workshop', `${mg}/workshop.png`);

    // ── Custom tile textures ──
    this.load.image('tile-cobblestone', `${mg}/cobblestone.png`);
    this.load.image('tile-road', `${mg}/road-tile.png`);
    this.load.image('tile-sand', `${mg}/sand-tile.png`);
    this.load.image('tile-ocean', `${mg}/ocean-tile.png`);
    this.load.image('tile-lava', `${mg}/lava-tile.png`);
    this.load.image('tile-lava-base', `${mg}/lava-base.png`);
    this.load.image('tile-lava-crust', `${mg}/lava-crust.png`);
    this.load.image('tile-lava-center', `${mg}/lava-tile-center.png`);
    this.load.image('tile-meadow-grass', `${mg}/meadow-grass.png`);
    this.load.image('tile-meadow-flowers', `${mg}/meadow-flowers.png`);
    this.load.image('tile-mountain', `${mg}/mountain-tile.png`);
    this.load.image('tile-ark-rock', `${mg}/ark-rock-tile.png`);
    this.load.image('tile-mystic-stone', `${mg}/mystic-stone.png`);
    this.load.image('tile-mountain-peak', `${mg}/mountain-peak.png`);

    // ── Agent tier building sprites ──
    this.load.image('bldg-house', `${mg}/Gemini_Generated_Image_oilkw8oilkw8oilk%20Background%20Removed.png`);
    this.load.image('bldg-workshop', `${mg}/workshop%20Background%20Removed.png`);

    // ── Custom decoration sprites ──
    this.load.image('deco-fountain', `${mg}/fountain.png`);
    this.load.image('deco-lamp-post', `${mg}/lamp-post.png`);
    this.load.image('deco-blossom-tree', `${mg}/blossom-tree.png`);
    this.load.image('deco-crystal', `${mg}/crystal.png`);
    this.load.image('deco-fishing-boat', `${mg}/fishing-boat.png`);
    this.load.image('deco-pond-center', `${mg}/pond-center.png`);
    this.load.image('deco-pond-left', `${mg}/pond-left.png`);
    this.load.image('deco-pond-right', `${mg}/pond-right.png`);

    // ── Custom guild hall sprites ──
    const pg = '/pngs';
    this.load.image('guild-bronze', `${pg}/simple%20wooden%20guild%20hall%20Background%20Removed.png`);
    this.load.image('guild-silver', `${pg}/stone%20guild%20hall%20Background%20Removed.png`);
    this.load.image('guild-gold', `${pg}/grand%20guild%20citadel%20Background%20Removed.png`);
    this.load.image('guild-diamond', `${pg}/Massive%20cathedral%20like%20guild%20hall%20Background%20Removed.png`);

    // ── Custom guild-related sprites ──
    this.load.image('guild-townhall', `${pg}/town%20hall%20Background%20Removed.png`);

    // Grass tile texture (dark variant)
    this.load.image('grass-dark', '/grass/tilable-IMG_0044-dark.png');
  }

  create(): void {
    this.game.events.emit('load-progress', 0.20, 'Generating textures...');

    // Create programmatic textures (grass fallback, water, shadow)
    this.createGrassTileTextures();
    this.createWaterTileTextures();
    this.createShadowTexture();

    // Background gradient (depth -10, fixed to camera)
    this.createBackgroundGradient();

    this.game.events.emit('load-progress', 0.35, 'Initializing world...');

    this.tilemapManager = new TilemapManager(this);
    this.cameraController = new CameraController(
      this,
      this.tilemapManager.worldWidth,
      this.tilemapManager.worldHeight
    );
    this.buildingManager = new BuildingManager(this);
    this.guildHallManager = new GuildHallManager(this);
    this.particleManager = new ParticleManager(this);

    this.game.events.emit('load-progress', 0.45, 'Laying terrain...');

    // Lay terrain tiles per biome (depth 0, below district color overlay)
    this.placeTerrainTiles();

    this.game.events.emit('load-progress', 0.55, 'Placing decorations...');

    // Scatter mountain peaks across Code Heights
    this.placeTranslationMountains();

    // Lava gradient in DeFi Docks (center stream → outward cooling)
    this.placeDefiLavaGradient();

    // Scatter lamp posts across all districts
    this.scatterLampPosts();

    // Scatter crystals across Research Fields
    this.scatterResearchCrystals();

    // Scatter fishing boats on Translation Ward ocean
    this.scatterTranslationBoats();

    // Scatter blossom trees across Creative Quarter
    this.scatterBlossomTrees();

    // Fountain at Town Square center
    const tsCenter = this.tilemapManager.getDistrictCenter('townsquare');
    if (tsCenter) {
      const tsBounds = this.tilemapManager.getDistrictBounds('townsquare');
      const depth = tsBounds ? 6 + (tsBounds.centerCol + tsBounds.centerRow) * 0.01 : 6;

      const fountain = this.add.image(tsCenter.x, tsCenter.y, 'deco-fountain');
      fountain.setOrigin(0.5, 0.7);
      fountain.setScale(0.65);
      fountain.setDepth(depth);
      if (tsBounds) this.trackAsset(tsBounds.centerCol, tsBounds.centerRow, 'deco-fountain');
    }

    // Wire manager dependencies (TreeManager placeholder for clearing support)
    this.treeManager = new TreeManager(this, this.tilemapManager, this.buildingPositions);
    this.buildingManager.setDependencies(this.tilemapManager, this.treeManager);
    this.guildHallManager.setDependencies(this.tilemapManager, this.treeManager);

    // Minimap (pass building positions for dot markers)
    this.minimapManager = new MinimapManager(this, this.tilemapManager, this.buildingPositions);

    // Wire minimap bounds as drag exclusion zone
    const mb = this.minimapManager.screenBounds;
    this.cameraController.setExclusionZone(mb.x, mb.y, mb.w, mb.h);
    this.scale.on('resize', () => {
      const b = this.minimapManager.screenBounds;
      this.cameraController.setExclusionZone(b.x, b.y, b.w, b.h);
    });

    // Camera PostFX (vignette + warm color tint)
    this.setupPostFX();

    // Center camera on Town Square
    const { x, y } = this.tilemapManager.townSquareCenterScreen;
    this.cameraController.centerOn(x, y);

    // Cinematic intro — zoomed-out overview, click a district to dive in
    if (!SKIP_INTRO) {
      this.cameraController.disable();
      this.cinematicIntro = new CinematicIntro(
        this, this.cameras.main, this.tilemapManager, this.minimapManager,
        (districtCategory) => {
          this.cameraController.enable();
          console.log('Entered district:', districtCategory);
        },
        () => {
          this.cameraController.disable();
          console.log('Returned to overview');
        },
      );
    }

    this.game.events.emit('load-progress', 0.70, 'Finalizing scene...');

    // Signal to React bridge that scene is fully created and ready for worldState
    this.game.events.emit('scene-created');
  }

  update(_time: number, delta: number): void {
    this.cinematicIntro?.update(_time, delta);

  }

  /** Decoration prefixes that should block building placement. */
  private static readonly DECORATION_PREFIXES = [
    'deco-', 'tile-mountain', 'tile-lava', 'tile-meadow',
  ];

  private trackAsset(col: number, row: number, assetKey: string): void {
    const k = `${col},${row}`;
    const list = this.tileAssets.get(k);
    if (list) list.push(assetKey);
    else this.tileAssets.set(k, [assetKey]);

    // Mark decoration tiles so buildings can't overlap them
    if (WorldScene.DECORATION_PREFIXES.some(p => assetKey.startsWith(p))) {
      this.tilemapManager.markDecoration(col, row);
    }
  }


  /**
   * Create diamond-clipped grass tile textures from the dark grass image.
   * Used as fallback for non-district, non-road tiles.
   */
  private createGrassTileTextures(): void {
    const hw = TILE_WIDTH / 2;
    const hh = TILE_HEIGHT / 2;
    const src = this.textures.get('grass-dark').getSourceImage() as HTMLImageElement;
    const srcW = src.width;
    const srcH = src.height;
    const sampleW = 192;
    const sampleH = 96;

    for (let vi = 0; vi < TILE_VARIANT_COUNT; vi++) {
      const texKey = `grass-tile-${vi}`;
      const canvasTex = this.textures.createCanvas(texKey, TILE_WIDTH, TILE_HEIGHT);
      if (!canvasTex) continue;

      const ctx = canvasTex.context;
      ctx.beginPath();
      ctx.moveTo(hw, 0);
      ctx.lineTo(TILE_WIDTH, hh);
      ctx.lineTo(hw, TILE_HEIGHT);
      ctx.lineTo(0, hh);
      ctx.closePath();
      ctx.clip();

      const ox = (vi % 2) * Math.floor(srcW / 3);
      const oy = Math.floor(vi / 2) * Math.floor(srcH / 3);
      ctx.drawImage(src, ox, oy, sampleW, sampleH, 0, 0, TILE_WIDTH, TILE_HEIGHT);
      canvasTex.refresh();
    }
  }

  /** Biome → tile image keys (assets are already isometric, used directly). */
  private static readonly BIOME_TILE_KEYS: Record<string, string[]> = {
    townsquare:  ['tile-cobblestone'],
    defi:        ['tile-ark-rock'],
    creative:    ['tile-meadow-grass'],
    code:        ['tile-mountain'],
    research:    ['tile-mystic-stone'],
    translation: ['tile-sand'],
  };

  /** Create water/liquid tile textures per biome. */
  private createWaterTileTextures(): void {
    const hw = TILE_WIDTH / 2;
    const hh = TILE_HEIGHT / 2;
    const rand = seededRng(2468);

    const waterBiomes: { name: string; color: string; highlight: string }[] = [
      { name: 'translation', color: '#2868a0', highlight: '#4888c0' },
      { name: 'creative', color: '#3a7a6a', highlight: '#5aaa8a' },
      { name: 'defi', color: '#c04010', highlight: '#f08030' },
      { name: 'research', color: '#5040a0', highlight: '#7060c0' },
    ];

    for (const wb of waterBiomes) {
      for (let vi = 0; vi < TILE_VARIANT_COUNT; vi++) {
        const texKey = `water-${wb.name}-${vi}`;
        const canvasTex = this.textures.createCanvas(texKey, TILE_WIDTH, TILE_HEIGHT);
        if (!canvasTex) continue;

        const ctx = canvasTex.context;
        ctx.beginPath();
        ctx.moveTo(hw, 0);
        ctx.lineTo(TILE_WIDTH, hh);
        ctx.lineTo(hw, TILE_HEIGHT);
        ctx.lineTo(0, hh);
        ctx.closePath();
        ctx.clip();

        // Base water color
        ctx.fillStyle = wb.color;
        ctx.fillRect(0, 0, TILE_WIDTH, TILE_HEIGHT);

        // Wave highlights
        ctx.strokeStyle = wb.highlight;
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.3 + rand() * 0.2;
        for (let w = 0; w < 3; w++) {
          const wy = 6 + w * 10 + rand() * 4;
          ctx.beginPath();
          ctx.moveTo(5, wy);
          ctx.bezierCurveTo(20, wy - 3, 40, wy + 3, 60, wy);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;

        canvasTex.refresh();
      }
    }
  }

  // Road tile uses 'tile-road' image directly (already isometric) — no canvas needed

  /** Create an elliptical drop-shadow canvas texture. */
  private createShadowTexture(): void {
    const w = 48;
    const h = 16;
    const tex = this.textures.createCanvas('building-shadow', w, h);
    if (!tex) return;

    const ctx = tex.context;
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.35)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.15)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    tex.refresh();
  }

  /** Background is handled by Phaser config backgroundColor — no overlay needed. */
  private createBackgroundGradient(): void {
    // Intentionally empty — the Phaser canvas backgroundColor (#1a1a2a)
    // provides a clean flat dark background behind the isometric map.
    // A previous radial gradient overlay created a visible "box" artifact.
  }

  /** Set up camera PostFX: dark medieval atmosphere (WebGL only). */
  private setupPostFX(): void {
    const cam = this.cameras.main;
    if (!cam.postFX) return; // Canvas renderer — skip GPU effects

    // Moderate vignette — dark edges for medieval feel
    cam.postFX.addVignette(0.5, 0.5, 0.75, 0.30);

    // Slightly desaturated + dimmed for a medieval look
    const colorMatrix = cam.postFX.addColorMatrix();
    colorMatrix.brightness(0.88);
    colorMatrix.saturate(-0.18);
    // Warm shadow tint: subtle sepia push
    const m = colorMatrix.getData();
    m[0] += 0.03;    // R → R slight warmth
    m[6] -= 0.01;    // G → G slight mute
    m[12] -= 0.04;   // B → B pull down for amber shadows
    colorMatrix.set(m);
  }

  /** Place biome-appropriate terrain tiles across the entire world.
   *  All custom tile assets are already isometric — placed directly, no canvas clipping. */
  private placeTerrainTiles(): void {
    // Tile images are now exactly 64x32 — no scaling needed, placed at 1:1

    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        if (!this.tilemapManager.isInWorld(col, row)) continue;

        const pos = this.tilemapManager.gridToScreen(col, row);
        const vi = (col + row * 3) % TILE_VARIANT_COUNT;
        const biome = this.tilemapManager.getDistrictBiome(col, row);

        if (biome && this.tilemapManager.isWater(col, row)) {
          // Water tiles — use ocean-tile for translation, programmatic for others
          if (biome === 'translation') {
            const sprite = this.add.image(pos.x, pos.y, 'tile-ocean');
            sprite.setOrigin(0.5, 0.5);
            sprite.setDepth(0);
            this.waterSprites.push(sprite);
            this.trackAsset(col, row, 'tile-ocean');
          } else {
            let texKey = `water-${biome}-${vi}`;
            if (!this.textures.exists(texKey)) texKey = `grass-tile-${vi}`;
            const sprite = this.add.image(pos.x, pos.y, texKey);
            sprite.setOrigin(0.5, 0.5);
            sprite.setDepth(0);
            this.waterSprites.push(sprite);
            this.trackAsset(col, row, texKey);
          }
        } else if (biome) {
          // Use real tile image directly (64x32, already isometric)
          const tileKeys = WorldScene.BIOME_TILE_KEYS[biome];
          if (tileKeys && tileKeys.length > 0) {
            const key = tileKeys[vi % tileKeys.length];
            const sprite = this.add.image(pos.x, pos.y, key);
            sprite.setOrigin(0.5, 0.5);
            sprite.setDepth(0);
            this.trackAsset(col, row, key);
          }
        } else if (this.tilemapManager.isRoad(col, row)) {
          // Road tile (64x32, already isometric)
          const sprite = this.add.image(pos.x, pos.y, 'tile-road');
          sprite.setOrigin(0.5, 0.5);
          sprite.setDepth(0);
          this.trackAsset(col, row, 'tile-road');
        } else {
          // Default grass fallback
          const texKey = `grass-tile-${vi}`;
          const sprite = this.add.image(pos.x, pos.y, texKey);
          sprite.setOrigin(0.5, 0.5);
          sprite.setDepth(0);
          this.trackAsset(col, row, texKey);
        }
      }
    }

    // Water shimmer animation
    if (this.waterSprites.length > 0) {
      this.tweens.add({
        targets: this.waterSprites,
        alpha: { from: 1.0, to: 0.8 },
        duration: 2000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }

  /**
   * Place dense mountain-peak clusters across Code Heights.
   * First picks group centers spread across the district, then fills
   * nearby tiles around each center for a dense, grouped look.
   */
  private placeTranslationMountains(): void {
    const rand = seededRng(7777);
    const tiles = this.tilemapManager.getDistrictTiles('code');
    if (!tiles || tiles.size === 0) return;

    const tileSet = new Set(tiles);
    const tileArr = Array.from(tiles).map(k => {
      const [c, r] = k.split(',').map(Number);
      return { col: c, row: r };
    });

    // Sort then shuffle for deterministic group center selection
    tileArr.sort((a, b) => a.col - b.col || a.row - b.row);
    for (let i = tileArr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [tileArr[i], tileArr[j]] = [tileArr[j], tileArr[i]];
    }

    // Pick 4 group centers, well-spaced across the district
    const GROUP_COUNT = 4;
    const GROUP_MIN_DIST_SQ = 6 * 6;
    const groupCenters: { col: number; row: number }[] = [];

    for (const tile of tileArr) {
      if (groupCenters.length >= GROUP_COUNT) break;
      if (this.tilemapManager.isWater(tile.col, tile.row)) continue;
      if (this.tilemapManager.isRoad(tile.col, tile.row)) continue;

      // Ensure group center is far enough from roads so cluster won't overlap
      let nearRoad = false;
      for (let dc = -3; dc <= 3 && !nearRoad; dc++) {
        for (let dr = -3; dr <= 3 && !nearRoad; dr++) {
          if (this.tilemapManager.isRoad(tile.col + dc, tile.row + dr)) nearRoad = true;
        }
      }
      if (nearRoad) continue;

      const tooClose = groupCenters.some(
        p => (p.col - tile.col) ** 2 + (p.row - tile.row) ** 2 < GROUP_MIN_DIST_SQ,
      );
      if (tooClose) continue;
      groupCenters.push(tile);
    }

    // Tiles to exclude from mountain peak placement
    const excluded = new Set(['51,43']);

    // For each group center, place a dense cluster of 5–7 peaks on nearby tiles
    const placed = new Set<string>();
    for (const center of groupCenters) {
      const CLUSTER_RADIUS = 2;
      const peaksInCluster = 5 + Math.floor(rand() * 3); // 5–7
      let count = 0;

      // Gather nearby candidate tiles within radius
      const candidates: { col: number; row: number }[] = [];
      for (let dc = -CLUSTER_RADIUS; dc <= CLUSTER_RADIUS; dc++) {
        for (let dr = -CLUSTER_RADIUS; dr <= CLUSTER_RADIUS; dr++) {
          const c = center.col + dc;
          const r = center.row + dr;
          const k = `${c},${r}`;
          if (!tileSet.has(k)) continue;
          if (placed.has(k)) continue;
          if (excluded.has(k)) continue;
          if (this.tilemapManager.isWater(c, r)) continue;
          if (this.tilemapManager.isRoad(c, r)) continue;
          candidates.push({ col: c, row: r });
        }
      }

      // Shuffle candidates and place peaks
      for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      }

      for (const tile of candidates) {
        if (count >= peaksInCluster) break;
        placed.add(`${tile.col},${tile.row}`);
        count++;

        const pos = this.tilemapManager.gridToScreen(tile.col, tile.row);
        const scale = 0.35 + rand() * 0.30; // 0.35–0.65
        const offsetY = -18 - rand() * 14;

        const peak = this.add.image(pos.x + (rand() - 0.5) * 10, pos.y + offsetY, 'tile-mountain-peak');
        peak.setOrigin(0.5, 0.85);
        peak.setScale(scale);
        peak.setDepth(5 + (tile.col + tile.row) * 0.01);
        peak.setAlpha(0.85 + rand() * 0.15);
        this.trackAsset(tile.col, tile.row, 'tile-mountain-peak');
      }
    }
  }

  /**
   * Place lava gradient in DeFi Docks: lava-center on water/stream tiles,
   * then progressively tile-lava → tile-lava-crust → tile-lava-base outward.
   */
  private placeDefiLavaGradient(): void {
    const tiles = this.tilemapManager.getDistrictTiles('defi');
    if (!tiles || tiles.size === 0) return;

    // Collect all water tiles in DeFi as the lava stream core
    const waterSet = new Set<string>();
    const allTiles: { col: number; row: number }[] = [];

    for (const k of tiles) {
      const [c, r] = k.split(',').map(Number);
      allTiles.push({ col: c, row: r });
      if (this.tilemapManager.isWater(c, r)) {
        waterSet.add(k);
      }
    }

    // Calculate minimum distance from each tile to the nearest water tile
    const distMap = new Map<string, number>();
    for (const t of allTiles) {
      const k = `${t.col},${t.row}`;
      if (waterSet.has(k)) {
        distMap.set(k, 0);
        continue;
      }
      let minDist = Infinity;
      for (const wk of waterSet) {
        const [wc, wr] = wk.split(',').map(Number);
        const d = Math.abs(t.col - wc) + Math.abs(t.row - wr); // Manhattan distance
        if (d < minDist) minDist = d;
      }
      distMap.set(k, minDist);
    }

    // Overlay lava tiles based on distance from stream
    for (const t of allTiles) {
      const k = `${t.col},${t.row}`;
      const dist = distMap.get(k) ?? Infinity;

      let texKey: string | null = null;
      if (dist === 0) texKey = 'tile-lava-center';
      else if (dist === 1) texKey = 'tile-lava';
      else if (dist === 2) texKey = 'tile-lava-crust';
      else if (dist <= 4) texKey = 'tile-lava-base';
      // dist > 4 keeps the ark-rock base terrain

      if (!texKey) continue;

      const pos = this.tilemapManager.gridToScreen(t.col, t.row);
      const overlay = this.add.image(pos.x, pos.y, texKey);
      overlay.setOrigin(0.5, 0.5);
      overlay.setScale(0.65);
      overlay.setDepth(0.1); // just above base terrain
      this.trackAsset(t.col, t.row, texKey);
    }
  }

  /** Scatter lamp posts across all districts on non-water, non-road tiles. */
  private scatterLampPosts(): void {
    const rand = seededRng(5555);
    const LAMPS_PER_DISTRICT = 5;
    const MIN_DIST_SQ = 4 * 4; // min 4 tiles apart

    for (const category of BIOME_NAMES) {
      if (category !== 'townsquare') continue; // lamp posts only in Town Square

      const tiles = this.tilemapManager.getDistrictTiles(category);
      if (!tiles || tiles.size === 0) continue;

      const tileArr = Array.from(tiles).map(k => {
        const [c, r] = k.split(',').map(Number);
        return { col: c, row: r };
      });

      // Shuffle deterministically
      for (let i = tileArr.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [tileArr[i], tileArr[j]] = [tileArr[j], tileArr[i]];
      }

      const placed: { col: number; row: number }[] = [];

      for (const tile of tileArr) {
        if (placed.length >= LAMPS_PER_DISTRICT) break;
        if (this.tilemapManager.isWater(tile.col, tile.row)) continue;
        if (this.tilemapManager.isRoad(tile.col, tile.row)) continue;

        const tooClose = placed.some(
          p => (p.col - tile.col) ** 2 + (p.row - tile.row) ** 2 < MIN_DIST_SQ,
        );
        if (tooClose) continue;

        placed.push(tile);

        const pos = this.tilemapManager.gridToScreen(tile.col, tile.row);
        const lamp = this.add.image(pos.x + 10, pos.y - 6, 'deco-lamp-post');
        lamp.setOrigin(0.5, 0.95);
        lamp.setScale(0.4 + rand() * 0.1);
        lamp.setDepth(6 + (tile.col + tile.row) * 0.01);
        this.trackAsset(tile.col, tile.row, 'deco-lamp-post');
      }
    }
  }

  /** Place fishing boats at fixed positions on Translation Ward ocean. */
  private scatterTranslationBoats(): void {
    const boatPositions = [
      { col: 48, row: 14 },
      { col: 48, row: 16 },
    ];
    for (const tile of boatPositions) {
      const pos = this.tilemapManager.gridToScreen(tile.col, tile.row);
      const boat = this.add.image(pos.x, pos.y, 'deco-fishing-boat');
      boat.setOrigin(0.5, 0.7);
      boat.setScale(0.45);
      boat.setDepth(6 + (tile.col + tile.row) * 0.01);
      boat.setAlpha(0.90);
      this.trackAsset(tile.col, tile.row, 'deco-fishing-boat');
    }
  }

  /** Place dense crystal clusters on the edges of Research Fields. */
  private scatterResearchCrystals(): void {
    const rand = seededRng(6283);
    const tiles = this.tilemapManager.getDistrictTiles('research');
    if (!tiles || tiles.size === 0) return;

    const tileSet = new Set(tiles);
    const bounds = this.tilemapManager.getDistrictBounds('research');
    if (!bounds) return;

    // Collect edge tiles: boundary tiles (within 2 tiles of district boundary)
    const edgeTiles: { col: number; row: number }[] = [];
    for (const k of tiles) {
      const [c, r] = k.split(',').map(Number);
      if (this.tilemapManager.isWater(c, r)) continue;
      if (this.tilemapManager.isRoad(c, r)) continue;
      // Near-edge: at least one tile within 2 steps is outside the district
      let nearEdge = false;
      for (let dc = -2; dc <= 2 && !nearEdge; dc++) {
        for (let dr = -2; dr <= 2 && !nearEdge; dr++) {
          if (!tileSet.has(`${c + dc},${r + dr}`)) nearEdge = true;
        }
      }
      if (nearEdge) edgeTiles.push({ col: c, row: r });
    }

    // Sort then shuffle
    edgeTiles.sort((a, b) => a.col - b.col || a.row - b.row);
    for (let i = edgeTiles.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [edgeTiles[i], edgeTiles[j]] = [edgeTiles[j], edgeTiles[i]];
    }

    // Pick 6 group centers along the edges, well-spaced
    const GROUP_COUNT = 6;
    const GROUP_MIN_DIST_SQ = 4 * 4;
    const groupCenters: { col: number; row: number }[] = [];

    for (const tile of edgeTiles) {
      if (groupCenters.length >= GROUP_COUNT) break;

      let nearRoad = false;
      for (let dc = -2; dc <= 2 && !nearRoad; dc++) {
        for (let dr = -2; dr <= 2 && !nearRoad; dr++) {
          if (this.tilemapManager.isRoad(tile.col + dc, tile.row + dr)) nearRoad = true;
        }
      }
      if (nearRoad) continue;

      const tooClose = groupCenters.some(
        p => (p.col - tile.col) ** 2 + (p.row - tile.row) ** 2 < GROUP_MIN_DIST_SQ,
      );
      if (tooClose) continue;
      groupCenters.push(tile);
    }

    // Fill each group with 8–12 crystals within 3-tile radius
    const placed = new Set<string>();
    for (const center of groupCenters) {
      const CLUSTER_RADIUS = 3;
      const crystalsInCluster = 8 + Math.floor(rand() * 5);
      let count = 0;

      const candidates: { col: number; row: number }[] = [];
      for (let dc = -CLUSTER_RADIUS; dc <= CLUSTER_RADIUS; dc++) {
        for (let dr = -CLUSTER_RADIUS; dr <= CLUSTER_RADIUS; dr++) {
          const c = center.col + dc;
          const r = center.row + dr;
          const k = `${c},${r}`;
          if (!tileSet.has(k) || placed.has(k)) continue;
          if (this.tilemapManager.isWater(c, r)) continue;
          if (this.tilemapManager.isRoad(c, r)) continue;
          candidates.push({ col: c, row: r });
        }
      }

      for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      }

      for (const tile of candidates) {
        if (count >= crystalsInCluster) break;
        placed.add(`${tile.col},${tile.row}`);
        count++;

        const pos = this.tilemapManager.gridToScreen(tile.col, tile.row);
        const crystal = this.add.image(pos.x + (rand() - 0.5) * 10, pos.y, 'deco-crystal');
        crystal.setOrigin(0.5, 0.85);
        crystal.setScale(0.40 + rand() * 0.20);
        crystal.setDepth(6.5 + (tile.col + tile.row) * 0.01);
        crystal.setAlpha(0.75 + rand() * 0.25);
        this.trackAsset(tile.col, tile.row, 'deco-crystal');
      }
    }
  }

  /** Place dense blossom tree clusters across the Creative Quarter. */
  private scatterBlossomTrees(): void {
    const rand = seededRng(3141);
    const tiles = this.tilemapManager.getDistrictTiles('creative');
    if (!tiles || tiles.size === 0) return;

    const tileSet = new Set(tiles);

    // Collect top-edge tiles: boundary tiles in the upper half of the district
    const creativeBounds = this.tilemapManager.getDistrictBounds('creative');
    const topEdgeTiles: { col: number; row: number }[] = [];
    const midRow = creativeBounds ? creativeBounds.centerRow : 28;

    for (const k of tiles) {
      const [c, r] = k.split(',').map(Number);
      if (r > midRow) continue; // only top half
      if (this.tilemapManager.isWater(c, r)) continue;
      if (this.tilemapManager.isRoad(c, r)) continue;
      // Edge: at least one cardinal neighbor is outside the district
      const isEdge =
        !tileSet.has(`${c - 1},${r}`) || !tileSet.has(`${c + 1},${r}`) ||
        !tileSet.has(`${c},${r - 1}`) || !tileSet.has(`${c},${r + 1}`);
      if (isEdge) topEdgeTiles.push({ col: c, row: r });
    }

    // Sort then shuffle
    topEdgeTiles.sort((a, b) => a.col - b.col || a.row - b.row);
    for (let i = topEdgeTiles.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [topEdgeTiles[i], topEdgeTiles[j]] = [topEdgeTiles[j], topEdgeTiles[i]];
    }

    // Pick 5 group centers along the top edge
    const GROUP_COUNT = 5;
    const GROUP_MIN_DIST_SQ = 3 * 3;
    const groupCenters: { col: number; row: number }[] = [];

    for (const tile of topEdgeTiles) {
      if (groupCenters.length >= GROUP_COUNT) break;

      let nearRoad = false;
      for (let dc = -2; dc <= 2 && !nearRoad; dc++) {
        for (let dr = -2; dr <= 2 && !nearRoad; dr++) {
          if (this.tilemapManager.isRoad(tile.col + dc, tile.row + dr)) nearRoad = true;
        }
      }
      if (nearRoad) continue;

      const tooClose = groupCenters.some(
        p => (p.col - tile.col) ** 2 + (p.row - tile.row) ** 2 < GROUP_MIN_DIST_SQ,
      );
      if (tooClose) continue;
      groupCenters.push(tile);
    }

    // Fill each group with 6–10 blossom trees within 3-tile radius
    const placed = new Set<string>();
    for (const center of groupCenters) {
      const CLUSTER_RADIUS = 3;
      const treesInCluster = 6 + Math.floor(rand() * 5);
      let count = 0;

      const candidates: { col: number; row: number }[] = [];
      for (let dc = -CLUSTER_RADIUS; dc <= CLUSTER_RADIUS; dc++) {
        for (let dr = -CLUSTER_RADIUS; dr <= CLUSTER_RADIUS; dr++) {
          const c = center.col + dc;
          const r = center.row + dr;
          const k = `${c},${r}`;
          if (!tileSet.has(k) || placed.has(k)) continue;
          if (this.tilemapManager.isWater(c, r)) continue;
          if (this.tilemapManager.isRoad(c, r)) continue;
          candidates.push({ col: c, row: r });
        }
      }

      for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      }

      for (const tile of candidates) {
        if (count >= treesInCluster) break;
        placed.add(`${tile.col},${tile.row}`);
        count++;

        const pos = this.tilemapManager.gridToScreen(tile.col, tile.row);
        const jitterX = (rand() - 0.5) * 16;
        const jitterY = (rand() - 0.5) * 8;
        const tree = this.add.image(pos.x + jitterX, pos.y + jitterY, 'deco-blossom-tree');
        tree.setOrigin(0.5, 0.85);
        tree.setScale(0.30 + rand() * 0.20);
        tree.setDepth(6.5 + (tile.col + tile.row) * 0.01);
        tree.setAlpha(0.80 + rand() * 0.20);
        this.trackAsset(tile.col, tile.row, 'deco-blossom-tree');
      }
    }

    // 4 circular flower patches in the Creative Quarter
    const bounds = this.tilemapManager.getDistrictBounds('creative');
    if (!bounds) return;
    const cx = bounds.centerCol;
    const cy = bounds.centerRow;

    // Pick 4 flower patch centers spread around the district center
    const flowerCenters = [
      { col: cx - 4, row: cy - 3 },
      { col: cx + 4, row: cy - 3 },
      { col: cx - 4, row: cy + 3 },
      { col: cx + 4, row: cy + 3 },
    ];

    // 3x3 diamond pattern offsets (9 tiles): center + 4 cardinal + 4 diagonal
    const diamondOffsets = [
      { dc: 0, dr: 0 },
      { dc: -1, dr: 0 }, { dc: 1, dr: 0 }, { dc: 0, dr: -1 }, { dc: 0, dr: 1 },
      { dc: -1, dr: -1 }, { dc: 1, dr: -1 }, { dc: -1, dr: 1 }, { dc: 1, dr: 1 },
    ];

    for (const fc of flowerCenters) {
      for (const off of diamondOffsets) {
          const c = Math.round(fc.col) + off.dc;
          const r = Math.round(fc.row) + off.dr;
          const k = `${c},${r}`;
          if (!tileSet.has(k)) continue;
          if (this.tilemapManager.isWater(c, r)) continue;
          if (this.tilemapManager.isRoad(c, r)) continue;

          const pos = this.tilemapManager.gridToScreen(c, r);
          const flower = this.add.image(pos.x, pos.y, 'tile-meadow-flowers');
          flower.setOrigin(0.5, 0.5);
          flower.setScale(0.85 + rand() * 0.15);
          flower.setDepth(0.5 + (c + r) * 0.001);
          flower.setAlpha(0.85 + rand() * 0.15);
          this.trackAsset(c, r, 'tile-meadow-flowers');
      }
    }

    // Cover all water tiles in Creative Quarter with pond sprites
    const pondKeys = ['deco-pond-center', 'deco-pond-left', 'deco-pond-right'];
    for (const k of tiles) {
      const [c, r] = k.split(',').map(Number);
      if (!this.tilemapManager.isWater(c, r)) continue;

      const pos = this.tilemapManager.gridToScreen(c, r);
      const key = pondKeys[(c + r) % pondKeys.length];
      const pond = this.add.image(pos.x, pos.y, key);
      pond.setOrigin(0.5, 0.5);
      pond.setScale(0.65);
      pond.setDepth(0.5 + (c + r) * 0.001);
      this.trackAsset(c, r, key);
    }
  }

  /** Trigger spawn animation for a newly assigned guild hall. */
  onPlotAssigned(guildId: number): void {
    this.guildHallManager?.animateSpawn(guildId);
  }

  /** Trigger departure animation for a released guild hall. */
  onPlotReleased(guildId: number): void {
    this.guildHallManager?.animateDeparture(guildId);
  }

  /** Enable/disable building hover + click interactivity (district view only). */
  setBuildingsInteractive(enabled: boolean): void {
    // Guild halls are the main interactive buildings
    this.guildHallManager?.setInteractive(enabled);
  }

  /** Public method for React UI to trigger return to world view. */
  exitToOverview(): void {
    this.cinematicIntro?.exitToOverview();
  }

  updateWorldState(worldState: WorldState): void {
    if (!worldState) {
      console.warn('[WorldScene] updateWorldState called with null worldState');
      return;
    }
    // Guard: managers aren't ready until create() completes
    if (!this.guildHallManager || !this.buildingManager) {
      console.warn('[WorldScene] updateWorldState skipped — managers not ready',
        { guildHallMgr: !!this.guildHallManager, buildingMgr: !!this.buildingManager });
      return;
    }
    // console.log('[WorldScene] updateWorldState', { guilds: worldState.guilds.length, agents: worldState.agents.length });
    // Place/update guild hall buildings (1 per guild)
    this.guildHallManager.updateGuildHalls(worldState.guilds);
    // Place/update per-agent buildings (tier-based)
    this.buildingManager.updateBuildings(worldState.guilds, worldState.agents);
  }

  shutdown(): void {
    this.cinematicIntro?.destroy();
    this.cameraController?.destroy();
    this.tilemapManager?.destroy();
    this.buildingManager?.destroy();
    this.guildHallManager?.destroy();
    this.particleManager?.destroy();
    this.minimapManager?.destroy();
    this.treeManager?.destroy();
  }
}
