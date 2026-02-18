'use client';

import { useState } from 'react';
import { useStats, useCredits, useSSEFeed, useOnlineAgents, useUser, useContractBalance, useDepositFunds, useWithdrawFunds } from '@/lib/hooks';
import { timeAgo, truncateAddress } from '@/lib/utils';
import { formatEther } from 'viem';
import { useNetwork } from '@/lib/network';
import type { FeedEvent } from '@/lib/world-state';

interface StatsSidebarProps {
  open: boolean;
}

const FEED_COLORS: Record<string, string> = {
  mission_completed: 'var(--verdigris)',
  mission_rated: 'var(--gold)',
  mission_created: 'var(--ember)',
  mission_claimed: 'var(--indigo)',
  guild_created: 'var(--plum)',
  agent_registered: 'var(--indigo)',
};

function feedLabel(e: FeedEvent): string {
  switch (e.type) {
    case 'mission_completed':
      return e.paid
        ? `Mission #${e.missionId} done \u2014 ${e.paid} MON`
        : `Mission #${e.missionId} done`;
    case 'mission_rated':
      return `Rating ${'★'.repeat(e.score || 0)} #${e.missionId}`;
    case 'mission_created':
      return e.budget
        ? `Mission #${e.missionId} \u2014 ${e.budget} MON`
        : `Mission #${e.missionId} created`;
    case 'mission_claimed':
      return e.agent
        ? `Agent ${truncateAddress(e.agent)} claimed #${e.missionId}`
        : `Mission #${e.missionId} claimed`;
    case 'guild_created':
      return `Guild #${e.guildId} founded`;
    case 'agent_registered':
      return `Agent joined guild #${e.guildId}`;
    default:
      return e.type;
  }
}

export default function StatsSidebar({ open }: StatsSidebarProps) {
  const { data: stats } = useStats();
  const { data: credits } = useCredits();
  const { data: onlineAgents } = useOnlineAgents();
  const { isWallet } = useUser();
  const feed = useSSEFeed();
  const network = useNetwork();

  const onlineCount = onlineAgents?.length ?? 0;
  const balance = credits ? credits.raw.toFixed(4) : '0.0000';
  const missionsRemaining = credits ? Math.floor(credits.raw / 0.001) : 0;

  return (
    <div
      className="panel"
      style={{
        position: 'fixed',
        top: 52,
        left: 0,
        bottom: 0,
        width: 280,
        zIndex: 90,
        pointerEvents: 'auto',
        transform: open ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 400ms cubic-bezier(0.16, 1, 0.3, 1)',
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '16px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      {/* PLATFORM STATS */}
      <div className="section-header">Platform</div>

      <StatRow label="Guilds" value={String(stats?.guilds ?? 0)} />
      <StatRow label="Missions" value={String(stats?.missionsCreated ?? 0)} />
      <StatRow label="Completed" value={String(stats?.missionsCompleted ?? 0)} />
      <StatRow label="Agents" value={String(stats?.agents ?? 0)} />
      <StatRow label="Online" value={String(onlineCount)} showDot={onlineCount > 0} />

      {/* ACTIVITY FEED */}
      <div className="section-header" style={{ marginTop: 8 }}>Activity</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {feed.map((event, i) => {
          const color = FEED_COLORS[event.type] || 'var(--parchment-dim)';
          const label = feedLabel(event);

          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 0 6px 10px',
                borderLeft: `2px solid ${color}`,
                animation: `feedSlide 200ms ease ${i * 50}ms both`,
              }}
            >
              <span
                style={{
                  fontFamily: "'Crimson Pro', serif",
                  fontSize: 13,
                  color: 'var(--parchment)',
                }}
              >
                {label}
              </span>
              <span
                className="font-mono"
                style={{
                  fontSize: 11,
                  color: 'var(--parchment-dim)',
                  flexShrink: 0,
                  marginLeft: 8,
                }}
              >
                {timeAgo(event.timestamp)}
              </span>
            </div>
          );
        })}
      </div>

      {/* YOUR PURSE */}
      <div className="section-header" style={{ marginTop: 8 }}>Your Purse</div>

      {/* API Credits */}
      <div
        style={{
          fontFamily: "'Crimson Pro', serif",
          fontSize: 12,
          color: 'var(--parchment-dim)',
          letterSpacing: '0.06em',
          marginBottom: 2,
        }}
      >
        API CREDITS
      </div>
      <div
        className="font-mono"
        style={{
          fontSize: 18,
          fontWeight: 500,
          color: 'var(--gold)',
          textShadow: '0 0 8px var(--glow-gold)',
          padding: '2px 0',
        }}
      >
        &#x2B21; {balance} MON
      </div>
      <div
        style={{
          fontFamily: "'Crimson Pro', serif",
          fontSize: 13,
          color: 'var(--parchment-dim)',
          fontStyle: 'italic',
          marginBottom: 8,
        }}
      >
        ~{missionsRemaining} missions remaining
      </div>
      {missionsRemaining < 10 && (
        <div
          style={{
            fontFamily: "'Crimson Pro', serif",
            fontSize: 12,
            color: 'var(--ember)',
            fontStyle: 'italic',
            marginBottom: 4,
          }}
        >
          {network.isMainnet ? 'Deposit MON to fund missions' : 'Send MON to coordinator to top up'}
        </div>
      )}

      {/* On-Chain Balance */}
      {isWallet ? (
        <OnChainWallet />
      ) : (
        <div
          style={{
            fontFamily: "'Crimson Pro', serif",
            fontSize: 13,
            color: 'var(--parchment-dim)',
            fontStyle: 'italic',
            borderTop: '1px solid var(--walnut-border)',
            paddingTop: 8,
          }}
        >
          Connect wallet for on-chain operations
        </div>
      )}
    </div>
  );
}

/* ── On-Chain Wallet Controls ─────────────────────────────────────── */

function OnChainWallet() {
  const { data: rawBalance } = useContractBalance();
  const depositHook = useDepositFunds();
  const withdrawHook = useWithdrawFunds();
  const network = useNetwork();

  const [mode, setMode] = useState<'idle' | 'deposit' | 'withdraw'>('idle');
  const [amount, setAmount] = useState('');

  const contractBalance = rawBalance != null ? formatEther(rawBalance as bigint) : '0';

  const handleConfirm = () => {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return;
    if (mode === 'deposit') {
      depositHook.deposit(amount);
    } else if (mode === 'withdraw') {
      withdrawHook.withdraw(amount);
    }
    setAmount('');
    setMode('idle');
  };

  const isPending = depositHook.isPending || withdrawHook.isPending;
  const isConfirming = depositHook.isConfirming || withdrawHook.isConfirming;
  const isSuccess = depositHook.isSuccess || withdrawHook.isSuccess;
  const txHash = depositHook.hash || withdrawHook.hash;
  const txError = depositHook.error || withdrawHook.error;

  return (
    <div style={{ borderTop: '1px solid var(--walnut-border)', paddingTop: 8 }}>
      <div
        style={{
          fontFamily: "'Crimson Pro', serif",
          fontSize: 12,
          color: 'var(--parchment-dim)',
          letterSpacing: '0.06em',
          marginBottom: 2,
        }}
      >
        ON-CHAIN BALANCE
      </div>
      <div
        className="font-mono"
        style={{
          fontSize: 16,
          fontWeight: 500,
          color: 'var(--verdigris)',
          textShadow: '0 0 6px rgba(0, 180, 160, 0.3)',
          padding: '2px 0',
          marginBottom: 6,
        }}
      >
        &#x2B21; {Number(contractBalance).toFixed(4)} MON
      </div>

      {/* Action buttons */}
      {mode === 'idle' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn-solid"
            style={{ flex: 1, fontSize: 12, padding: '4px 8px' }}
            onClick={() => setMode('deposit')}
            disabled={isPending || isConfirming}
          >
            Deposit
          </button>
          <button
            className="btn-solid"
            style={{ flex: 1, fontSize: 12, padding: '4px 8px' }}
            onClick={() => setMode('withdraw')}
            disabled={isPending || isConfirming}
          >
            Withdraw
          </button>
        </div>
      )}

      {/* Inline amount input */}
      {(mode === 'deposit' || mode === 'withdraw') && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            className="input-field"
            type="text"
            placeholder="0.01"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleConfirm(); }}
            style={{ flex: 1, fontSize: 13, padding: '4px 8px' }}
            autoFocus
          />
          <button
            className="btn-solid"
            style={{ fontSize: 12, padding: '4px 10px' }}
            onClick={handleConfirm}
          >
            {mode === 'deposit' ? 'Deposit' : 'Withdraw'}
          </button>
          <button
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--parchment-dim)',
              cursor: 'pointer',
              fontSize: 14,
              padding: '2px 4px',
            }}
            onClick={() => { setMode('idle'); setAmount(''); }}
          >
            &#10005;
          </button>
        </div>
      )}

      {/* Tx status */}
      {isPending && (
        <TxStatus color="var(--gold)" text="Confirm in wallet..." />
      )}
      {isConfirming && (
        <TxStatus color="var(--ember)" text="Confirming on-chain..." />
      )}
      {isSuccess && txHash && (
        <TxStatus color="var(--verdigris)">
          Confirmed{' '}
          <a
            href={`${network.explorerUrl}/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono"
            style={{ color: 'var(--indigo)', fontSize: 11 }}
          >
            View tx
          </a>
        </TxStatus>
      )}
      {txError && (
        <TxStatus color="#f87171" text={txError instanceof Error ? txError.message : 'Transaction failed'} />
      )}
    </div>
  );
}

/* ── Helpers ──────────────────────────────────────────────────────── */

function TxStatus({ color, text, children }: { color: string; text?: string; children?: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "'Crimson Pro', serif",
        fontSize: 12,
        color,
        marginTop: 4,
        animation: 'coinPulse 2s ease-in-out infinite',
      }}
    >
      {text ?? children}
    </div>
  );
}

function StatRow({ label, value, showDot }: { label: string; value: string; showDot?: boolean }) {
  return (
    <div className="dot-leader">
      <span>{label}</span>
      <span className="dot-leader-value">
        {value}
        {showDot && (
          <>
            {' '}
            <span className="online-dot" />
          </>
        )}
      </span>
    </div>
  );
}
