'use client';

import { useState, useEffect, useCallback } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { formatEther } from 'viem';
import { useDepositFunds, useContractBalance, useCredits, useUser } from '@/lib/hooks';
import { useNetwork } from '@/lib/network';
import * as api from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';

interface DepositModalProps {
  onClose: () => void;
}

const PRESETS = ['0.01', '0.05', '0.1', '0.5'];

export default function DepositModal({ onClose }: DepositModalProps) {
  const { isConnected } = useAccount();
  const { userId } = useUser();
  const { data: credits } = useCredits();
  const { data: rawBalance } = useContractBalance();
  const { deposit, hash, isPending, isConfirming, isSuccess, error, reset } = useDepositFunds();
  const network = useNetwork();
  const queryClient = useQueryClient();

  const [amount, setAmount] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState<{ credited: string; totalCredits: string } | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const contractBalance = rawBalance != null ? formatEther(rawBalance as bigint) : '0';
  const apiCredits = credits?.raw ?? 0;
  const missionsAvailable = Math.floor(apiCredits / 0.001);

  // Auto-verify payment after on-chain success
  useEffect(() => {
    if (isSuccess && hash && !verified && !verifying) {
      setVerifying(true);
      api.verifyPayment(hash, userId)
        .then((result) => {
          setVerified(result);
          setVerifying(false);
          // Refresh credits
          queryClient.invalidateQueries({ queryKey: ['credits'] });
        })
        .catch((err) => {
          setVerifyError(err instanceof Error ? err.message : 'Verification failed');
          setVerifying(false);
        });
    }
  }, [isSuccess, hash, verified, verifying, userId, queryClient]);

  const handleDeposit = useCallback(() => {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return;
    setVerified(null);
    setVerifyError(null);
    reset();
    deposit(amount);
  }, [amount, deposit, reset]);

  const handleNewDeposit = useCallback(() => {
    setAmount('');
    setVerified(null);
    setVerifyError(null);
    reset();
  }, [reset]);

  const isBusy = isPending || isConfirming || verifying;

  // Determine the step for the progress visualization
  const step = verified ? 3 : (isConfirming || verifying) ? 2 : isPending ? 1 : 0;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(8,9,14,0.75)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          zIndex: 200,
          pointerEvents: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Modal */}
        <div
          onClick={e => e.stopPropagation()}
          style={{
            width: 440,
            maxHeight: 'calc(100vh - 80px)',
            overflowY: 'auto',
            pointerEvents: 'auto',
            animation: 'modalReveal 250ms ease-out both',
            background: 'linear-gradient(180deg, #1a1610 0%, #0f0d09 100%)',
            border: '1px solid var(--walnut-border)',
            borderRadius: 2,
            boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 1px rgba(196,113,59,0.3), inset 0 1px 0 rgba(196,113,59,0.08)',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 24px',
              borderBottom: '1px solid var(--walnut-border)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>&#x1F3E6;</span>
              <span
                style={{
                  fontFamily: "'Cinzel', serif",
                  fontWeight: 700,
                  fontSize: 15,
                  color: 'var(--parchment)',
                  letterSpacing: '0.08em',
                }}
              >
                GUILD TREASURY
              </span>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--parchment-dim)',
                cursor: 'pointer',
                fontSize: 18,
                padding: '2px 6px',
                transition: 'color 150ms',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--parchment)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--parchment-dim)')}
            >
              &#10005;
            </button>
          </div>

          {/* Body */}
          <div style={{ padding: '20px 24px' }}>
            {/* Not connected state */}
            {!isConnected ? (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div
                  style={{
                    fontSize: 40,
                    marginBottom: 16,
                    opacity: 0.6,
                    filter: 'grayscale(0.5)',
                  }}
                >
                  &#x1F512;
                </div>
                <div
                  style={{
                    fontFamily: "'Crimson Pro', serif",
                    fontSize: 16,
                    color: 'var(--parchment)',
                    marginBottom: 8,
                  }}
                >
                  Connect your wallet to deposit tBNB
                </div>
                <div
                  style={{
                    fontFamily: "'Crimson Pro', serif",
                    fontSize: 13,
                    color: 'var(--parchment-dim)',
                    marginBottom: 20,
                    lineHeight: 1.5,
                  }}
                >
                  Deposit funds to the guild treasury to create quests.
                  <br />
                  Each mission costs 0.001 tBNB.
                </div>
                <ConnectButton />
              </div>
            ) : (
              <>
                {/* Balances */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 12,
                    marginBottom: 20,
                  }}
                >
                  {/* API Credits */}
                  <div
                    style={{
                      background: 'rgba(184,150,46,0.06)',
                      border: '1px solid rgba(184,150,46,0.15)',
                      borderRadius: 2,
                      padding: '12px 14px',
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "'Crimson Pro', serif",
                        fontSize: 11,
                        color: 'var(--parchment-dim)',
                        letterSpacing: '0.08em',
                        marginBottom: 4,
                      }}
                    >
                      QUEST CREDITS
                    </div>
                    <div
                      className="font-mono"
                      style={{
                        fontSize: 18,
                        fontWeight: 600,
                        color: 'var(--gold)',
                        animation: 'coinPulse 3s ease-in-out infinite',
                      }}
                    >
                      &#x2B21; {apiCredits.toFixed(4)}
                    </div>
                    <div
                      style={{
                        fontFamily: "'Crimson Pro', serif",
                        fontSize: 12,
                        color: 'var(--parchment-dim)',
                        marginTop: 2,
                      }}
                    >
                      ~{missionsAvailable} missions
                    </div>
                  </div>

                  {/* On-chain Balance */}
                  <div
                    style={{
                      background: 'rgba(90,158,122,0.06)',
                      border: '1px solid rgba(90,158,122,0.15)',
                      borderRadius: 2,
                      padding: '12px 14px',
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "'Crimson Pro', serif",
                        fontSize: 11,
                        color: 'var(--parchment-dim)',
                        letterSpacing: '0.08em',
                        marginBottom: 4,
                      }}
                    >
                      ON-CHAIN
                    </div>
                    <div
                      className="font-mono"
                      style={{
                        fontSize: 18,
                        fontWeight: 600,
                        color: 'var(--verdigris)',
                        textShadow: '0 0 6px rgba(0,180,160,0.3)',
                      }}
                    >
                      &#x2B21; {Number(contractBalance).toFixed(4)}
                    </div>
                    <div
                      style={{
                        fontFamily: "'Crimson Pro', serif",
                        fontSize: 12,
                        color: 'var(--parchment-dim)',
                        marginTop: 2,
                      }}
                    >
                      in contract
                    </div>
                  </div>
                </div>

                {/* Deposit form — only show if no active transaction */}
                {!isBusy && !verified && (
                  <>
                    {/* Amount input */}
                    <div style={{ marginBottom: 12 }}>
                      <label
                        style={{
                          fontFamily: "'Crimson Pro', serif",
                          fontSize: 13,
                          color: 'var(--parchment-dim)',
                          display: 'block',
                          marginBottom: 6,
                        }}
                      >
                        Deposit amount (tBNB)
                      </label>
                      <input
                        className="input-field"
                        type="text"
                        placeholder="0.05"
                        value={amount}
                        onChange={e => setAmount(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleDeposit(); }}
                        style={{
                          width: '100%',
                          fontSize: 20,
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontWeight: 500,
                          padding: '12px 14px',
                          boxSizing: 'border-box',
                        }}
                        autoFocus
                      />
                    </div>

                    {/* Preset amounts */}
                    <div
                      style={{
                        display: 'flex',
                        gap: 8,
                        marginBottom: 16,
                      }}
                    >
                      {PRESETS.map(p => (
                        <button
                          key={p}
                          onClick={() => setAmount(p)}
                          style={{
                            flex: 1,
                            background: amount === p ? 'rgba(196,113,59,0.15)' : 'rgba(255,255,255,0.03)',
                            border: `1px solid ${amount === p ? 'var(--ember)' : 'var(--walnut-border)'}`,
                            color: amount === p ? 'var(--ember-glow)' : 'var(--parchment-dim)',
                            fontFamily: "'IBM Plex Mono', monospace",
                            fontSize: 13,
                            padding: '6px 0',
                            borderRadius: 2,
                            cursor: 'pointer',
                            transition: 'all 150ms ease',
                          }}
                          onMouseEnter={e => {
                            if (amount !== p) {
                              e.currentTarget.style.borderColor = 'var(--ember)';
                              e.currentTarget.style.color = 'var(--parchment)';
                            }
                          }}
                          onMouseLeave={e => {
                            if (amount !== p) {
                              e.currentTarget.style.borderColor = 'var(--walnut-border)';
                              e.currentTarget.style.color = 'var(--parchment-dim)';
                            }
                          }}
                        >
                          {p}
                        </button>
                      ))}
                    </div>

                    {/* Cost breakdown */}
                    {amount && Number(amount) > 0 && (
                      <div
                        style={{
                          background: 'rgba(196,113,59,0.05)',
                          border: '1px solid rgba(196,113,59,0.12)',
                          borderRadius: 2,
                          padding: '10px 14px',
                          marginBottom: 16,
                          fontFamily: "'Crimson Pro', serif",
                          fontSize: 13,
                          color: 'var(--parchment-dim)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span>Missions unlocked</span>
                          <span style={{ color: 'var(--parchment)', fontWeight: 600 }}>
                            ~{Math.floor(Number(amount) / 0.001)}
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Fee split</span>
                          <span style={{ color: 'var(--parchment-dim)', fontSize: 12 }}>
                            85% agents · 10% coordinator · 5% treasury
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Deposit button */}
                    <button
                      className="btn-solid"
                      onClick={handleDeposit}
                      disabled={!amount || isNaN(Number(amount)) || Number(amount) <= 0}
                      style={{
                        width: '100%',
                        fontSize: 14,
                        padding: '12px 0',
                        opacity: (!amount || Number(amount) <= 0) ? 0.4 : 1,
                        cursor: (!amount || Number(amount) <= 0) ? 'not-allowed' : 'pointer',
                      }}
                    >
                      DEPOSIT TO TREASURY
                    </button>
                  </>
                )}

                {/* Transaction progress */}
                {(isPending || isConfirming || verifying || verified) && (
                  <div style={{ marginTop: verified ? 0 : 8 }}>
                    {/* Step indicators */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 0,
                        marginBottom: 20,
                        padding: '0 20px',
                      }}
                    >
                      {['Wallet', 'Chain', 'Verified'].map((label, i) => (
                        <div key={label} style={{ display: 'flex', alignItems: 'center' }}>
                          <div style={{ textAlign: 'center' }}>
                            <div
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 14,
                                fontWeight: 700,
                                border: `2px solid ${step > i ? 'var(--verdigris)' : step === i ? 'var(--ember)' : 'var(--walnut-border)'}`,
                                background: step > i ? 'rgba(90,158,122,0.15)' : step === i ? 'rgba(196,113,59,0.12)' : 'transparent',
                                color: step > i ? 'var(--verdigris)' : step === i ? 'var(--ember)' : 'var(--parchment-dim)',
                                transition: 'all 300ms ease',
                              }}
                            >
                              {step > i ? '\u2713' : i + 1}
                            </div>
                            <div
                              style={{
                                fontFamily: "'Crimson Pro', serif",
                                fontSize: 10,
                                color: step >= i ? 'var(--parchment)' : 'var(--parchment-dim)',
                                marginTop: 4,
                                letterSpacing: '0.05em',
                              }}
                            >
                              {label}
                            </div>
                          </div>
                          {i < 2 && (
                            <div
                              style={{
                                width: 60,
                                height: 2,
                                background: step > i ? 'var(--verdigris)' : 'var(--walnut-border)',
                                margin: '0 8px',
                                marginBottom: 18,
                                transition: 'background 300ms ease',
                              }}
                            />
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Status messages */}
                    {isPending && (
                      <StatusMessage
                        icon="&#x1F4B0;"
                        color="var(--gold)"
                        title="Confirm in your wallet"
                        subtitle="Approve the deposit transaction..."
                        pulse
                      />
                    )}
                    {isConfirming && (
                      <StatusMessage
                        icon="&#x26D3;"
                        color="var(--ember)"
                        title="Forging on-chain"
                        subtitle="Transaction submitted, awaiting confirmation..."
                        pulse
                      />
                    )}
                    {verifying && (
                      <StatusMessage
                        icon="&#x1F50D;"
                        color="var(--indigo)"
                        title="Verifying deposit"
                        subtitle="Crediting your account..."
                        pulse
                      />
                    )}
                    {verified && (
                      <div style={{ textAlign: 'center' }}>
                        <StatusMessage
                          icon="&#x2728;"
                          color="var(--verdigris)"
                          title="Treasury replenished!"
                          subtitle={`+${verified.credited} credited — Total: ${verified.totalCredits}`}
                        />
                        {hash && (
                          <a
                            href={`${network.explorerUrl}/tx/${hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono"
                            style={{
                              display: 'inline-block',
                              fontSize: 11,
                              color: 'var(--indigo)',
                              marginTop: 8,
                              textDecoration: 'none',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
                            onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
                          >
                            View on explorer &#x2197;
                          </a>
                        )}
                        <div style={{ marginTop: 16 }}>
                          <button
                            className="btn-solid"
                            onClick={handleNewDeposit}
                            style={{ fontSize: 12, padding: '8px 24px', marginRight: 8 }}
                          >
                            DEPOSIT MORE
                          </button>
                          <button
                            onClick={onClose}
                            style={{
                              background: 'none',
                              border: '1px solid var(--walnut-border)',
                              color: 'var(--parchment-dim)',
                              fontFamily: "'Cinzel', serif",
                              fontSize: 12,
                              padding: '8px 24px',
                              borderRadius: 2,
                              cursor: 'pointer',
                              transition: 'all 150ms',
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.borderColor = 'var(--parchment-dim)';
                              e.currentTarget.style.color = 'var(--parchment)';
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.borderColor = 'var(--walnut-border)';
                              e.currentTarget.style.color = 'var(--parchment-dim)';
                            }}
                          >
                            DONE
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Error */}
                {(error || verifyError) && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: '10px 14px',
                      background: 'rgba(139,58,58,0.1)',
                      border: '1px solid rgba(139,58,58,0.3)',
                      borderRadius: 2,
                      fontFamily: "'Crimson Pro', serif",
                      fontSize: 13,
                      color: 'var(--wine)',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                    }}
                  >
                    <span style={{ fontSize: 16, lineHeight: 1 }}>&#x26A0;</span>
                    <span style={{ lineHeight: 1.4 }}>
                      {verifyError || (error instanceof Error ? error.message : 'Transaction failed')}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/* ── Status message sub-component ──────────────────────── */

function StatusMessage({
  icon,
  color,
  title,
  subtitle,
  pulse,
}: {
  icon: string;
  color: string;
  title: string;
  subtitle: string;
  pulse?: boolean;
}) {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '8px 0',
      }}
    >
      <div
        style={{
          fontSize: 28,
          marginBottom: 8,
          animation: pulse ? 'coinPulse 2s ease-in-out infinite' : undefined,
        }}
      >
        {icon}
      </div>
      <div
        style={{
          fontFamily: "'Cinzel', serif",
          fontSize: 14,
          fontWeight: 700,
          color,
          letterSpacing: '0.06em',
          marginBottom: 4,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontFamily: "'Crimson Pro', serif",
          fontSize: 13,
          color: 'var(--parchment-dim)',
        }}
      >
        {subtitle}
      </div>
    </div>
  );
}
