'use client';

import { useState } from 'react';
import { useCreateGuild, useCredits } from '@/lib/hooks';

interface GuildCreateModalProps {
  plotId?: number;
  district?: string;
  price?: number;
  onClose: () => void;
}

const CATEGORIES = [
  'Select specialization',
  'creative',
  'meme',
  'translation',
  'code',
  'defi',
  'research',
];

export default function GuildCreateModal({ plotId = 6, district = 'Creative Quarter', price = 3, onClose }: GuildCreateModalProps) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  const createGuild = useCreateGuild();
  const { data: credits } = useCredits();

  const balance = credits ? credits.raw.toFixed(4) : '0.0000';

  const handleCreate = () => {
    if (!name.trim() || !category) {
      setError('Name and category are required.');
      return;
    }
    setError('');
    const adminKey = typeof window !== 'undefined'
      ? (process.env.NEXT_PUBLIC_ADMIN_KEY ?? '')
      : '';

    createGuild.mutate(
      { name: name.trim(), category, adminKey },
      {
        onSuccess: () => onClose(),
        onError: (err) => {
          setError(err instanceof Error ? err.message : 'Guild creation failed');
        },
      },
    );
  };

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
          border: '1px solid var(--walnut-border)',
          borderRadius: 2,
          boxShadow:
            'inset 0 1px 0 rgba(255,245,220,0.04), inset 0 0 0 1px var(--walnut-border), 0 0 0 1px var(--void), 0 24px 64px rgba(0,0,0,0.6)',
          padding: 0,
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
            &#9874; FOUND YOUR GUILD
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
          {/* Context */}
          <div
            style={{
              fontFamily: "'Crimson Pro', serif",
              fontSize: 14,
              color: 'var(--parchment-dim)',
              marginBottom: 20,
            }}
          >
            Plot #{plotId} &middot; {district} &middot; {price} MON
          </div>

          {/* Guild Name */}
          <label className="section-header" style={{ display: 'block', padding: '0 0 8px' }}>
            Guild Name
          </label>
          <input
            className="input-field"
            type="text"
            placeholder="Enter guild name..."
            value={name}
            onChange={e => setName(e.target.value)}
            style={{ marginBottom: 16 }}
          />

          {/* Category */}
          <label className="section-header" style={{ display: 'block', padding: '0 0 8px' }}>
            Category
          </label>
          <select
            className="input-field"
            value={category}
            onChange={e => setCategory(e.target.value)}
            style={{ marginBottom: 16, cursor: 'pointer' }}
          >
            {CATEGORIES.map(c => (
              <option key={c} value={c === 'Select specialization' ? '' : c}>
                {c}
              </option>
            ))}
          </select>

          {/* Description */}
          <label className="section-header" style={{ display: 'block', padding: '0 0 8px' }}>
            Description <span style={{ fontFamily: "'Crimson Pro', serif", fontWeight: 400, textTransform: 'none', letterSpacing: 'normal' }}>(optional)</span>
          </label>
          <textarea
            className="input-field"
            placeholder="What does your guild specialize in?"
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
            style={{ marginBottom: 20, resize: 'vertical' }}
          />

          {/* Cost Breakdown */}
          <div
            style={{
              borderTop: '1px solid var(--walnut-border)',
              borderBottom: '1px solid var(--walnut-border)',
              padding: '12px 0',
              marginBottom: 16,
            }}
          >
            <div className="section-header" style={{ padding: '0 0 8px' }}>Cost</div>
            <div className="dot-leader">
              <span>Plot</span>
              <span className="dot-leader-value" style={{ color: 'var(--gold)' }}>
                &#x2B21; {price.toFixed(3)}
              </span>
            </div>
            <div className="dot-leader">
              <span>Foundation</span>
              <span className="dot-leader-value" style={{ color: 'var(--gold)' }}>
                &#x2B21; 0.000
              </span>
            </div>
            <div className="dot-leader" style={{ fontWeight: 600 }}>
              <span>Total</span>
              <span className="dot-leader-value" style={{ color: 'var(--gold)' }}>
                &#x2B21; {price.toFixed(3)}
              </span>
            </div>
          </div>

          {/* Purse */}
          <div
            className="font-mono"
            style={{
              fontSize: 13,
              color: 'var(--parchment-dim)',
              marginBottom: 20,
            }}
          >
            Your purse: <span style={{ color: 'var(--gold)' }}>&#x2B21; {balance}</span>
          </div>

          {/* Error */}
          {error && (
            <div style={{ color: 'var(--wine)', fontFamily: "'Crimson Pro', serif", fontSize: 13, marginBottom: 12 }}>
              {error}
            </div>
          )}

          {/* Buttons */}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between' }}>
            <button
              className="btn-solid"
              style={{ flex: 1, opacity: createGuild.isPending ? 0.5 : 1 }}
              onClick={handleCreate}
              disabled={createGuild.isPending}
            >
              {createGuild.isPending ? 'Creating...' : 'Found Guild'}
            </button>
            <button className="btn-ghost" onClick={onClose}>
              Abandon
            </button>
          </div>
        </div>
      </div>
      </div>
    </>
  );
}
