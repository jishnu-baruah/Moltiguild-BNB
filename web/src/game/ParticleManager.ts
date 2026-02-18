import * as Phaser from 'phaser';
import { TilemapManager } from './TilemapManager';

/** Buildings that emit chimney smoke (workshops have forges). */
const SMOKE_BUILDINGS = new Set([
  'bldg-workshop',
  'custom-workshop',
]);

/** Biome particle configs: texture color, particle size, direction, frequency. */
const BIOME_PARTICLES: Record<string, {
  color: string;
  size: number;
  angle: { min: number; max: number };
  speed: { min: number; max: number };
  frequency: number;
  gravityY: number;
}> = {
  creative:    { color: 'rgba(232,140,176,0.7)', size: 6,  angle: { min: 250, max: 290 }, speed: { min: 3, max: 8 },  frequency: 500, gravityY: -5 },
  defi:        { color: 'rgba(240,128,48,0.8)',   size: 4,  angle: { min: 260, max: 280 }, speed: { min: 5, max: 15 }, frequency: 300, gravityY: -20 },
  code:        { color: 'rgba(224,232,240,0.6)',  size: 5,  angle: { min: 80, max: 100 },  speed: { min: 2, max: 6 },  frequency: 400, gravityY: 8 },
  research:    { color: 'rgba(144,112,192,0.5)',  size: 8,  angle: { min: 0, max: 360 },   speed: { min: 1, max: 4 },  frequency: 600, gravityY: 0 },
  translation: { color: 'rgba(88,184,232,0.4)',   size: 4,  angle: { min: 170, max: 190 }, speed: { min: 2, max: 8 },  frequency: 500, gravityY: 0 },
};

export class ParticleManager {
  private dustEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private smokeEmitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
  private biomeEmitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];

  constructor(private scene: Phaser.Scene) {
    this.createParticleTextures();
  }

  /* ── Programmatic particle textures ──────────────────────────────── */

  private createParticleTextures(): void {
    // Dust mote: 6x6 soft warm circle
    const dust = this.scene.textures.createCanvas('particle-dust', 6, 6);
    if (dust) {
      const ctx = dust.context;
      const g = ctx.createRadialGradient(3, 3, 0, 3, 3, 3);
      g.addColorStop(0, 'rgba(255,245,200,0.9)');
      g.addColorStop(1, 'rgba(255,245,200,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 6, 6);
      dust.refresh();
    }

    // Smoke puff: 10x10 soft gray circle
    const smoke = this.scene.textures.createCanvas('particle-smoke', 10, 10);
    if (smoke) {
      const ctx = smoke.context;
      const g = ctx.createRadialGradient(5, 5, 0, 5, 5, 5);
      g.addColorStop(0, 'rgba(180,180,180,0.5)');
      g.addColorStop(1, 'rgba(120,120,120,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 10, 10);
      smoke.refresh();
    }
  }

  /* ── Ambient dust motes across the world ─────────────────────────── */

  createDustEmitter(worldCenterX: number, worldCenterY: number): void {
    this.dustEmitter = this.scene.add.particles(0, 0, 'particle-dust', {
      x: { min: worldCenterX - 1800, max: worldCenterX + 1800 },
      y: { min: worldCenterY - 900, max: worldCenterY + 900 },
      lifespan: { min: 4000, max: 8000 },
      speed: { min: 2, max: 8 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.8, end: 0 },
      alpha: { start: 0.5, end: 0 },
      frequency: 200,
      maxAliveParticles: 40,
      blendMode: Phaser.BlendModes.ADD,
    });
    this.dustEmitter.setDepth(8);
  }

  /* ── Chimney smoke on specific buildings ─────────────────────────── */

  addSmokeIfEligible(buildingKey: string, worldX: number, worldY: number): void {
    if (!SMOKE_BUILDINGS.has(buildingKey)) return;

    const emitter = this.scene.add.particles(worldX, worldY - 25, 'particle-smoke', {
      lifespan: { min: 2000, max: 4000 },
      speed: { min: 3, max: 8 },
      angle: { min: 260, max: 280 },
      scale: { start: 0.3, end: 1.5 },
      alpha: { start: 0.35, end: 0 },
      frequency: 600,
      maxAliveParticles: 6,
      gravityY: -10,
    });
    emitter.setDepth(9);
    this.smokeEmitters.push(emitter);
  }

  /* ── Per-biome ambient particles ─────────────────────────────────── */

  createBiomeEmitters(tilemapManager: TilemapManager): void {
    for (const [category, config] of Object.entries(BIOME_PARTICLES)) {
      const bounds = tilemapManager.getDistrictBounds(category);
      if (!bounds) continue;

      const texKey = `particle-biome-${category}`;
      if (!this.scene.textures.exists(texKey)) {
        const tex = this.scene.textures.createCanvas(texKey, config.size, config.size);
        if (!tex) continue;
        const ctx = tex.context;
        const r = config.size / 2;
        const g = ctx.createRadialGradient(r, r, 0, r, r, r);
        g.addColorStop(0, config.color);
        g.addColorStop(1, config.color.replace(/[\d.]+\)$/, '0)'));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, config.size, config.size);
        tex.refresh();
      }

      // Get world-space bounds from computed district bounds
      const topLeft = tilemapManager.gridToScreen(bounds.minCol, bounds.minRow);
      const botRight = tilemapManager.gridToScreen(bounds.maxCol, bounds.maxRow);
      const center = tilemapManager.gridToScreen(bounds.centerCol, bounds.centerRow);

      const rangeX = Math.abs(botRight.x - topLeft.x) / 2 + 50;
      const rangeY = Math.abs(botRight.y - topLeft.y) / 2 + 30;

      const emitter = this.scene.add.particles(0, 0, texKey, {
        x: { min: center.x - rangeX, max: center.x + rangeX },
        y: { min: center.y - rangeY, max: center.y + rangeY },
        lifespan: { min: 3000, max: 6000 },
        speed: config.speed,
        angle: config.angle,
        scale: { start: 0.5, end: 0.1 },
        alpha: { start: 0.6, end: 0 },
        frequency: config.frequency,
        maxAliveParticles: 8,
        gravityY: config.gravityY,
        blendMode: Phaser.BlendModes.ADD,
      });
      emitter.setDepth(8);
      this.biomeEmitters.push(emitter);
    }
  }

  /* ── Cleanup ─────────────────────────────────────────────────────── */

  destroy(): void {
    this.dustEmitter?.destroy();
    for (const e of this.smokeEmitters) e.destroy();
    for (const e of this.biomeEmitters) e.destroy();
    this.smokeEmitters = [];
    this.biomeEmitters = [];
  }
}
