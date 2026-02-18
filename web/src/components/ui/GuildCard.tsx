'use client';

import type { GuildVisual } from '@/lib/world-state';
import type { MissionData } from '@/lib/api';
import { useGuildAgents, useMissionsByGuild, useOnlineAgents } from '@/lib/hooks';
import { timeAgo, truncateAddress } from '@/lib/utils';

interface GuildCardProps {
  guild: GuildVisual;
  onClose: () => void;
  onNewQuest: () => void;
  onAddAgent: () => void;
}

export default function GuildCard({ guild, onClose, onNewQuest, onAddAgent }: GuildCardProps) {
  const { data: agents } = useGuildAgents(guild.guildId);
  const { data: missions } = useMissionsByGuild(guild.guildId);
  const { data: onlineAgents } = useOnlineAgents();

  const onlineSet = new Set(onlineAgents?.map(a => a.address.toLowerCase()) ?? []);
  const agentList = agents ?? guild.agents.map(a => ({ address: a.address }));
  const missionList = missions?.slice(0, 3) ?? [];

  return (
    <>
      {/* Backdrop + centering */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(8,9,14,0.6)',
          backdropFilter: 'blur(8px)',
          zIndex: 109,
          pointerEvents: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >

      {/* Card */}
      <div
        className="panel"
        onClick={e => e.stopPropagation()}
        style={{
          width: 380,
          maxHeight: 'calc(100vh - 120px)',
          overflowY: 'auto',
          pointerEvents: 'auto',
          animation: 'unfurl 300ms ease-out both',
          transformOrigin: 'top center',
          padding: '20px 24px',
        }}
      >
        {/* Title */}
        <div style={{ marginBottom: 4 }}>
          <h2
            className="font-display"
            style={{
              fontSize: 18,
              color: 'var(--parchment)',
              margin: 0,
              lineHeight: 1.3,
            }}
          >
            {guild.name}
          </h2>
          <span
            style={{
              fontFamily: "'Crimson Pro', serif",
              fontStyle: 'italic',
              fontSize: 13,
              color: 'var(--parchment-dim)',
            }}
          >
            {guild.category}
          </span>
        </div>

        {/* Stats row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '10px 0',
            fontSize: 14,
            fontFamily: "'Crimson Pro', serif",
          }}
        >
          <span style={{ color: 'var(--gold)' }}>
            {'★'.repeat(Math.floor(guild.avgRating))}
            {'☆'.repeat(5 - Math.floor(guild.avgRating))}
            {' '}
            <span className="font-mono" style={{ fontSize: 13 }}>{guild.avgRating.toFixed(1)}</span>
          </span>
          <span style={{ color: 'var(--parchment-dim)' }}>
            {guild.totalMissions} done
          </span>
          <span style={{ color: 'var(--parchment-dim)' }}>
            {agentList.length} agents
          </span>
        </div>

        {/* Divider */}
        <Divider />

        {/* Agents */}
        <div className="section-header">Agents</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {agentList.length === 0 && (
            <div style={{ fontFamily: "'Crimson Pro', serif", fontSize: 13, color: 'var(--parchment-dim)', fontStyle: 'italic' }}>
              No agents registered yet
            </div>
          )}
          {agentList.map(agent => {
            const isOnline = onlineSet.has(agent.address.toLowerCase());
            return (
              <div
                key={agent.address}
                style={{
                  background: 'var(--walnut-light)',
                  border: '1px solid var(--walnut-border)',
                  borderRadius: 2,
                  padding: '10px 12px',
                }}
              >
                <div
                  className="font-mono"
                  style={{ fontSize: 13, color: 'var(--parchment)', marginBottom: 4 }}
                >
                  {truncateAddress(agent.address)}
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    fontSize: 13,
                    fontFamily: "'Crimson Pro', serif",
                    color: 'var(--parchment-dim)',
                  }}
                >
                  <span>
                    {isOnline ? (
                      <><span className="online-dot" style={{ marginRight: 6 }} /> Online</>
                    ) : (
                      'Offline'
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Recent Quests */}
        <Divider />
        <div className="section-header">Recent Quests</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {missionList.length === 0 && (
            <div style={{ fontFamily: "'Crimson Pro', serif", fontSize: 13, color: 'var(--parchment-dim)', fontStyle: 'italic' }}>
              No quests yet
            </div>
          )}
          {missionList.map((m: MissionData) => {
            const ts = m.timestamp_ ? Number(m.timestamp_) * 1000 : 0;
            return (
              <div key={m.missionId}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontFamily: "'Crimson Pro', serif",
                    fontSize: 14,
                    color: 'var(--parchment)',
                  }}
                >
                  <span>Quest #{m.missionId}</span>
                  <span
                    style={{
                      fontSize: 11,
                      color: m.completed ? 'var(--gold)' : m.claimed ? 'var(--verdigris)' : 'var(--ember)',
                    }}
                  >
                    {m.completed
                      ? m.rated ? `Done ★${m.rating}` : 'Done'
                      : m.claimed ? 'Claimed' : 'Open'}
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                  }}
                >
                  {ts > 0 && (
                    <span className="font-mono" style={{ fontSize: 11, color: 'var(--parchment-dim)' }}>
                      {timeAgo(ts)}
                    </span>
                  )}
                  {m.client && (
                    <span className="font-mono" style={{ fontSize: 11, color: 'var(--parchment-dim)' }}>
                      by {truncateAddress(m.client)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button className="btn-outline" style={{ flex: 1 }}>
            View Result
          </button>
          <button className="btn-outline" style={{ flex: 1 }} onClick={onNewQuest}>
            + New Quest
          </button>
          <button className="btn-outline" style={{ flex: '1 1 100%' }} onClick={onAddAgent}>
            + Add Agent
          </button>
        </div>
      </div>
      </div>
    </>
  );
}

function Divider() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 0',
        color: 'var(--walnut-border)',
        fontSize: 12,
        userSelect: 'none',
      }}
    >
      <span style={{ flex: 1, height: 1, background: 'var(--walnut-border)' }} />
      <span>&#9670;</span>
      <span style={{ flex: 1, height: 1, background: 'var(--walnut-border)' }} />
    </div>
  );
}
