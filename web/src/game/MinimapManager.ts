import * as Phaser from 'phaser';
import { TilemapManager, TILE_WIDTH, TILE_HEIGHT, GRID_COLS, GRID_ROWS } from './TilemapManager';

/** District category → CSS color string for the minimap. */
const DISTRICT_COLORS: Record<string, string> = {
  creative:    '#7dd87a',
  townsquare:  '#d4c498',
  translation: '#5bbce8',
  defi:        '#d86840',
  research:    '#9b7dcc',
  code:        '#a8bcc8',
};

const ROAD_COLOR = '#3a4a3a';
const GRASS_COLOR = '#5a9a3a';

/**
 * DOM-based minimap — renders to a fixed-position HTML <canvas> element
 * so it stays static in the corner regardless of Phaser camera movement.
 */
export class MinimapManager {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private bgImageData: ImageData | null = null;

  private readonly CELL = Math.max(2, Math.floor(195 / Math.max(GRID_COLS, GRID_ROWS)));
  private readonly MAP_W = this.CELL * GRID_COLS;
  private readonly MAP_H = this.CELL * GRID_ROWS;
  private readonly PAD = 4; // border padding

  // World-space offsets (must match TilemapManager)
  private readonly worldOffsetX = (GRID_COLS * TILE_WIDTH) / 2 + 100;
  private readonly worldOffsetY = 100;

  /** Screen-space bounds for CameraController exclusion zone. */
  public screenBounds = { x: 0, y: 0, w: 0, h: 0 };

  private updateBound: () => void;

  constructor(
    private scene: Phaser.Scene,
    private tilemapManager: TilemapManager,
    buildingPositions: { gx: number; gy: number }[] = [],
  ) {
    // Create plain HTML canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.MAP_W + this.PAD * 2;
    this.canvas.height = this.MAP_H + this.PAD * 2;
    this.ctx = this.canvas.getContext('2d')!;

    // Style: fixed position, bottom-right, above chat bar
    Object.assign(this.canvas.style, {
      position: 'fixed',
      bottom: '50px',
      right: '10px',
      zIndex: '90',
      borderRadius: '6px',
      border: '2px solid rgba(255, 255, 255, 0.25)',
      boxShadow: '0 2px 12px rgba(0, 0, 0, 0.5)',
      cursor: 'pointer',
      opacity: '0',
      transition: 'opacity 0.3s ease',
      pointerEvents: 'auto',
    });

    document.body.appendChild(this.canvas);

    // Draw the static tile map
    this.drawTileMap(buildingPositions);
    // Save the background so we only redraw viewport rect each frame
    this.bgImageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);

    // Click-to-navigate
    this.canvas.addEventListener('click', this.onClick);
    // Prevent Phaser from getting pointer events on minimap
    this.canvas.addEventListener('pointerdown', (e) => e.stopPropagation());

    // Update screen bounds for CameraController exclusion
    this.updateScreenBounds();

    // Per-frame viewport rect update
    this.updateBound = this.updateViewport.bind(this);
    this.scene.events.on('update', this.updateBound);
  }

  private drawTileMap(buildingPositions: { gx: number; gy: number }[]): void {
    const ctx = this.ctx;
    const pad = this.PAD;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.beginPath();
    ctx.roundRect(0, 0, this.canvas.width, this.canvas.height, 6);
    ctx.fill();

    // District + grass + road tiles
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        if (!this.tilemapManager.isInWorld(col, row)) continue;

        const cat = this.tilemapManager.getTileDistrict(col, row);
        if (cat) {
          ctx.fillStyle = DISTRICT_COLORS[cat] ?? GRASS_COLOR;
        } else if (this.tilemapManager.isRoad(col, row)) {
          ctx.fillStyle = ROAD_COLOR;
        } else {
          ctx.fillStyle = GRASS_COLOR;
        }
        ctx.globalAlpha = 0.85;
        ctx.fillRect(pad + col * this.CELL, pad + row * this.CELL, this.CELL, this.CELL);
      }
    }
    ctx.globalAlpha = 1;

    // Building dots
    ctx.fillStyle = '#ffd700';
    for (const { gx, gy } of buildingPositions) {
      const mx = pad + (gx / GRID_COLS) * this.MAP_W;
      const my = pad + (gy / GRID_ROWS) * this.MAP_H;
      ctx.beginPath();
      ctx.arc(mx, my, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private updateViewport(): void {
    if (!this.bgImageData) return;

    const cam = this.scene.cameras.main;
    const ctx = this.ctx;
    const pad = this.PAD;

    // Restore background (clears old viewport rect)
    ctx.putImageData(this.bgImageData, 0, 0);

    const viewW = cam.width / cam.zoom;
    const viewH = cam.height / cam.zoom;

    const worldW = GRID_COLS * TILE_WIDTH;
    const worldH = GRID_ROWS * TILE_HEIGHT;

    const sx = this.MAP_W / worldW;
    const sy = this.MAP_H / worldH;

    const rx = (cam.scrollX - (this.worldOffsetX - worldW / 2)) * sx;
    const ry = (cam.scrollY - this.worldOffsetY) * sy;
    const rw = viewW * sx;
    const rh = viewH * sy;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      pad + Math.max(0, rx),
      pad + Math.max(0, ry),
      Math.min(rw, this.MAP_W),
      Math.min(rh, this.MAP_H),
    );
  }

  private onClick = (e: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const localX = e.clientX - rect.left - this.PAD;
    const localY = e.clientY - rect.top - this.PAD;

    const worldW = GRID_COLS * TILE_WIDTH;
    const worldH = GRID_ROWS * TILE_HEIGHT;

    const worldX = (localX / this.MAP_W) * worldW + (this.worldOffsetX - worldW / 2);
    const worldY = (localY / this.MAP_H) * worldH + this.worldOffsetY;

    this.scene.cameras.main.centerOn(worldX, worldY);
  };

  private updateScreenBounds(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.screenBounds = { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
  }

  setVisible(visible: boolean): void {
    this.canvas.style.display = visible ? 'block' : 'none';
  }

  setAlpha(alpha: number): void {
    this.canvas.style.opacity = String(alpha);
  }

  destroy(): void {
    this.scene.events.off('update', this.updateBound);
    this.canvas.removeEventListener('click', this.onClick);
    this.canvas.remove();
  }
}
