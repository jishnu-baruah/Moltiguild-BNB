import * as Phaser from 'phaser';

export class CameraController {
  private camera: Phaser.Cameras.Scene2D.Camera;
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private minZoom = 0.5;
  private maxZoom = 4;
  private enabled = true;

  /** Screen-space exclusion zone (minimap) where drag should not start. */
  private exclusionZone: { x: number; y: number; w: number; h: number } | null = null;

  constructor(private scene: Phaser.Scene, worldWidth: number, worldHeight: number) {
    this.camera = scene.cameras.main;

    // Set camera bounds using isometric bounding box dimensions
    // The isometric diamond extends beyond the simple grid*tile dimensions
    const isoW = worldWidth * 1.2;
    const isoH = worldHeight * 2.5;
    this.camera.setBounds(
      -isoW * 0.3,
      -isoH * 0.2,
      isoW * 1.6,
      isoH * 1.4
    );

    this.setupDragPan();
    this.setupScrollZoom();
  }

  /** Set a screen-space rect where drag-pan should be suppressed. */
  setExclusionZone(x: number, y: number, w: number, h: number): void {
    this.exclusionZone = { x, y, w, h };
  }

  private isInExclusionZone(pointer: Phaser.Input.Pointer): boolean {
    if (!this.exclusionZone) return false;
    const z = this.exclusionZone;
    return pointer.x >= z.x && pointer.x <= z.x + z.w &&
           pointer.y >= z.y && pointer.y <= z.y + z.h;
  }

  private setupDragPan(): void {
    this.scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.enabled) return;
      // Don't start drag if clicking on minimap
      if (this.isInExclusionZone(pointer)) return;

      this.isDragging = true;
      this.dragStartX = pointer.worldX;
      this.dragStartY = pointer.worldY;
    });

    this.scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.enabled) return;
      if (!pointer.isDown || !this.isDragging) return;

      const dx = this.dragStartX - pointer.worldX;
      const dy = this.dragStartY - pointer.worldY;

      this.camera.scrollX += dx;
      this.camera.scrollY += dy;
    });

    this.scene.input.on('pointerup', () => {
      this.isDragging = false;
    });
  }

  private setupScrollZoom(): void {
    this.scene.input.on('wheel', (
      _pointer: Phaser.Input.Pointer,
      _gameObjects: Phaser.GameObjects.GameObject[],
      _deltaX: number,
      deltaY: number,
    ) => {
      if (!this.enabled) return;
      const zoomFactor = deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Phaser.Math.Clamp(
        this.camera.zoom * zoomFactor,
        this.minZoom,
        this.maxZoom
      );
      this.camera.zoom = newZoom;
    });
  }

  disable(): void {
    this.enabled = false;
    this.isDragging = false;
  }

  enable(): void {
    this.enabled = true;
  }

  centerOn(x: number, y: number): void {
    this.camera.centerOn(x, y);
  }

  destroy(): void {
    this.scene.input.off('pointerdown');
    this.scene.input.off('pointermove');
    this.scene.input.off('pointerup');
    this.scene.input.off('wheel');
  }
}
