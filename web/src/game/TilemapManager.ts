import * as Phaser from 'phaser';
import { seededRng, ValueNoise2D } from './noise';
import { shouldBeWater } from './BiomeConfig';

/* ── District definition with Voronoi seed + noise shaping ─────────── */

interface DistrictDef {
  name: string;
  category: string;
  label: string;
  color: number;
  /** Voronoi seed position (grid coordinates). */
  seedCol: number;
  seedRow: number;
  /** Boundary jaggedness — higher = more irregular edges. */
  noiseAmplitude: number;
  /** Noise spatial frequency — higher = finer detail. */
  noiseFrequency: number;
  /** Shape roundness — 0 = fully noise-driven, 1 = perfectly circular. */
  radialBias: number;
  /** Distance multiplier — lower = bigger territory (default 1.0). */
  sizeWeight: number;
}

export interface DistrictBounds {
  minCol: number; maxCol: number;
  minRow: number; maxRow: number;
  centerCol: number; centerRow: number;
  tileCount: number;
}

export const TILE_WIDTH = 64;
export const TILE_HEIGHT = 32;
const ROAD_COLOR = 0x566573;

/** Voronoi gap threshold — controls road width between districts. */
const ROAD_THRESHOLD = 1.0;

const ALL_DISTRICTS: DistrictDef[] = [
  // Hub — Town Square at dead center, sizeWeight < 1 = claims more territory
  { name: 'Town Square',       category: 'townsquare',  label: '\u{1F4CB} Town Square',       color: 0xc2b69a, seedCol: 28, seedRow: 28, noiseAmplitude: 2.5, noiseFrequency: 0.55, radialBias: 0.7, sizeWeight: 0.78 },
  // Ring — 5 districts tighter to center to eliminate dead space
  { name: 'Creative Quarter',  category: 'creative',    label: '\u{1F3A8} Creative Quarter',  color: 0x6db86b, seedCol: 19, seedRow: 19, noiseAmplitude: 3.5, noiseFrequency: 0.60, radialBias: 0.45, sizeWeight: 1.0 },
  { name: 'Translation Ward',  category: 'translation', label: '\u{1F310} Translation Ward',  color: 0x5ba8c8, seedCol: 34, seedRow: 17, noiseAmplitude: 3.2, noiseFrequency: 0.65, radialBias: 0.25, sizeWeight: 1.0 },
  { name: 'Code Heights',      category: 'code',        label: '\u{1F9E0} Code Heights',      color: 0x8fa8b8, seedCol: 40, seedRow: 30, noiseAmplitude: 3.0, noiseFrequency: 0.55, radialBias: 0.55, sizeWeight: 1.0 },
  { name: 'Research Fields',   category: 'research',    label: '\u{1F52C} Research Fields',   color: 0x7b68ae, seedCol: 30, seedRow: 40, noiseAmplitude: 3.8, noiseFrequency: 0.60, radialBias: 0.35, sizeWeight: 1.0 },
  { name: 'DeFi Docks',        category: 'defi',        label: '\u{1F4B0} DeFi Docks',        color: 0xc4713b, seedCol: 17, seedRow: 34, noiseAmplitude: 4.5, noiseFrequency: 0.70, radialBias: 0.15, sizeWeight: 1.0 },
];

export const GRID_COLS = 56;
export const GRID_ROWS = 56;

/** All district category names in order. */
export const BIOME_NAMES = ALL_DISTRICTS.map(d => d.category);

export class TilemapManager {
  private graphics: Phaser.GameObjects.Graphics;
  private hoverGraphics: Phaser.GameObjects.Graphics;
  private cursorGraphics: Phaser.GameObjects.Graphics;
  private gridOverlay: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Container[] = [];
  private hoveredDistrict: DistrictDef | null = null;
  private highlightedCell: { col: number; row: number } | null = null;
  private gridVisible = false;
  private hoverEnabled = true;
  private offsetX: number;
  private offsetY: number;
  public worldWidth: number;
  public worldHeight: number;
  public townSquareCenterScreen: { x: number; y: number };

  /** Per-district set of "col,row" keys defining the organic shape. */
  private districtTiles: Map<string, Set<string>> = new Map();
  /** Reverse lookup: "col,row" → DistrictDef for fast hover/click. */
  private tileLookup: Map<string, DistrictDef> = new Map();
  /** Road tiles — the natural gap between Voronoi cells. */
  private roadTiles: Set<string> = new Set();
  /** Computed bounding box + centroid per district. */
  private districtBounds: Map<string, DistrictBounds> = new Map();
  /** Tiles occupied by buildings (for footprint system). */
  private occupiedTiles: Map<string, { owner: string; tier: string }> = new Map();
  /** Organic world boundary mask — only tiles inside are rendered. */
  private worldMask: Set<string> = new Set();

  constructor(private scene: Phaser.Scene) {
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(1);
    this.hoverGraphics = scene.add.graphics();
    this.hoverGraphics.setDepth(5);

    // Cursor tile highlight (depth 4)
    this.cursorGraphics = scene.add.graphics();
    this.cursorGraphics.setDepth(4);

    // Grid overlay – pre-rendered, hidden by default (depth 3)
    this.gridOverlay = scene.add.graphics();
    this.gridOverlay.setDepth(3);
    this.gridOverlay.setVisible(false);

    this.offsetX = (GRID_COLS * TILE_WIDTH) / 2 + 100;
    this.offsetY = 100;

    this.worldWidth = GRID_COLS * TILE_WIDTH;
    this.worldHeight = GRID_ROWS * TILE_HEIGHT;

    // Generate organic world boundary, then Voronoi districts
    this.generateWorldMask();
    this.generateDistrictShapes();

    // Compute town square center from bounds
    const tsBounds = this.districtBounds.get('townsquare');
    if (tsBounds) {
      this.townSquareCenterScreen = this.gridToScreen(tsBounds.centerCol, tsBounds.centerRow);
    } else {
      this.townSquareCenterScreen = this.getWorldCenter();
    }

    this.render();
    this.drawGridLines();
    this.setupPointerTracking();
    this.setupGridToggle();
  }

  /* ── Coordinate helpers ──────────────────────────────────────────── */

  public gridToScreen(col: number, row: number): { x: number; y: number } {
    return {
      x: (col - row) * (TILE_WIDTH / 2) + this.offsetX,
      y: (col + row) * (TILE_HEIGHT / 2) + this.offsetY,
    };
  }

  /** Convert a world-space point to the grid cell it falls within. */
  public screenToGrid(worldX: number, worldY: number): { col: number; row: number } | null {
    const relX = worldX - this.offsetX;
    const relY = worldY - this.offsetY;

    const a = relX / (TILE_WIDTH / 2);
    const b = relY / (TILE_HEIGHT / 2);

    const colF = (a + b) / 2;
    const rowF = (b - a) / 2;

    const baseCol = Math.floor(colF);
    const baseRow = Math.floor(rowF);

    for (const [dc, dr] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const c = baseCol + dc;
      const r = baseRow + dr;
      if (c < 0 || r < 0 || c >= GRID_COLS || r >= GRID_ROWS) continue;
      if (this.isPointInTile(worldX, worldY, c, r)) {
        return { col: c, row: r };
      }
    }
    return null;
  }

  private isPointInTile(px: number, py: number, col: number, row: number): boolean {
    const { x, y } = this.gridToScreen(col, row);
    return Math.abs(px - x) / (TILE_WIDTH / 2) + Math.abs(py - y) / (TILE_HEIGHT / 2) <= 1;
  }

  /* ── Organic world boundary mask ────────────────────────────────────── */

  private generateWorldMask(): void {
    const cx = GRID_COLS / 2;
    const cy = GRID_ROWS / 2;
    const boundaryNoise = new ValueNoise2D(24, 5555);
    const boundaryNoise2 = new ValueNoise2D(32, 6666);
    const boundaryNoise3 = new ValueNoise2D(48, 7777); // fine detail for petals

    // Screen-space aligned coordinates (isometric axes)
    const screenCenterX = cx - cy;
    const screenCenterY = cx + cy;
    // Shrink radii so the organic edge never hits the grid boundary
    const rx = (GRID_COLS + GRID_ROWS) * 0.38;
    const ry = (GRID_COLS + GRID_ROWS) * 0.36;

    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const sx = (col - row) - screenCenterX;
        const sy = (col + row) - screenCenterY;
        const nx = sx / rx;
        const ny = sy / ry;

        // Ellipse base distance
        const dist = nx * nx + ny * ny;

        // Three-octave noise for organic petal-like edges
        const n1 = boundaryNoise.sample(col * 0.18 + 50, row * 0.18 + 50);
        const n2 = boundaryNoise2.sample(col * 0.4 + 70, row * 0.4 + 70);
        const n3 = boundaryNoise3.sample(col * 0.8 + 30, row * 0.8 + 30);
        const n = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;
        // Stronger noise modulation = more petal-like protrusions
        const threshold = 1.0 + (n - 0.5) * 0.8;

        if (dist < threshold) {
          this.worldMask.add(`${col},${row}`);
        }
      }
    }
    console.log(`[TilemapManager] world mask: ${this.worldMask.size} tiles`);
  }

  /* ── Voronoi + Noise district generation ───────────────────────────── */

  private generateDistrictShapes(): void {
    const rand = seededRng(7331);
    const noise = new ValueNoise2D(32, 7331);
    const noise2 = new ValueNoise2D(48, 4242);   // higher-frequency detail octave
    const roadNoise = new ValueNoise2D(24, 9999);
    const roadNoise2 = new ValueNoise2D(36, 8888); // road detail octave

    // Pre-generate per-district noise offsets for unique boundary shapes
    const noiseOffsets = new Map<string, { ox: number; oy: number }>();
    for (const d of ALL_DISTRICTS) {
      noiseOffsets.set(d.category, { ox: rand() * 100, oy: rand() * 100 });
    }

    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        // Skip tiles outside the organic world boundary
        if (!this.worldMask.has(`${col},${row}`)) continue;
        // Compute noise-displaced distance to each seed
        const distances: { dist: number; district: DistrictDef }[] = [];

        for (const d of ALL_DISTRICTS) {
          const dx = col - d.seedCol;
          const dy = row - d.seedRow;
          let baseDist = Math.sqrt(dx * dx + dy * dy) * d.sizeWeight;

          // Apply per-biome noise displacement for organic edges
          const offset = noiseOffsets.get(d.category)!;
          const nSample = noise.sample(
            col * d.noiseFrequency + offset.ox,
            row * d.noiseFrequency + offset.oy,
          );
          // Second octave at higher frequency for fine edge detail
          const nDetail = noise2.sample(
            col * d.noiseFrequency * 2.5 + offset.ox + 50,
            row * d.noiseFrequency * 2.5 + offset.oy + 50,
          );
          const combined = nSample * 0.65 + nDetail * 0.35;
          const noiseTerm = (combined - 0.5) * d.noiseAmplitude * (1 - d.radialBias * 0.3);
          baseDist += noiseTerm;

          distances.push({ dist: baseDist, district: d });
        }

        // Sort by displaced distance
        distances.sort((a, b) => a.dist - b.dist);
        const gap = distances[1].dist - distances[0].dist;

        // Road determination: small gap = contested zone = natural road
        const rn1 = roadNoise.sample(col * 0.3 + 50, row * 0.3 + 50);
        const rn2 = roadNoise2.sample(col * 0.7 + 80, row * 0.7 + 80);
        const rn = rn1 * 0.6 + rn2 * 0.4;
        const effectiveThreshold = ROAD_THRESHOLD + (rn - 0.5) * 0.4;

        const key = `${col},${row}`;

        if (gap < effectiveThreshold) {
          this.roadTiles.add(key);
        } else {
          const closest = distances[0].district;
          const tiles = this.districtTiles.get(closest.category) ?? new Set<string>();
          tiles.add(key);
          this.districtTiles.set(closest.category, tiles);
          this.tileLookup.set(key, closest);
        }
      }
    }

    this.computeDistrictBounds();

    // Log tile counts
    for (const d of ALL_DISTRICTS) {
      const bounds = this.districtBounds.get(d.category);
      console.log(`[TilemapManager] ${d.category}: ${bounds?.tileCount ?? 0} tiles`);
    }
    console.log(`[TilemapManager] roads: ${this.roadTiles.size} tiles`);
  }

  /** Compute bounding box + centroid for each district from actual tile set. */
  private computeDistrictBounds(): void {
    for (const district of ALL_DISTRICTS) {
      const tiles = this.districtTiles.get(district.category);
      if (!tiles || tiles.size === 0) continue;

      let minCol = GRID_COLS, maxCol = 0, minRow = GRID_ROWS, maxRow = 0;
      let sumCol = 0, sumRow = 0;

      tiles.forEach(key => {
        const [c, r] = key.split(',').map(Number);
        minCol = Math.min(minCol, c);
        maxCol = Math.max(maxCol, c);
        minRow = Math.min(minRow, r);
        maxRow = Math.max(maxRow, r);
        sumCol += c;
        sumRow += r;
      });

      this.districtBounds.set(district.category, {
        minCol, maxCol, minRow, maxRow,
        centerCol: sumCol / tiles.size,
        centerRow: sumRow / tiles.size,
        tileCount: tiles.size,
      });
    }
  }

  /* ── Drawing helpers ─────────────────────────────────────────────── */

  private drawTileFill(gfx: Phaser.GameObjects.Graphics, col: number, row: number, color: number, alpha: number): void {
    const { x, y } = this.gridToScreen(col, row);
    const hw = TILE_WIDTH / 2;
    const hh = TILE_HEIGHT / 2;

    gfx.fillStyle(color, alpha);
    gfx.beginPath();
    gfx.moveTo(x, y - hh);
    gfx.lineTo(x + hw, y);
    gfx.lineTo(x, y + hh);
    gfx.lineTo(x - hw, y);
    gfx.closePath();
    gfx.fillPath();
  }

  private drawDiamondStroke(gfx: Phaser.GameObjects.Graphics, col: number, row: number): void {
    const { x, y } = this.gridToScreen(col, row);
    const hw = TILE_WIDTH / 2;
    const hh = TILE_HEIGHT / 2;

    gfx.beginPath();
    gfx.moveTo(x, y - hh);
    gfx.lineTo(x + hw, y);
    gfx.lineTo(x, y + hh);
    gfx.lineTo(x - hw, y);
    gfx.closePath();
    gfx.strokePath();
  }

  private lighten(color: number, amount: number): number {
    const r = Math.min(255, ((color >> 16) & 0xff) + amount);
    const g = Math.min(255, ((color >> 8) & 0xff) + amount);
    const b = Math.min(255, (color & 0xff) + amount);
    return (r << 16) | (g << 8) | b;
  }

  public isRoad(col: number, row: number): boolean {
    if (col < 0 || row < 0 || col >= GRID_COLS || row >= GRID_ROWS) return false;
    return this.roadTiles.has(`${col},${row}`);
  }

  /** Check if a tile is within the organic world boundary. */
  public isInWorld(col: number, row: number): boolean {
    return this.worldMask.has(`${col},${row}`);
  }

  /** Get the biome category for a cell (district category or null for roads/edges). */
  public getDistrictBiome(col: number, row: number): string | null {
    return this.tileLookup.get(`${col},${row}`)?.category ?? null;
  }

  /** Check if a tile should be water based on its biome and position. */
  public isWater(col: number, row: number): boolean {
    const district = this.tileLookup.get(`${col},${row}`);
    if (!district) return false;
    const bounds = this.districtBounds.get(district.category);
    if (!bounds) return false;
    return shouldBeWater(
      col, row, district.category,
      bounds.centerCol, bounds.centerRow,
      Math.max(1, (bounds.maxCol - bounds.minCol) / 2),
      Math.max(1, (bounds.maxRow - bounds.minRow) / 2),
    );
  }

  /* ── Tile occupation (building footprints) ─────────────────────────── */

  private decorationTiles: Set<string> = new Set();

  public markDecoration(col: number, row: number): void {
    this.decorationTiles.add(`${Math.round(col)},${Math.round(row)}`);
  }

  public hasDecoration(col: number, row: number): boolean {
    return this.decorationTiles.has(`${col},${row}`);
  }

  public occupyTile(col: number, row: number, owner: string, tier: string): boolean {
    const key = `${col},${row}`;
    if (this.occupiedTiles.has(key)) return false;
    if (this.roadTiles.has(key)) return false;
    if (!this.tileLookup.has(key)) return false;
    this.occupiedTiles.set(key, { owner, tier });
    return true;
  }

  public isOccupied(col: number, row: number): boolean {
    const key = `${col},${row}`;
    return this.occupiedTiles.has(key) || this.decorationTiles.has(key);
  }

  public clearOccupation(col: number, row: number): void {
    this.occupiedTiles.delete(`${col},${row}`);
  }

  /* ── Cursor tile highlight ───────────────────────────────────────── */

  private drawCursorHighlight(col: number, row: number): void {
    this.cursorGraphics.clear();
    const { x, y } = this.gridToScreen(col, row);
    const hw = TILE_WIDTH / 2;
    const hh = TILE_HEIGHT / 2;

    this.cursorGraphics.lineStyle(1.5, 0xffffff, 0.5);
    this.drawDiamondStroke(this.cursorGraphics, col, row);

    this.cursorGraphics.fillStyle(0xffffff, 0.08);
    this.cursorGraphics.beginPath();
    this.cursorGraphics.moveTo(x, y - hh);
    this.cursorGraphics.lineTo(x + hw, y);
    this.cursorGraphics.lineTo(x, y + hh);
    this.cursorGraphics.lineTo(x - hw, y);
    this.cursorGraphics.closePath();
    this.cursorGraphics.fillPath();
  }

  /* ── Grid overlay (toggle with G key) ────────────────────────────── */

  private drawGridLines(): void {
    this.gridOverlay.lineStyle(0.5, 0xffffff, 0.12);
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        if (!this.worldMask.has(`${col},${row}`)) continue;
        this.drawDiamondStroke(this.gridOverlay, col, row);
      }
    }
  }

  private setupGridToggle(): void {
    if (!this.scene.input.keyboard) return;
    this.scene.input.keyboard.on('keydown-G', () => {
      this.gridVisible = !this.gridVisible;
      this.gridOverlay.setVisible(this.gridVisible);
    });
  }

  /* ── Pointer tracking ────────────────────────────────────────────── */

  private setupPointerTracking(): void {
    this.scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      const cell = this.screenToGrid(pointer.worldX, pointer.worldY);

      // Cursor highlight always active (individual tile)
      if (cell && (cell.col !== this.highlightedCell?.col || cell.row !== this.highlightedCell?.row)) {
        this.highlightedCell = cell;
        this.drawCursorHighlight(cell.col, cell.row);
      } else if (!cell && this.highlightedCell) {
        this.highlightedCell = null;
        this.cursorGraphics.clear();
      }

      // District hover overlay only in overview mode
      if (!this.hoverEnabled) return;

      let found: DistrictDef | null = null;
      if (cell) {
        found = this.tileLookup.get(`${cell.col},${cell.row}`) ?? null;
      }

      if (found !== this.hoveredDistrict) {
        this.hoveredDistrict = found;
        this.drawHoverOverlay();
        this.scene.game.canvas.style.cursor = found ? 'pointer' : 'default';
      }
    });

    this.scene.input.on('pointerup', (pointer: Phaser.Input.Pointer) => {
      const dist = Phaser.Math.Distance.Between(
        pointer.downX, pointer.downY, pointer.upX, pointer.upY,
      );
      if (dist > 8) return;

      const hits = this.scene.input.hitTestPointer(pointer);
      if (hits.length > 0) return;

      const cell = this.screenToGrid(pointer.worldX, pointer.worldY);
      if (!cell) return;

      // Block clicks on decoration tiles (mountains, lava, trees, ponds, etc.)
      if (this.decorationTiles.has(`${cell.col},${cell.row}`)) return;

      const district = this.tileLookup.get(`${cell.col},${cell.row}`);
      if (district) this.onDistrictClick(district);
    });
  }

  /* ── Hover overlay ───────────────────────────────────────────────── */

  private drawHoverOverlay(): void {
    this.hoverGraphics.clear();
    if (!this.hoveredDistrict) return;

    const d = this.hoveredDistrict;
    const tiles = this.districtTiles.get(d.category);
    if (!tiles) return;

    const brightColor = this.lighten(d.color, 35);

    tiles.forEach((key) => {
      const [col, row] = key.split(',').map(Number);
      this.drawTileFill(this.hoverGraphics, col, row, brightColor, 0.3);
    });
  }

  /* ── Click handling ──────────────────────────────────────────────── */

  private onDistrictClick(district: DistrictDef): void {
    console.log('Clicked district:', district.name);

    this.scene.game.events.emit('district-clicked', {
      name: district.name,
      category: district.category,
    });

    this.flashDistrict(district);
  }

  private flashDistrict(district: DistrictDef): void {
    const tiles = this.districtTiles.get(district.category);
    if (!tiles) return;

    const flashGfx = this.scene.add.graphics();
    flashGfx.setDepth(6);

    tiles.forEach((key) => {
      const [col, row] = key.split(',').map(Number);
      this.drawTileFill(flashGfx, col, row, 0xffffff, 1);
    });

    flashGfx.setAlpha(0.5);
    this.scene.tweens.add({
      targets: flashGfx,
      alpha: 0,
      duration: 300,
      ease: 'Cubic.easeOut',
      onComplete: () => flashGfx.destroy(),
    });
  }

  /* ── Main render ─────────────────────────────────────────────────── */

  private render(): void {
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        if (!this.worldMask.has(`${col},${row}`)) continue;

        const key = `${col},${row}`;
        const district = this.tileLookup.get(key);

        if (district) {
          this.drawTileFill(this.graphics, col, row, district.color, 0.35);
        } else if (this.roadTiles.has(key)) {
          this.drawTileFill(this.graphics, col, row, ROAD_COLOR, 0.25);
        }
      }
    }

    for (const district of ALL_DISTRICTS) {
      this.addLabel(district);
    }
  }

  /* ── Styled label badges ─────────────────────────────────────────── */

  private addLabel(district: DistrictDef): void {
    const bounds = this.districtBounds.get(district.category);
    if (!bounds) return;
    const { x, y } = this.gridToScreen(bounds.centerCol, bounds.centerRow);

    const labelText = district.name;

    const text = this.scene.add.text(0, 0, labelText, {
      fontSize: '13px',
      color: '#e0e0e0',
      fontFamily: '"Cinzel", serif',
    });
    text.setOrigin(0, 0.5);

    const paddingX = 8;
    const paddingY = 5;
    const dotRadius = 4;
    const dotGap = 6;
    const totalWidth = text.width + paddingX * 2 + dotRadius * 2 + dotGap;
    const totalHeight = text.height + paddingY * 2;

    const bg = this.scene.add.graphics();
    bg.fillStyle(0x000000, 0.65);
    bg.fillRoundedRect(-totalWidth / 2, -totalHeight / 2, totalWidth, totalHeight, 6);
    bg.lineStyle(1, 0xffffff, 0.15);
    bg.strokeRoundedRect(-totalWidth / 2, -totalHeight / 2, totalWidth, totalHeight, 6);

    const dot = this.scene.add.graphics();
    dot.fillStyle(district.color, 1);
    dot.fillCircle(-totalWidth / 2 + paddingX + dotRadius, 0, dotRadius);

    text.setX(-totalWidth / 2 + paddingX + dotRadius * 2 + dotGap);

    const container = this.scene.add.container(x, y, [bg, dot, text]);
    container.setDepth(10);
    container.setAlpha(0);

    this.scene.tweens.add({
      targets: container,
      alpha: 1,
      duration: 600,
      delay: 200,
      ease: 'Cubic.easeOut',
    });

    this.labels.push(container);
  }

  /* ── Public API ──────────────────────────────────────────────────── */

  getWorldCenter(): { x: number; y: number } {
    return this.gridToScreen(GRID_COLS / 2, GRID_ROWS / 2);
  }

  getDistrictBounds(category: string): DistrictBounds | undefined {
    return this.districtBounds.get(category);
  }

  getDistrictCenter(category: string): { x: number; y: number } | null {
    const bounds = this.districtBounds.get(category);
    if (!bounds) return null;
    return this.gridToScreen(bounds.centerCol, bounds.centerRow);
  }

  getDistrictTiles(category: string): Set<string> | undefined {
    return this.districtTiles.get(category);
  }

  getTileDistrict(col: number, row: number): string | undefined {
    return this.tileLookup.get(`${col},${row}`)?.category;
  }

  setHoverEnabled(enabled: boolean): void {
    this.hoverEnabled = enabled;
    if (!enabled) {
      this.hoveredDistrict = null;
      this.highlightedCell = null;
      this.hoverGraphics.clear();
      this.cursorGraphics.clear();
      this.scene.game.canvas.style.cursor = 'default';
    }
  }

  setLabelsVisible(visible: boolean, duration = 400): void {
    for (const label of this.labels) {
      this.scene.tweens.killTweensOf(label);
      this.scene.tweens.add({
        targets: label,
        alpha: visible ? 1 : 0,
        duration,
        ease: 'Cubic.easeOut',
      });
    }
  }

  setLabelsAlpha(alpha: number): void {
    for (const label of this.labels) {
      this.scene.tweens.killTweensOf(label);
      label.setAlpha(alpha);
    }
  }

  setLabelsScale(scale: number, duration = 400): void {
    for (const label of this.labels) {
      this.scene.tweens.add({
        targets: label,
        scaleX: scale,
        scaleY: scale,
        duration,
        ease: 'Cubic.easeOut',
      });
    }
  }

  fadeInLabelsStaggered(duration = 400, startDelay = 0): void {
    this.labels.forEach((label, i) => {
      label.setAlpha(0);
      this.scene.tweens.add({
        targets: label,
        alpha: 1,
        duration,
        delay: startDelay + i * 100,
        ease: 'Cubic.easeOut',
      });
    });
  }

  destroy(): void {
    this.graphics.destroy();
    this.hoverGraphics.destroy();
    this.cursorGraphics.destroy();
    this.gridOverlay.destroy();
    for (const label of this.labels) label.destroy(true);
    this.labels = [];
    if (this.scene.input.keyboard) {
      this.scene.input.keyboard.off('keydown-G');
    }
    this.scene.game.canvas.style.cursor = 'default';
  }
}
