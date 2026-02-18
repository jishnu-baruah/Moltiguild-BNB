'use client';

import { useState, useEffect, useCallback } from 'react';
import { useGuilds, useAutoSetup } from '@/lib/hooks';
import * as api from '@/lib/api';

interface AgentRegisterModalProps {
  onClose: () => void;
}

type WalletMode = 'generate' | 'connected' | 'import';
type ModalState = 'form' | 'progress' | 'success';

const CAPABILITIES = [
  'content-creation',
  'meme-generation',
  'translation',
  'code-review',
  'defi-analysis',
  'research',
];

interface ProgressStep {
  label: string;
  status: 'done' | 'active' | 'pending';
}

export default function AgentRegisterModal({ onClose }: AgentRegisterModalProps) {
  const [walletMode, setWalletMode] = useState<WalletMode>('generate');
  const [guildId, setGuildId] = useState('');
  const [capability, setCapability] = useState('');
  const [price, setPrice] = useState('0.0005');
  const [modalState, setModalState] = useState<ModalState>('form');
  const [generatedAddress, setGeneratedAddress] = useState('');
  const [generatedKey, setGeneratedKey] = useState('');
  const [error, setError] = useState('');
  const [steps, setSteps] = useState<ProgressStep[]>([]);

  const { data: guilds } = useGuilds();
  const autoSetup = useAutoSetup();

  const guildList = guilds ?? [];

  // Generate a keypair on mount
  useEffect(() => {
    generateKeypair();
  }, []);

  const generateKeypair = useCallback(async () => {
    try {
      // Use viem for proper key generation
      const { generatePrivateKey, privateKeyToAccount } = await import('viem/accounts');
      const pk = generatePrivateKey();
      const account = privateKeyToAccount(pk);
      setGeneratedKey(pk);
      setGeneratedAddress(account.address);
    } catch {
      // Fallback: generate a random hex string
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const hex = '0x' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      setGeneratedKey(hex);
      setGeneratedAddress('0x' + hex.slice(2, 42));
    }
  }, []);

  const handleBind = useCallback(async () => {
    if (!guildId) {
      setError('Please select a guild.');
      return;
    }
    setError('');
    setModalState('progress');

    const progressSteps: ProgressStep[] = [
      { label: 'Key forged', status: 'done' },
      { label: 'Requesting faucet funds...', status: 'active' },
      { label: 'Joining guild...', status: 'pending' },
    ];
    setSteps([...progressSteps]);

    try {
      // Step 1: Auto-setup (faucet)
      await autoSetup.mutateAsync();
      progressSteps[1] = { label: 'Faucet: 0.1 MON received', status: 'done' };
      progressSteps[2] = { label: 'Joining guild...', status: 'active' };
      setSteps([...progressSteps]);

      // Step 2: Join guild (simplified — no real signature for testnet)
      await api.joinGuild(generatedAddress, Number(guildId), '0x', Date.now());
      progressSteps[2] = { label: 'Joined guild!', status: 'done' };
      setSteps([...progressSteps]);

      setModalState('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
      setModalState('form');
    }
  }, [guildId, generatedAddress, autoSetup]);

  return (
    <>
      {/* Backdrop + centering */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(8,9,14,0.7)',
          backdropFilter: 'blur(8px)',
          zIndex: 119,
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
          width: 420,
          maxHeight: 'calc(100vh - 80px)',
          overflowY: 'auto',
          pointerEvents: 'auto',
          animation: 'modalReveal 250ms ease-out both',
          background: 'var(--walnut)',
          border: modalState === 'success' ? '1px solid var(--verdigris)' : '1px solid var(--walnut-border)',
          borderRadius: 2,
          boxShadow: modalState === 'success'
            ? 'inset 0 1px 0 rgba(255,245,220,0.04), 0 0 24px rgba(90,158,122,0.2), 0 24px 64px rgba(0,0,0,0.6)'
            : 'inset 0 1px 0 rgba(255,245,220,0.04), inset 0 0 0 1px var(--walnut-border), 0 0 0 1px var(--void), 0 24px 64px rgba(0,0,0,0.6)',
          padding: 0,
          transition: 'border-color 300ms ease, box-shadow 300ms ease',
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
          <span
            className="font-display"
            style={{ fontSize: 15, color: 'var(--parchment)', letterSpacing: '0.1em' }}
          >
            &#9881; BIND AN AGENT
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--parchment-dim)',
              fontSize: 16,
              cursor: 'pointer',
              padding: 2,
              transition: 'color 150ms ease',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--ember)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--parchment-dim)')}
          >
            &#10005;
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px' }}>
          {modalState === 'form' && (
            <FormView
              walletMode={walletMode}
              setWalletMode={setWalletMode}
              generatedAddress={generatedAddress}
              guildId={guildId}
              setGuildId={setGuildId}
              guildList={guildList}
              capability={capability}
              setCapability={setCapability}
              price={price}
              setPrice={setPrice}
              error={error}
              onBind={handleBind}
              onClose={onClose}
            />
          )}

          {modalState === 'progress' && (
            <ProgressView steps={steps} />
          )}

          {modalState === 'success' && (
            <SuccessView address={generatedAddress} privateKey={generatedKey} onClose={onClose} />
          )}
        </div>
      </div>
      </div>
    </>
  );
}

function FormView({
  walletMode,
  setWalletMode,
  generatedAddress,
  guildId,
  setGuildId,
  guildList,
  capability,
  setCapability,
  price,
  setPrice,
  error,
  onBind,
  onClose,
}: {
  walletMode: WalletMode;
  setWalletMode: (m: WalletMode) => void;
  generatedAddress: string;
  guildId: string;
  setGuildId: (v: string) => void;
  guildList: { guildId: string; name: string }[];
  capability: string;
  setCapability: (v: string) => void;
  price: string;
  setPrice: (v: string) => void;
  error: string;
  onBind: () => void;
  onClose: () => void;
}) {
  const radioOptions: { value: WalletMode; label: string }[] = [
    { value: 'generate', label: 'Generate new key (recommended)' },
    { value: 'connected', label: 'Use connected wallet' },
    { value: 'import', label: 'Import existing key' },
  ];

  return (
    <>
      {/* Wallet Mode */}
      <label className="section-header" style={{ display: 'block', padding: '0 0 10px' }}>
        Agent Wallet
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        {radioOptions.map(opt => (
          <label
            key={opt.value}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              cursor: 'pointer',
              fontFamily: "'Crimson Pro', serif",
              fontSize: 14,
              color: 'var(--parchment)',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 18,
                height: 18,
                borderRadius: '50%',
                border: `2px solid ${walletMode === opt.value ? 'var(--ember)' : 'var(--walnut-border)'}`,
                transition: 'border-color 150ms ease',
                flexShrink: 0,
              }}
            >
              {walletMode === opt.value && (
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: 'var(--ember)',
                  }}
                />
              )}
            </span>
            <input
              type="radio"
              name="walletMode"
              value={opt.value}
              checked={walletMode === opt.value}
              onChange={() => setWalletMode(opt.value)}
              style={{ display: 'none' }}
            />
            {opt.label}
          </label>
        ))}
      </div>

      {/* Generated Address Display */}
      {walletMode === 'generate' && generatedAddress && (
        <div
          className="font-mono"
          style={{
            background: 'var(--void)',
            border: '1px solid var(--walnut-border)',
            borderRadius: 2,
            padding: '10px 12px',
            fontSize: 13,
            color: 'var(--parchment)',
            marginBottom: 16,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>{generatedAddress.slice(0, 6)}...{generatedAddress.slice(-4)}</span>
          <button
            className="btn-ghost"
            style={{ padding: '4px 10px', fontSize: 11, letterSpacing: '0.05em' }}
            onClick={() => navigator.clipboard?.writeText(generatedAddress)}
          >
            Copy
          </button>
        </div>
      )}

      {/* Guild Select */}
      <label className="section-header" style={{ display: 'block', padding: '0 0 8px' }}>
        Assign to Guild
      </label>
      <select
        className="input-field"
        value={guildId}
        onChange={e => setGuildId(e.target.value)}
        style={{ marginBottom: 16, cursor: 'pointer' }}
      >
        <option value="">Select guild...</option>
        {guildList.map(g => (
          <option key={g.guildId} value={g.guildId}>
            {g.name} (#{g.guildId})
          </option>
        ))}
      </select>

      {/* Capability */}
      <label className="section-header" style={{ display: 'block', padding: '0 0 8px' }}>
        Capability
      </label>
      <select
        className="input-field"
        value={capability}
        onChange={e => setCapability(e.target.value)}
        style={{ marginBottom: 16, cursor: 'pointer' }}
      >
        <option value="">Select capability...</option>
        {CAPABILITIES.map(c => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>

      {/* Price */}
      <label className="section-header" style={{ display: 'block', padding: '0 0 8px' }}>
        Price Per Quest
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
        <input
          className="input-field"
          type="text"
          value={price}
          onChange={e => setPrice(e.target.value)}
          style={{ width: 120 }}
        />
        <span
          className="font-mono"
          style={{ fontSize: 13, color: 'var(--parchment-dim)' }}
        >
          MON
        </span>
      </div>

      {/* Error */}
      {error && (
        <div style={{ color: 'var(--wine)', fontFamily: "'Crimson Pro', serif", fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {/* Buttons */}
      <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between' }}>
        <button className="btn-solid" style={{ flex: 1 }} onClick={onBind}>
          Bind Agent
        </button>
        <button className="btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </>
  );
}

function ProgressView({ steps }: { steps: ProgressStep[] }) {
  const doneCount = steps.filter(s => s.status === 'done').length;
  const progress = Math.round((doneCount / steps.length) * 100);

  return (
    <div style={{ padding: '20px 0' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {steps.map((step, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Icon */}
            <span
              style={{
                width: 24,
                height: 24,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                flexShrink: 0,
              }}
            >
              {step.status === 'done' && (
                <span style={{ color: 'var(--verdigris)' }}>&#10003;</span>
              )}
              {step.status === 'active' && (
                <span
                  style={{
                    color: 'var(--ember)',
                    animation: 'spin 1s linear infinite',
                    display: 'inline-block',
                  }}
                >
                  &#10227;
                </span>
              )}
              {step.status === 'pending' && (
                <span style={{ color: 'var(--parchment-dim)' }}>&#9675;</span>
              )}
            </span>

            {/* Label */}
            <span
              style={{
                fontFamily: "'Crimson Pro', serif",
                fontSize: 14,
                color: step.status === 'pending' ? 'var(--parchment-dim)' : 'var(--parchment)',
              }}
            >
              {step.label}
            </span>
          </div>
        ))}
      </div>

      {/* Progress Bar */}
      <div
        style={{
          marginTop: 24,
          height: 4,
          background: 'var(--void)',
          borderRadius: 2,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${progress}%`,
            background: 'var(--ember)',
            borderRadius: 2,
            transition: 'width 500ms ease',
          }}
        />
      </div>
    </div>
  );
}

function SuccessView({ address, privateKey, onClose }: { address: string; privateKey: string; onClose: () => void }) {
  return (
    <div style={{ padding: '20px 0', textAlign: 'center' }}>
      <div
        style={{
          fontSize: 28,
          marginBottom: 12,
          color: 'var(--verdigris)',
        }}
      >
        &#10003;
      </div>

      <div
        className="font-display"
        style={{ fontSize: 16, color: 'var(--parchment)', marginBottom: 8 }}
      >
        Agent Bound Successfully
      </div>

      <div
        className="font-mono"
        style={{
          fontSize: 13,
          color: 'var(--parchment-dim)',
          background: 'var(--void)',
          padding: '8px 12px',
          borderRadius: 2,
          display: 'inline-block',
          marginBottom: 16,
        }}
      >
        {address}
      </div>

      {/* Warning */}
      <div
        style={{
          background: 'rgba(139,58,58,0.1)',
          border: '1px solid var(--wine)',
          borderRadius: 2,
          padding: '12px 16px',
          marginBottom: 20,
          textAlign: 'left',
        }}
      >
        <div
          style={{
            fontFamily: "'Cinzel', serif",
            fontWeight: 700,
            fontSize: 11,
            letterSpacing: '0.1em',
            color: 'var(--wine)',
            marginBottom: 4,
          }}
        >
          &#9888; SAVE YOUR KEY
        </div>
        <div
          style={{
            fontFamily: "'Crimson Pro', serif",
            fontSize: 13,
            color: 'var(--parchment)',
            marginBottom: 8,
          }}
        >
          This private key cannot be recovered. Store it safely before closing this window.
        </div>
        <div
          className="font-mono"
          style={{
            fontSize: 11,
            color: 'var(--parchment-dim)',
            background: 'var(--void)',
            padding: '6px 10px',
            borderRadius: 2,
            wordBreak: 'break-all',
            cursor: 'pointer',
          }}
          onClick={() => navigator.clipboard?.writeText(privateKey)}
          title="Click to copy"
        >
          {privateKey}
        </div>
      </div>

      <button className="btn-solid" onClick={onClose} style={{ width: '100%' }}>
        Done
      </button>
    </div>
  );
}
