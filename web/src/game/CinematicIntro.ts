import * as Phaser from 'phaser';
import { TilemapManager, TILE_WIDTH, TILE_HEIGHT, GRID_COLS, GRID_ROWS } from './TilemapManager';
import { MinimapManager } from './MinimapManager';

/** Set to true to skip the intro and go straight to gameplay. */
export const SKIP_INTRO = false;

/**
 * Two-state map transition system:
 *  - World View: all districts visible, filling canvas (~1.25x zoom)
 *  - District View: single district fills canvas (~3.0x zoom)
 *  - Click district to enter, ESC / back button to return
 */
export class CinematicIntro {
  /* ── Tuning constants ─────────────────────────────────────────── */
  private static readonly DRIFT_SPEED = 0.6;
  private static readonly OVERLAY_ALPHA = 0.06;
  private static readonly ZOOM_DURATION = 2200;
  private static readonly SHAKE_INTENSITY = 0.002;
  private static readonly SHAKE_DURATION = 200;
  private static readonly FLASH_DURATION = 300;

  /* ── Isometric world geometry (derived from grid constants) ──── */
  private static readonly WORLD_W = (GRID_COLS + GRID_ROWS) * (TILE_WIDTH / 2);   // 1792
  private static readonly WORLD_H = (GRID_COLS + GRID_ROWS) * (TILE_HEIGHT / 2);  // 896
  private static readonly UI_HEADER_H = 52; // fixed header height in pixels

  /* ── Public state ─────────────────────────────────────────────── */
  public isInOverview = true;

  /* ── Internal state ───────────────────────────────────────────── */
  private isTransitioning = false;
  private driftVx = 0;
  private driftVy = 0;
  private lastEnteredCategory: string | null = null;
  private worldCenter: { x: number; y: number };

  /* ── Overlay game objects (created/destroyed per overview enter) ─ */
  private darkOverlay: Phaser.GameObjects.Rectangle | null = null;
  private bokehEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private flashRect: Phaser.GameObjects.Rectangle | null = null;

  /* ── Keyboard ─────────────────────────────────────────────────── */
  private escKey: Phaser.Input.Keyboard.Key | null = null;

  constructor(
    private scene: Phaser.Scene,
    private camera: Phaser.Cameras.Scene2D.Camera,
    private tilemapManager: TilemapManager,
    private minimapManager: MinimapManager,
    private onEnterWorld: (districtCategory: string) => void,
    private onExitToOverview: () => void,
  ) {
    this.worldCenter = this.tilemapManager.getWorldCenter();

    // Bind Escape key
    if (this.scene.input.keyboard) {
      this.escKey = this.scene.input.keyboard.addKey(
        Phaser.Input.Keyboard.KeyCodes.ESC,
      );
      this.escKey.on('down', this.handleEscape, this);
    }

    // Ensure bokeh texture exists
    if (!this.scene.textures.exists('particle-bokeh')) {
      const tex = this.scene.textures.createCanvas('particle-bokeh', 12, 12);
      if (tex) {
        const ctx = tex.context;
        const g = ctx.createRadialGradient(6, 6, 0, 6, 6, 6);
        g.addColorStop(0, 'rgba(255,245,220,0.6)');
        g.addColorStop(0.5, 'rgba(255,245,220,0.15)');
        g.addColorStop(1, 'rgba(255,245,220,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 12, 12);
        tex.refresh();
      }
    }

    // Listen for district clicks while in district view (pan between districts)
    this.scene.game.events.on('district-clicked', this.onDistrictClicked, this);

    // Enter world view
    this.enterOverview(true);
  }

  /* ── Dynamic zoom computation ──────────────────────────────────── */

  private computeOverviewZoom(): number {
    const availH = this.camera.height - CinematicIntro.UI_HEADER_H;
    return Math.min(
      this.camera.width * 1.12 / CinematicIntro.WORLD_W,
      availH * 1.12 / CinematicIntro.WORLD_H,
    );
  }

  /** Compute zoom for a specific district based on its actual organic bounds. */
  private computeDistrictZoomFor(category: string): number {
    const bounds = this.tilemapManager.getDistrictBounds(category);
    if (!bounds) return this.computeFallbackDistrictZoom();

    // Convert bounding box corners to screen space
    const topLeft = this.tilemapManager.gridToScreen(bounds.minCol, bounds.minRow);
    const topRight = this.tilemapManager.gridToScreen(bounds.maxCol, bounds.minRow);
    const botLeft = this.tilemapManager.gridToScreen(bounds.minCol, bounds.maxRow);
    const botRight = this.tilemapManager.gridToScreen(bounds.maxCol, bounds.maxRow);

    // Isometric diamond: rightmost is topRight.x, leftmost is botLeft.x
    const screenW = Math.max(topLeft.x, topRight.x, botLeft.x, botRight.x) -
                    Math.min(topLeft.x, topRight.x, botLeft.x, botRight.x);
    const screenH = Math.max(topLeft.y, topRight.y, botLeft.y, botRight.y) -
                    Math.min(topLeft.y, topRight.y, botLeft.y, botRight.y);

    const availH = this.camera.height - CinematicIntro.UI_HEADER_H;
    return Math.min(
      this.camera.width * 0.85 / Math.max(screenW, 100),
      availH * 0.85 / Math.max(screenH, 50),
    );
  }

  private computeFallbackDistrictZoom(): number {
    // Fallback: assume ~12-tile wide district diamond
    const fallbackW = 24 * (TILE_WIDTH / 2);
    const fallbackH = 24 * (TILE_HEIGHT / 2);
    const availH = this.camera.height - CinematicIntro.UI_HEADER_H;
    return Math.min(
      this.camera.width * 0.85 / fallbackW,
      availH * 0.85 / fallbackH,
    );
  }

  /* ══════════════════════════════════════════════════════════════════
     WORLD VIEW — overview of all districts
     ══════════════════════════════════════════════════════════════ */
  private enterOverview(isInitial: boolean): void {
    this.isInOverview = true;
    this.isTransitioning = !isInitial;

    const overviewZoom = this.computeOverviewZoom();
    const center = this.worldCenter;

    // Random drift direction
    const angle = Math.random() * Math.PI * 2;
    this.driftVx = Math.cos(angle) * CinematicIntro.DRIFT_SPEED;
    this.driftVy = Math.sin(angle) * CinematicIntro.DRIFT_SPEED;

    // Labels visible + scaled to compensate for zoom
    this.tilemapManager.setLabelsVisible(true, isInitial ? 0 : 400);
    this.tilemapManager.setLabelsScale(1 / overviewZoom, isInitial ? 0 : 400);
    this.minimapManager.setAlpha(0);

    // Enable district hover
    this.tilemapManager.setHoverEnabled(true);

    // Create overlay objects
    const w = this.camera.width;
    const h = this.camera.height;

    this.darkOverlay = this.scene.add.rectangle(
      w / 2, h / 2, w * 3, h * 3, 0x000000,
      isInitial ? CinematicIntro.OVERLAY_ALPHA : 0,
    );
    this.darkOverlay.setScrollFactor(0).setDepth(2000).setOrigin(0.5, 0.5);

    // Bokeh particles (subtle)
    this.bokehEmitter = this.scene.add.particles(0, 0, 'particle-bokeh', {
      x: { min: 0, max: w },
      y: { min: 0, max: h },
      lifespan: { min: 3000, max: 6000 },
      speed: { min: 5, max: 15 },
      angle: { min: 250, max: 290 },
      scale: { start: 0.3, end: 0.8 },
      alpha: { start: 0, end: 0.2 },
      frequency: 400,
      maxAliveParticles: 8,
      blendMode: Phaser.BlendModes.ADD,
    });
    this.bokehEmitter.setScrollFactor(0).setDepth(2001);

    if (isInitial) {
      // First load — snap camera (offset for header)
      this.camera.setZoom(overviewZoom);
      const headerOffset = CinematicIntro.UI_HEADER_H / (2 * overviewZoom);
      this.camera.centerOn(center.x, center.y + headerOffset);
      this.scene.time.delayedCall(800, () => {
        if (this.isInOverview && !this.isTransitioning) {
          this.scene.input.on('pointerup', this.onPointerUp, this);
        }
      });
      this.isTransitioning = false;
    } else {
      // Reverse transition — animate zoom out from district
      const dur = CinematicIntro.ZOOM_DURATION;

      const headerOffset = CinematicIntro.UI_HEADER_H / (2 * overviewZoom);
      const targetScrollX = center.x - this.camera.width / 2;
      const targetScrollY = (center.y + headerOffset) - this.camera.height / 2;

      this.scene.tweens.add({
        targets: this.camera,
        zoom: overviewZoom,
        scrollX: targetScrollX,
        scrollY: targetScrollY,
        duration: dur,
        ease: 'Cubic.easeInOut',
      });

      // Overlay fades in
      this.scene.tweens.add({
        targets: this.darkOverlay,
        alpha: CinematicIntro.OVERLAY_ALPHA,
        duration: dur * 0.6,
        delay: dur * 0.2,
        ease: 'Cubic.easeOut',
      });

      // On complete — enable click handler
      this.scene.time.delayedCall(dur + 200, () => {
        this.isTransitioning = false;
        this.scene.input.on('pointerup', this.onPointerUp, this);
      });
    }

    // Emit event for React UI
    this.scene.game.events.emit('exited-district');

    // Resize handler
    this.scene.scale.on('resize', this.onResize, this);
  }

  /* ══════════════════════════════════════════════════════════════════
     PER-FRAME — camera drift while in world view
     ══════════════════════════════════════════════════════════════ */
  update(_time: number, delta: number): void {
    if (this.isTransitioning) return;

    if (this.isInOverview) {
      // Gentle camera drift in overview
      const dt = delta / 1000;
      this.camera.scrollX += this.driftVx * dt;
      this.camera.scrollY += this.driftVy * dt;
      return;
    }

    // In district view — auto-exit to overview if user scrolls out far enough
    const overviewZoom = this.computeOverviewZoom();
    if (this.camera.zoom < overviewZoom * 1.3) {
      this.exitToOverview();
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     DISTRICT CLICK → ZOOM INTO DISTRICT VIEW
     ══════════════════════════════════════════════════════════════ */
  private onPointerUp = (pointer: Phaser.Input.Pointer): void => {
    if (!this.isInOverview || this.isTransitioning) return;

    const dist = Phaser.Math.Distance.Between(
      pointer.downX, pointer.downY, pointer.upX, pointer.upY,
    );
    if (dist > 8) return;

    const cell = this.tilemapManager.screenToGrid(pointer.worldX, pointer.worldY);
    if (!cell) return;

    const category = this.tilemapManager.getTileDistrict(cell.col, cell.row);
    if (!category) return;

    const center = this.tilemapManager.getDistrictCenter(category);
    if (!center) return;

    this.zoomIn(center.x, center.y, category);
  };

  private zoomIn(zoomX: number, zoomY: number, category: string): void {
    this.isTransitioning = true;
    this.lastEnteredCategory = category;
    this.scene.input.off('pointerup', this.onPointerUp, this);

    // Disable district hover
    this.tilemapManager.setHoverEnabled(false);

    // Screen flash on click
    this.screenFlash();

    // Stop bokeh
    this.bokehEmitter?.stop();

    const dur = CinematicIntro.ZOOM_DURATION;
    const districtZoom = this.computeDistrictZoomFor(category);

    const headerOffset = CinematicIntro.UI_HEADER_H / (2 * districtZoom);
    const targetScrollX = zoomX - this.camera.width / 2;
    const targetScrollY = (zoomY + headerOffset) - this.camera.height / 2;

    // 1. Camera zoom + pan to district
    this.scene.tweens.add({
      targets: this.camera,
      zoom: districtZoom,
      scrollX: targetScrollX,
      scrollY: targetScrollY,
      duration: dur,
      ease: 'Cubic.easeInOut',
    });

    // 2. Fade out dark overlay
    if (this.darkOverlay) {
      this.scene.tweens.add({
        targets: this.darkOverlay,
        alpha: 0,
        duration: dur * 0.7,
        delay: dur * 0.1,
        ease: 'Cubic.easeIn',
      });
    }

    // 3. Hide labels (they'd be huge at district zoom)
    this.tilemapManager.setLabelsVisible(false, dur * 0.4);

    // 5. Fade in minimap
    const uiRevealDelay = dur * 0.7;
    this.scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 500,
      delay: uiRevealDelay,
      ease: 'Cubic.easeOut',
      onUpdate: (tween: Phaser.Tweens.Tween) => {
        this.minimapManager.setAlpha(tween.getValue());
      },
    });

    // 6. Complete — enable buildings
    this.scene.time.delayedCall(dur, () => {
      this.destroyOverlayObjects();
      this.isInOverview = false;
      this.isTransitioning = false;
      this.onEnterWorld(category);

      // Emit event for React UI
      this.scene.game.events.emit('entered-district', category);
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     PAN BETWEEN DISTRICTS (while already zoomed in)
     ══════════════════════════════════════════════════════════════ */
  private onDistrictClicked = (info: { name: string; category: string }): void => {
    // Only handle when already in a district view and not transitioning
    if (this.isInOverview || this.isTransitioning) return;
    // Ignore clicks on the same district we're already viewing
    if (info.category === this.lastEnteredCategory) return;

    const center = this.tilemapManager.getDistrictCenter(info.category);
    if (!center) return;

    this.panToDistrict(center.x, center.y, info.category);
  };

  private panToDistrict(targetX: number, targetY: number, category: string): void {
    this.isTransitioning = true;

    const districtZoom = this.computeDistrictZoomFor(category);
    const headerOffset = CinematicIntro.UI_HEADER_H / (2 * districtZoom);
    const targetScrollX = targetX - this.camera.width / 2;
    const targetScrollY = (targetY + headerOffset) - this.camera.height / 2;

    const dur = 800; // faster than initial zoom-in

    this.screenFlash();

    // Smooth pan + zoom adjust
    this.scene.tweens.add({
      targets: this.camera,
      zoom: districtZoom,
      scrollX: targetScrollX,
      scrollY: targetScrollY,
      duration: dur,
      ease: 'Cubic.easeInOut',
    });

    this.scene.time.delayedCall(dur, () => {
      this.lastEnteredCategory = category;
      this.isTransitioning = false;
      this.onEnterWorld(category);
      this.scene.game.events.emit('entered-district', category);
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     ESCAPE / BACK BUTTON → RETURN TO WORLD VIEW
     ══════════════════════════════════════════════════════════════ */
  private handleEscape = (): void => {
    if (this.isInOverview || this.isTransitioning) return;
    this.exitToOverview();
  };

  /** Public method — called by ESC key or React "Back to World" button. */
  public exitToOverview(): void {
    if (this.isInOverview || this.isTransitioning) return;

    this.isTransitioning = true;
    this.onExitToOverview();

    // Fade out minimap
    const uiFadeDur = 400;
    this.scene.tweens.addCounter({
      from: 1,
      to: 0,
      duration: uiFadeDur,
      ease: 'Cubic.easeIn',
      onUpdate: (tween: Phaser.Tweens.Tween) => {
        this.minimapManager.setAlpha(tween.getValue());
      },
    });

    // After minimap fades, transition to overview
    this.scene.time.delayedCall(uiFadeDur, () => {
      this.enterOverview(false);
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     SCREEN FLASH — brief white flash on click
     ══════════════════════════════════════════════════════════════ */
  private screenFlash(): void {
    const w = this.camera.width;
    const h = this.camera.height;

    this.flashRect = this.scene.add.rectangle(
      w / 2, h / 2, w * 3, h * 3, 0xffffff, 0,
    );
    this.flashRect.setScrollFactor(0).setDepth(2003).setOrigin(0.5, 0.5);

    this.scene.tweens.add({
      targets: this.flashRect,
      alpha: { from: 0, to: 0.1 },
      duration: CinematicIntro.FLASH_DURATION / 2,
      yoyo: true,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.flashRect?.destroy();
        this.flashRect = null;
      },
    });
  }

  /* ══════════════════════════════════════════════════════════════════
     RESIZE HANDLER — adjust zoom and overlay positions
     ══════════════════════════════════════════════════════════════ */
  private onResize = (): void => {
    const w = this.camera.width;
    const h = this.camera.height;

    if (this.isInOverview && !this.isTransitioning) {
      // Recalculate overview zoom for new canvas size
      const zoom = this.computeOverviewZoom();
      const headerOffset = CinematicIntro.UI_HEADER_H / (2 * zoom);
      this.camera.setZoom(zoom);
      this.camera.centerOn(this.worldCenter.x, this.worldCenter.y + headerOffset);

      // Reposition overlay objects
      if (this.darkOverlay) {
        this.darkOverlay.setPosition(w / 2, h / 2);
        this.darkOverlay.setSize(w * 3, h * 3);
      }

      // Rescale labels for new zoom
      this.tilemapManager.setLabelsScale(1 / zoom, 0);
    } else if (!this.isInOverview && !this.isTransitioning) {
      // Recalculate district zoom for new canvas size
      const cat = this.lastEnteredCategory;
      const districtCenter = cat ? this.tilemapManager.getDistrictCenter(cat) : null;
      if (districtCenter && cat) {
        const zoom = this.computeDistrictZoomFor(cat);
        const headerOffset = CinematicIntro.UI_HEADER_H / (2 * zoom);
        this.camera.setZoom(zoom);
        this.camera.centerOn(districtCenter.x, districtCenter.y + headerOffset);
      }
    }
  };

  /* ══════════════════════════════════════════════════════════════════
     CLEANUP HELPERS
     ══════════════════════════════════════════════════════════════ */
  private destroyOverlayObjects(): void {
    this.scene.scale.off('resize', this.onResize, this);
    this.scene.input.off('pointerup', this.onPointerUp, this);

    this.darkOverlay?.destroy();
    this.darkOverlay = null;
    this.bokehEmitter?.destroy();
    this.bokehEmitter = null;
    this.flashRect?.destroy();
    this.flashRect = null;
  }

  /** Full teardown (scene shutdown). */
  destroy(): void {
    this.destroyOverlayObjects();
    this.scene.game.events.off('district-clicked', this.onDistrictClicked, this);
    this.escKey?.off('down', this.handleEscape, this);
    if (this.scene.input.keyboard && this.escKey) {
      this.scene.input.keyboard.removeKey(this.escKey);
    }
    if (this.scene.textures.exists('particle-bokeh')) {
      this.scene.textures.remove('particle-bokeh');
    }
  }
}
