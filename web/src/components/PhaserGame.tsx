'use client';

import { useEffect, useRef, useState } from 'react';
import type { WorldState } from '@/lib/world-state';
import { subscribeSSE } from '@/lib/sse';

interface PhaserGameProps {
  worldState: WorldState | null;
  onGuildClick: (guildId: number) => void;
  onEmptyLotClick: (district: string) => void;
  onDistrictClick?: (info: { name: string; category: string }) => void;
  onPlotAssigned?: (guildId: number) => void;
  onPlotReleased?: (guildId: number) => void;
  onProgress?: (pct: number, label: string) => void;
}

export default function PhaserGame({ worldState, onGuildClick, onEmptyLotClick, onDistrictClick, onPlotAssigned: _onPlotAssigned, onPlotReleased: _onPlotReleased, onProgress }: PhaserGameProps) {
  const gameRef = useRef<{ game: InstanceType<typeof import('phaser').Game> } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [inDistrict, setInDistrict] = useState(false);
  const sceneReadyRef = useRef(false);
  const worldStateRef = useRef<WorldState | null>(null);
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;

  useEffect(() => {
    async function initPhaser() {
      try {
        const Phaser = await import('phaser');
        const { WorldScene } = await import('@/game/WorldScene');

        if (!containerRef.current || gameRef.current) return;

        const config: Phaser.Types.Core.GameConfig = {
          type: Phaser.AUTO,
          width: window.innerWidth,
          height: window.innerHeight,
          backgroundColor: '#08090e',
          parent: containerRef.current,
          pixelArt: true,
          scale: {
            mode: Phaser.Scale.RESIZE,
            autoCenter: Phaser.Scale.CENTER_BOTH,
          },
          scene: [WorldScene],
        };

        onProgressRef.current?.(0.05, 'Initializing engine...');

        const game = new Phaser.Game(config);
        gameRef.current = { game };

        // Phaser file-loader progress (asset preload 5% → 20%)
        game.events.on('ready', () => {
          const scene = game.scene.getScene('WorldScene');
          if (scene) {
            scene.load.on('progress', (pct: number) => {
              onProgressRef.current?.(0.05 + pct * 0.15, 'Loading assets...');
            });
          }
        });

        // WorldScene emits load-progress at milestones during create()
        game.events.on('load-progress', (pct: number, label: string) => {
          onProgressRef.current?.(pct, label);
        });

        // Wire up event listeners
        game.events.on('district-clicked', (info: { name: string; category: string }) => {
          onDistrictClick?.(info);
        });

        // Track district enter/exit for back button + sync UIOverlay
        game.events.on('entered-district', () => {
          setInDistrict(true);
        });
        game.events.on('exited-district', () => {
          setInDistrict(false);
          // Tell UIOverlay to reset its state too
          window.dispatchEvent(new CustomEvent('back-to-overview'));
        });

        game.events.on('ready', () => {
          const scene = game.scene.getScene('WorldScene');
          if (scene) {
            scene.events.on('guild-clicked', (guildId: number) => {
              onGuildClick(guildId);
            });
            scene.events.on('empty-lot-clicked', (district: string) => {
              onEmptyLotClick(district);
            });
          }
        });

        // Scene emits 'scene-created' after create() completes and all managers are ready
        game.events.on('scene-created', () => {
          sceneReadyRef.current = true;
          onProgressRef.current?.(0.75, 'Loading guild data...');
          // Forward current worldState now that the scene is fully initialized
          const scene = game.scene.getScene('WorldScene');
          if (scene && 'updateWorldState' in scene && worldStateRef.current) {
            (scene as unknown as { updateWorldState: (ws: WorldState) => void }).updateWorldState(worldStateRef.current);
          }
        });
      } catch (err) {
        console.error('[PhaserGame] Failed to initialize:', err);
      }
    }

    initPhaser();

    // Listen for UIOverlay requesting overview (Header back button)
    const handleRequestOverview = () => {
      if (!gameRef.current) return;
      const scene = gameRef.current.game.scene.getScene('WorldScene');
      if (scene && 'exitToOverview' in scene) {
        (scene as unknown as { exitToOverview: () => void }).exitToOverview();
      }
    };
    window.addEventListener('request-overview', handleRequestOverview);

    return () => {
      window.removeEventListener('request-overview', handleRequestOverview);
      if (gameRef.current) {
        gameRef.current.game.destroy(true);
        gameRef.current = null;
        sceneReadyRef.current = false;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Forward worldState updates to the Phaser scene
  useEffect(() => {
    worldStateRef.current = worldState;
    if (!worldState || !gameRef.current || !sceneReadyRef.current) return;
    const scene = gameRef.current.game.scene.getScene('WorldScene');
    if (scene && 'updateWorldState' in scene) {
      (scene as unknown as { updateWorldState: (ws: WorldState) => void }).updateWorldState(worldState);
    }
  }, [worldState]);

  // SSE plot event forwarding to Phaser scene
  useEffect(() => {
    if (!gameRef.current || !sceneReadyRef.current) return;

    const unsub = subscribeSSE((sse) => {
      if (sse.type !== 'plot_assigned' && sse.type !== 'plot_released') return;
      if (!gameRef.current) return;

      const scene = gameRef.current.game.scene.getScene('WorldScene');
      if (!scene) return;

      const guildId = Number(sse.data.guildId);

      if (sse.type === 'plot_assigned' && 'onPlotAssigned' in scene) {
        (scene as unknown as { onPlotAssigned: (id: number) => void }).onPlotAssigned(guildId);
      }
      if (sse.type === 'plot_released' && 'onPlotReleased' in scene) {
        (scene as unknown as { onPlotReleased: (id: number) => void }).onPlotReleased(guildId);
      }
    });

    return unsub;
  }, []);

  const handleBackToWorld = (e?: React.MouseEvent) => {
    // Prevent click from leaking to Phaser canvas
    e?.stopPropagation();
    if (!gameRef.current) return;
    // Immediately reset UIOverlay state
    window.dispatchEvent(new CustomEvent('back-to-overview'));
    const scene = gameRef.current.game.scene.getScene('WorldScene');
    if (scene && 'exitToOverview' in scene) {
      (scene as unknown as { exitToOverview: () => void }).exitToOverview();
    }
  };

  return (
    <div
      ref={containerRef}
      id="phaser-container"
      style={{ width: '100%', height: '100vh', position: 'relative', zIndex: 1 }}
    >
      {inDistrict && (
        <button
          onClick={handleBackToWorld}
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: 64,
            right: 16,
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 16px',
            background: 'rgba(19, 17, 13, 0.85)',
            border: '1px solid rgba(196, 113, 59, 0.4)',
            borderRadius: 6,
            color: '#d4c4a0',
            fontFamily: '"Cinzel", serif',
            fontSize: 13,
            cursor: 'pointer',
            backdropFilter: 'blur(8px)',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(196, 113, 59, 0.25)';
            e.currentTarget.style.borderColor = 'rgba(196, 113, 59, 0.7)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(19, 17, 13, 0.85)';
            e.currentTarget.style.borderColor = 'rgba(196, 113, 59, 0.4)';
          }}
        >
          <span style={{ fontSize: 16 }}>{'\u2190'}</span>
          World View
        </button>
      )}
    </div>
  );
}
