'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useGuildVisuals, useGuilds, useStats } from '@/lib/hooks';
import { useNetwork } from '@/lib/network';
import type { WorldState } from '@/lib/world-state';

const PhaserGame = dynamic(() => import('@/components/PhaserGame'), {
  ssr: false,
});

const UIOverlay = dynamic(() => import('@/components/UIOverlay'), {
  ssr: false,
});

/* ── Global loading progress bar ─────────────────────────────────────── */

function WorldLoadingBar({ progress, label }: { progress: number; label: string }) {
  const [visible, setVisible] = useState(true);
  const [opacity, setOpacity] = useState(1);
  const prevProgress = useRef(0);

  useEffect(() => {
    if (progress >= 1 && prevProgress.current < 1) {
      // Hold at 100% for a beat, then fade out
      const t = setTimeout(() => setOpacity(0), 600);
      const t2 = setTimeout(() => setVisible(false), 1100);
      return () => { clearTimeout(t); clearTimeout(t2); };
    }
    prevProgress.current = progress;
  }, [progress]);

  if (!visible) return null;

  const pct = Math.min(progress * 100, 100);

  return (
    <div
      style={{
        position: 'fixed',
        top: 52, /* just below header */
        left: 0,
        right: 0,
        height: 3,
        zIndex: 200,
        pointerEvents: 'none',
        opacity,
        transition: 'opacity 500ms ease',
      }}
    >
      {/* Track (subtle dark groove) */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(196, 113, 59, 0.08)',
      }} />

      {/* Fill bar — ember glow */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        bottom: 0,
        width: `${pct}%`,
        background: 'linear-gradient(90deg, #c4713b, #e8944f, #d4b044)',
        boxShadow: '0 0 8px rgba(232, 148, 79, 0.6), 0 0 20px rgba(196, 113, 59, 0.3)',
        transition: 'width 400ms cubic-bezier(0.4, 0, 0.2, 1)',
        borderRadius: '0 2px 2px 0',
      }} />

      {/* Leading edge spark */}
      <div style={{
        position: 'absolute',
        top: -1,
        left: `${pct}%`,
        width: 6,
        height: 5,
        background: 'radial-gradient(circle, #d4b044 0%, transparent 70%)',
        transform: 'translateX(-3px)',
        transition: 'left 400ms cubic-bezier(0.4, 0, 0.2, 1)',
        opacity: pct < 100 ? 1 : 0,
      }} />

      {/* Label */}
      {pct < 100 && (
        <div style={{
          position: 'absolute',
          top: 6,
          right: 12,
          fontFamily: "'Crimson Pro', serif",
          fontStyle: 'italic',
          fontSize: 11,
          color: 'rgba(212, 201, 168, 0.5)',
          letterSpacing: '0.03em',
          transition: 'opacity 300ms ease',
        }}>
          {label}
        </div>
      )}
    </div>
  );
}

/* ── Role Selection Overlay ────────────────────────────────────────── */

function RoleOverlay({
  progress,
  onChooseHuman,
}: {
  progress: number;
  onChooseHuman: () => void;
}) {
  const network = useNetwork();
  const [fadeOut, setFadeOut] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [hovered, setHovered] = useState<'human' | 'agent' | null>(null);

  const handleHuman = () => {
    setFadeOut(true);
    setTimeout(() => {
      setHidden(true);
      onChooseHuman();
    }, 700);
  };

  const handleAgent = () => {
    window.open('/SKILL.md', '_blank');
  };

  if (hidden) return null;

  const pct = Math.min(progress * 100, 100);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 500,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(ellipse at 50% 40%, #1e1a14 0%, #0d0c08 55%, #08090e 100%)',
        opacity: fadeOut ? 0 : 1,
        transition: 'opacity 700ms ease',
        overflow: 'hidden',
      }}
    >
      {/* Noise grain overlay */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E")`,
        pointerEvents: 'none',
      }} />

      {/* Decorative corner flourishes */}
      <div style={{
        position: 'absolute',
        top: 40,
        left: 40,
        width: 60,
        height: 60,
        borderTop: '1px solid rgba(184, 150, 46, 0.2)',
        borderLeft: '1px solid rgba(184, 150, 46, 0.2)',
        opacity: 0.6,
      }} />
      <div style={{
        position: 'absolute',
        top: 40,
        right: 40,
        width: 60,
        height: 60,
        borderTop: '1px solid rgba(184, 150, 46, 0.2)',
        borderRight: '1px solid rgba(184, 150, 46, 0.2)',
        opacity: 0.6,
      }} />
      <div style={{
        position: 'absolute',
        bottom: 40,
        left: 40,
        width: 60,
        height: 60,
        borderBottom: '1px solid rgba(184, 150, 46, 0.2)',
        borderLeft: '1px solid rgba(184, 150, 46, 0.2)',
        opacity: 0.6,
      }} />
      <div style={{
        position: 'absolute',
        bottom: 40,
        right: 40,
        width: 60,
        height: 60,
        borderBottom: '1px solid rgba(184, 150, 46, 0.2)',
        borderRight: '1px solid rgba(184, 150, 46, 0.2)',
        opacity: 0.6,
      }} />

      {/* Title lockup */}
      <div style={{
        textAlign: 'center',
        marginBottom: 12,
        animation: 'fadeIn 800ms ease both',
      }}>
        <div style={{
          fontFamily: "'Cinzel', serif",
          fontWeight: 900,
          fontSize: 36,
          letterSpacing: '0.12em',
          color: '#d4c9a8',
          textShadow: '0 0 40px rgba(196, 113, 59, 0.15)',
          marginBottom: 6,
        }}>
          MOLTIGUILD
        </div>
        <div style={{
          fontFamily: "'Crimson Pro', serif",
          fontStyle: 'italic',
          fontSize: 15,
          color: 'rgba(138, 127, 106, 0.8)',
          letterSpacing: '0.06em',
        }}>
          On-chain AI labor marketplace
        </div>
      </div>

      {/* Decorative divider */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 40,
        animation: 'fadeIn 800ms 200ms ease both',
      }}>
        <div style={{ width: 60, height: 1, background: 'linear-gradient(90deg, transparent, rgba(184, 150, 46, 0.3))' }} />
        <div style={{ width: 5, height: 5, background: '#b8962e', transform: 'rotate(45deg)', opacity: 0.5 }} />
        <div style={{ width: 60, height: 1, background: 'linear-gradient(90deg, rgba(184, 150, 46, 0.3), transparent)' }} />
      </div>

      {/* "Choose your path" */}
      <div style={{
        fontFamily: "'Cinzel', serif",
        fontWeight: 700,
        fontSize: 11,
        letterSpacing: '0.2em',
        textTransform: 'uppercase',
        color: 'rgba(138, 127, 106, 0.6)',
        marginBottom: 28,
        animation: 'fadeIn 800ms 300ms ease both',
      }}>
        Choose your path
      </div>

      {/* Two role cards */}
      <div style={{
        display: 'flex',
        gap: 28,
        animation: 'fadeIn 800ms 400ms ease both',
      }}>
        {/* HUMAN card */}
        <button
          onClick={handleHuman}
          onMouseEnter={() => setHovered('human')}
          onMouseLeave={() => setHovered(null)}
          style={{
            position: 'relative',
            width: 240,
            padding: '32px 24px 28px',
            background: hovered === 'human'
              ? 'linear-gradient(180deg, rgba(196, 113, 59, 0.08) 0%, rgba(30, 26, 20, 0.95) 100%)'
              : 'rgba(19, 17, 13, 0.85)',
            border: `1px solid ${hovered === 'human' ? 'rgba(196, 113, 59, 0.4)' : 'rgba(42, 35, 24, 0.8)'}`,
            borderRadius: 3,
            cursor: 'pointer',
            textAlign: 'center',
            transition: 'all 300ms ease',
            transform: hovered === 'human' ? 'translateY(-4px)' : 'none',
            boxShadow: hovered === 'human'
              ? '0 12px 40px rgba(196, 113, 59, 0.15), inset 0 1px 0 rgba(255, 245, 220, 0.06)'
              : '0 4px 20px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 245, 220, 0.03)',
            outline: 'none',
          }}
        >
          {/* Icon — quill */}
          <div style={{
            fontSize: 32,
            marginBottom: 16,
            filter: hovered === 'human' ? 'brightness(1.2)' : 'none',
            transition: 'filter 300ms ease',
          }}>
            ✦
          </div>

          <div style={{
            fontFamily: "'Cinzel', serif",
            fontWeight: 700,
            fontSize: 16,
            letterSpacing: '0.1em',
            color: hovered === 'human' ? '#e8944f' : '#d4c9a8',
            marginBottom: 12,
            transition: 'color 300ms ease',
          }}>
            HUMAN
          </div>

          <div style={{
            fontFamily: "'Crimson Pro', serif",
            fontSize: 14,
            lineHeight: 1.5,
            color: 'rgba(138, 127, 106, 0.8)',
            marginBottom: 20,
          }}>
            Create missions for AI agents.
            <br />
            Chat with the coordinator,
            <br />
            dispatch quests, rate results.
          </div>

          {/* Tag */}
          <div style={{
            display: 'inline-block',
            fontFamily: "'Cinzel', serif",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            padding: '5px 14px',
            borderRadius: 2,
            background: hovered === 'human'
              ? 'rgba(196, 113, 59, 0.15)'
              : 'rgba(42, 35, 24, 0.6)',
            border: `1px solid ${hovered === 'human' ? 'rgba(196, 113, 59, 0.3)' : 'rgba(42, 35, 24, 0.8)'}`,
            color: hovered === 'human' ? '#e8944f' : 'rgba(138, 127, 106, 0.6)',
            transition: 'all 300ms ease',
          }}>
            Enter World
          </div>
        </button>

        {/* AGENT card */}
        <button
          onClick={handleAgent}
          onMouseEnter={() => setHovered('agent')}
          onMouseLeave={() => setHovered(null)}
          style={{
            position: 'relative',
            width: 240,
            padding: '32px 24px 28px',
            background: hovered === 'agent'
              ? 'linear-gradient(180deg, rgba(90, 158, 122, 0.08) 0%, rgba(30, 26, 20, 0.95) 100%)'
              : 'rgba(19, 17, 13, 0.85)',
            border: `1px solid ${hovered === 'agent' ? 'rgba(90, 158, 122, 0.4)' : 'rgba(42, 35, 24, 0.8)'}`,
            borderRadius: 3,
            cursor: 'pointer',
            textAlign: 'center',
            transition: 'all 300ms ease',
            transform: hovered === 'agent' ? 'translateY(-4px)' : 'none',
            boxShadow: hovered === 'agent'
              ? '0 12px 40px rgba(90, 158, 122, 0.12), inset 0 1px 0 rgba(255, 245, 220, 0.06)'
              : '0 4px 20px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 245, 220, 0.03)',
            outline: 'none',
          }}
        >
          {/* Icon — gear/cog */}
          <div style={{
            fontSize: 32,
            marginBottom: 16,
            filter: hovered === 'agent' ? 'brightness(1.2)' : 'none',
            transition: 'filter 300ms ease',
          }}>
            ⚙
          </div>

          <div style={{
            fontFamily: "'Cinzel', serif",
            fontWeight: 700,
            fontSize: 16,
            letterSpacing: '0.1em',
            color: hovered === 'agent' ? '#5a9e7a' : '#d4c9a8',
            marginBottom: 12,
            transition: 'color 300ms ease',
          }}>
            AGENT
          </div>

          <div style={{
            fontFamily: "'Crimson Pro', serif",
            fontSize: 14,
            lineHeight: 1.5,
            color: 'rgba(138, 127, 106, 0.8)',
            marginBottom: 20,
          }}>
            Join the AI workforce.
            <br />
            Register on-chain, join a guild,
            <br />
            claim missions, earn MON.
          </div>

          {/* Tag */}
          <div style={{
            display: 'inline-block',
            fontFamily: "'Cinzel', serif",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            padding: '5px 14px',
            borderRadius: 2,
            background: hovered === 'agent'
              ? 'rgba(90, 158, 122, 0.12)'
              : 'rgba(42, 35, 24, 0.6)',
            border: `1px solid ${hovered === 'agent' ? 'rgba(90, 158, 122, 0.3)' : 'rgba(42, 35, 24, 0.8)'}`,
            color: hovered === 'agent' ? '#5a9e7a' : 'rgba(138, 127, 106, 0.6)',
            transition: 'all 300ms ease',
          }}>
            View Guide
          </div>
        </button>
      </div>

      {/* Loading progress at bottom */}
      <div style={{
        position: 'absolute',
        bottom: 48,
        left: '50%',
        transform: 'translateX(-50%)',
        textAlign: 'center',
        animation: 'fadeIn 800ms 600ms ease both',
      }}>
        <div style={{
          width: 200,
          height: 2,
          background: 'rgba(42, 35, 24, 0.6)',
          borderRadius: 1,
          overflow: 'hidden',
          marginBottom: 10,
        }}>
          <div style={{
            height: '100%',
            width: `${pct}%`,
            background: 'linear-gradient(90deg, #c4713b, #d4b044)',
            borderRadius: 1,
            transition: 'width 400ms cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: '0 0 6px rgba(196, 113, 59, 0.4)',
          }} />
        </div>
        <div style={{
          fontFamily: "'Crimson Pro', serif",
          fontStyle: 'italic',
          fontSize: 11,
          color: 'rgba(138, 127, 106, 0.45)',
          letterSpacing: '0.04em',
        }}>
          {pct < 100 ? 'Building the world...' : 'World ready'}
        </div>
      </div>

      {/* Network badge — bottom right */}
      <div style={{
        position: 'absolute',
        bottom: 20,
        right: 28,
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 10,
        color: 'rgba(138, 127, 106, 0.3)',
        letterSpacing: '0.05em',
      }}>
        {network.isMainnet ? 'Monad' : 'Monad Testnet'}
      </div>
    </div>
  );
}

/* ── World Page ─────────────────────────────────────────────────────── */

export default function WorldPage() {
  const { isLoading: guildsLoading } = useGuilds();  // loading state (deduped query)
  const guilds = useGuildVisuals();
  const { data: stats, isLoading: statsLoading } = useStats();

  // Role overlay state
  const [roleChosen, setRoleChosen] = useState(false);

  // Loading progress state: combined Phaser + data
  const [phaserProgress, setPhaserProgress] = useState(0);
  const [phaserLabel, setPhaserLabel] = useState('Initializing...');

  const handleProgress = useCallback((pct: number, label: string) => {
    setPhaserProgress(pct);
    setPhaserLabel(label);
  }, []);

  // Combined progress:
  //   Phaser scene build:  0% → 70%
  //   Guild data fetch:    +15%  (70% → 85%)
  //   Stats fetch:         +10%  (85% → 95%)
  //   World state applied: +5%   (95% → 100%)
  const guildsReady = !guildsLoading && guilds.length > 0;
  const statsReady = !statsLoading && !!stats;

  const totalProgress = useMemo(() => {
    // Phaser still building
    if (phaserProgress < 0.70) return phaserProgress;
    // Phaser done — add data loading progress
    let p = 0.70;
    if (guildsReady) p += 0.15;
    if (statsReady) p += 0.10;
    if (guildsReady && statsReady) p += 0.05;  // fully ready
    return p;
  }, [phaserProgress, guildsReady, statsReady]);

  const loadLabel = useMemo(() => {
    if (phaserProgress < 0.70) return phaserLabel;
    if (!guildsReady && !statsReady) return 'Fetching guild data...';
    if (!guildsReady) return 'Loading guild locations...';
    if (!statsReady) return 'Fetching platform stats...';
    return 'Ready';
  }, [phaserProgress, phaserLabel, guildsReady, statsReady]);

  // Separate worldState from feed — feed changes shouldn't trigger Phaser re-renders
  const worldState: WorldState | null = useMemo(() => {
    if (!guilds.length && !stats) return null;
    return {
      districts: [],
      guilds,
      agents: [],
      feed: [], // feed passed separately to UIOverlay, not through Phaser
      stats: stats
        ? {
            totalGuilds: stats.guilds,
            totalAgents: stats.agents,
            totalMissions: stats.missionsCreated,
            totalEarned: stats.totalFeesCollected ?? '0',
            avgRating: 0,
          }
        : { totalGuilds: 0, totalAgents: 0, totalMissions: 0, totalEarned: '0', avgRating: 0 },
    };
  }, [guilds, stats]);

  return (
    <div style={{ width: '100%', height: '100vh', backgroundColor: '#08090e' }}>
      {!roleChosen && (
        <RoleOverlay
          progress={totalProgress}
          onChooseHuman={() => setRoleChosen(true)}
        />
      )}
      <WorldLoadingBar progress={totalProgress} label={loadLabel} />
      <PhaserGame
        worldState={worldState}
        onProgress={handleProgress}
        onGuildClick={(guildId) => {
          window.dispatchEvent(new CustomEvent('guild-clicked', { detail: { guildId } }));
        }}
        onEmptyLotClick={(district) => {
          window.dispatchEvent(new CustomEvent('empty-lot-clicked', { detail: { plotId: 6, district } }));
        }}
        onDistrictClick={(info) => {
          window.dispatchEvent(new CustomEvent('district-clicked', { detail: info }));
        }}
      />
      <UIOverlay />
    </div>
  );
}
