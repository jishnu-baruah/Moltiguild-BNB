'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useCredits, useUser } from '@/lib/hooks';
import { useNetwork } from '@/lib/network';

interface HeaderProps {
  onToggleSidebar: () => void;
  onBack?: () => void;
  showBack?: boolean;
  onOpenDeposit?: () => void;
}

export default function Header({ onToggleSidebar, onBack, showBack, onOpenDeposit }: HeaderProps) {
  const { data: credits, isLoading: creditsLoading } = useCredits();
  const { isWallet } = useUser();
  const network = useNetwork();
  const showBalance = true; // Always show on testnet
  const displayBalance = creditsLoading ? '...' : (credits ? credits.raw.toFixed(4) : '0.0000');

  return (
    <header
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 52,
        background: 'linear-gradient(180deg, #1a1610, #0f0d09)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(196, 113, 59, 0.3)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        zIndex: 100,
        pointerEvents: 'auto',
      }}
    >
      {/* Left: Brand + Back */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <span
          style={{
            fontFamily: "'Cinzel', serif",
            fontWeight: 900,
            fontSize: 16,
            letterSpacing: '0.2em',
            color: 'var(--ember)',
            cursor: 'default',
            userSelect: 'none',
          }}
        >
          MOLTIGUILD
        </span>

        {showBack && (
          <button
            onClick={onBack}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--parchment-dim)',
              fontFamily: "'Crimson Pro', serif",
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              transition: 'color 150ms ease',
              padding: '4px 8px',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--ember-glow)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--parchment-dim)')}
          >
            &#9664; Overview
          </button>
        )}
      </div>

      {/* Right: Wallet + Balance + Network + Sidebar toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {/* tBNB Balance (credits from API) */}
        {showBalance ? (
          <span
            className="font-mono"
            style={{
              background: 'none',
              border: 'none',
              fontSize: 14,
              color: 'var(--gold)',
              animation: 'coinPulse 3s ease-in-out infinite',
              fontWeight: 500,
              padding: '4px 8px',
              borderRadius: 2,
            }}
          >
            &#x2B21; {displayBalance} tBNB
          </span>
        ) : null}

        {/* Network badge */}
        <span
          style={{
            background: 'rgba(196, 113, 59, 0.1)',
            border: '1px solid var(--parchment-dim)',
            borderRadius: 3,
            padding: '3px 10px',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--ember)',
              boxShadow: '0 0 4px var(--ember)',
            }}
          />
          <span
            style={{
              fontSize: 9,
              fontFamily: "'Crimson Pro', serif",
              color: 'var(--parchment-dim)',
              letterSpacing: '0.1em',
              fontWeight: 600,
            }}
          >
            BNB TESTNET
          </span>
        </span>

        {/* RainbowKit Wallet Button */}
        <ConnectButton.Custom>
          {({ account, chain, openConnectModal, openAccountModal, openChainModal, mounted }) => {
            const connected = mounted && account && chain;

            return (
              <div
                {...(!mounted && {
                  'aria-hidden': true,
                  style: { opacity: 0, pointerEvents: 'none', userSelect: 'none' },
                })}
              >
                {(() => {
                  if (!connected) {
                    return (
                      <button
                        onClick={openConnectModal}
                        style={{
                          background: 'transparent',
                          border: '1px solid var(--ember)',
                          color: 'var(--ember)',
                          fontFamily: "'Cinzel', serif",
                          fontWeight: 700,
                          fontSize: 11,
                          letterSpacing: '0.1em',
                          padding: '6px 14px',
                          borderRadius: 2,
                          cursor: 'pointer',
                          transition: 'all 150ms ease',
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.background = 'rgba(196, 113, 59, 0.15)';
                          e.currentTarget.style.color = 'var(--ember-glow)';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = 'transparent';
                          e.currentTarget.style.color = 'var(--ember)';
                        }}
                      >
                        CONNECT
                      </button>
                    );
                  }

                  if (chain.unsupported) {
                    return (
                      <button
                        onClick={openChainModal}
                        style={{
                          background: 'rgba(139, 58, 58, 0.2)',
                          border: '1px solid var(--wine)',
                          color: 'var(--wine)',
                          fontFamily: "'Crimson Pro', serif",
                          fontSize: 12,
                          padding: '6px 12px',
                          borderRadius: 2,
                          cursor: 'pointer',
                        }}
                      >
                        Wrong network
                      </button>
                    );
                  }

                  return (
                    <button
                      onClick={openAccountModal}
                      className="font-mono"
                      style={{
                        background: 'transparent',
                        border: '1px solid var(--walnut-border)',
                        color: 'var(--parchment-dim)',
                        fontSize: 13,
                        padding: '5px 12px',
                        borderRadius: 2,
                        cursor: 'pointer',
                        transition: 'all 150ms ease',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.borderColor = 'var(--ember)';
                        e.currentTarget.style.color = 'var(--parchment)';
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.borderColor = 'var(--walnut-border)';
                        e.currentTarget.style.color = 'var(--parchment-dim)';
                      }}
                    >
                      <span style={{ color: 'var(--verdigris)', fontSize: 8 }}>&#9679;</span>
                      {account.displayName}
                      {account.displayBalance && (
                        <span style={{ color: 'var(--parchment-dim)', fontSize: 11 }}>
                          {account.displayBalance}
                        </span>
                      )}
                    </button>
                  );
                })()}
              </div>
            );
          }}
        </ConnectButton.Custom>

        {/* Sidebar Toggle */}
        <button
          onClick={onToggleSidebar}
          style={{
            background: 'transparent',
            border: '1px solid var(--walnut-border)',
            color: 'var(--parchment-dim)',
            fontSize: 18,
            cursor: 'pointer',
            padding: '4px 10px',
            borderRadius: 2,
            transition: 'all 150ms ease',
            lineHeight: 1,
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'var(--ember)';
            e.currentTarget.style.color = 'var(--ember)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'var(--walnut-border)';
            e.currentTarget.style.color = 'var(--parchment-dim)';
          }}
          aria-label="Toggle sidebar"
        >
          &#9776;
        </button>
      </div>
    </header>
  );
}
