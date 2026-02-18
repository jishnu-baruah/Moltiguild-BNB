'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useCredits, useUser } from '@/lib/hooks';
import { useNetwork, switchNetwork } from '@/lib/network';
import { disconnectSSE } from '@/lib/sse';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

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
  const queryClient = useQueryClient();
  const hasCredits = credits && credits.raw > 0;
  // On mainnet, only show balance if user has credits or wallet connected
  // On testnet, always show (auto-granted)
  const showBalance = hasCredits || isWallet || !network.isMainnet;
  const displayBalance = creditsLoading ? '...' : (credits ? credits.raw.toFixed(4) : '0.0000');

  const handleNetworkSwitch = useCallback(() => {
    const nextKey = network.key === 'mainnet' ? 'testnet' : 'mainnet';
    // Disconnect SSE so it reconnects to the new API
    disconnectSSE();
    // Switch the network store
    switchNetwork(nextKey);
    // Invalidate all queries so they refetch from new API
    queryClient.invalidateQueries();
  }, [network.key, queryClient]);

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
        {/* MON Balance (credits from API) */}
        {showBalance ? (
          <button
            className="font-mono"
            onClick={network.isMainnet ? onOpenDeposit : undefined}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 14,
              color: 'var(--gold)',
              animation: 'coinPulse 3s ease-in-out infinite',
              fontWeight: 500,
              cursor: network.isMainnet ? 'pointer' : 'default',
              padding: '4px 8px',
              borderRadius: 2,
              transition: 'all 150ms ease',
            }}
            onMouseEnter={e => {
              if (network.isMainnet) e.currentTarget.style.background = 'rgba(184,150,46,0.1)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'none';
            }}
            title={network.isMainnet ? 'Deposit MON' : undefined}
          >
            &#x2B21; {displayBalance} MON
          </button>
        ) : (
          <button
            onClick={onOpenDeposit}
            style={{
              background: 'rgba(196,113,59,0.08)',
              border: '1px solid rgba(196,113,59,0.25)',
              fontSize: 11,
              fontFamily: "'Crimson Pro', serif",
              color: 'var(--ember)',
              fontStyle: 'italic',
              cursor: 'pointer',
              padding: '4px 12px',
              borderRadius: 2,
              transition: 'all 150ms ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(196,113,59,0.15)';
              e.currentTarget.style.borderColor = 'var(--ember)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(196,113,59,0.08)';
              e.currentTarget.style.borderColor = 'rgba(196,113,59,0.25)';
            }}
          >
            &#x1F4B0; Deposit to start
          </button>
        )}

        {/* Network Switcher */}
        <button
          onClick={handleNetworkSwitch}
          style={{
            background: network.isMainnet
              ? 'rgba(0, 180, 160, 0.1)'
              : 'rgba(196, 113, 59, 0.1)',
            border: `1px solid ${network.isMainnet ? 'var(--verdigris)' : 'var(--parchment-dim)'}`,
            borderRadius: 3,
            padding: '3px 10px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            transition: 'all 150ms ease',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.opacity = '0.8';
            e.currentTarget.style.transform = 'scale(1.02)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.opacity = '1';
            e.currentTarget.style.transform = 'scale(1)';
          }}
          title={`Switch to ${network.key === 'mainnet' ? 'Testnet' : 'Mainnet'}`}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: network.isMainnet ? 'var(--verdigris)' : 'var(--ember)',
              boxShadow: network.isMainnet
                ? '0 0 4px var(--verdigris)'
                : '0 0 4px var(--ember)',
            }}
          />
          <span
            style={{
              fontSize: 9,
              fontFamily: "'Crimson Pro', serif",
              color: network.isMainnet ? 'var(--verdigris)' : 'var(--parchment-dim)',
              letterSpacing: '0.1em',
              fontWeight: 600,
            }}
          >
            {network.isMainnet ? 'MAINNET' : 'TESTNET'}
          </span>
          <span style={{ fontSize: 8, color: 'var(--parchment-dim)', opacity: 0.6 }}>&#9662;</span>
        </button>

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
