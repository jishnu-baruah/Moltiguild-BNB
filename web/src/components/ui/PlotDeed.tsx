'use client';

interface PlotInfo {
  plotId: number;
  district: string;
  positionTier: string;
  price: number;
  status: 'available' | 'claimed';
}

interface PlotDeedProps {
  plot: PlotInfo;
  onClose: () => void;
  onClaim: () => void;
}

export default function PlotDeed({ plot, onClose, onClaim }: PlotDeedProps) {
  return (
    <>
      {/* Backdrop + centering */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(8,9,14,0.4)',
          zIndex: 109,
          pointerEvents: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >

      {/* Deed */}
      <div
        className="panel"
        onClick={e => e.stopPropagation()}
        style={{
          width: 300,
          pointerEvents: 'auto',
          animation: 'scaleIn 200ms ease-out both',
          padding: '20px 24px',
        }}
      >
        {/* Header */}
        <div
          className="section-header"
          style={{ padding: '0 0 12px', margin: 0 }}
        >
          PLOT DEED
        </div>

        {/* Plot Info */}
        <div
          className="font-display"
          style={{ fontSize: 20, color: 'var(--parchment)', marginBottom: 4 }}
        >
          Plot #{plot.plotId}
        </div>
        <div
          style={{
            fontFamily: "'Crimson Pro', serif",
            fontSize: 14,
            color: 'var(--parchment-dim)',
            marginBottom: 16,
          }}
        >
          {plot.district} &middot; {plot.positionTier}
        </div>

        {/* Price */}
        <div
          className="font-mono"
          style={{
            fontSize: 22,
            fontWeight: 500,
            color: 'var(--gold)',
            textShadow: '0 0 8px var(--glow-gold)',
            marginBottom: 6,
          }}
        >
          &#x2B21; {plot.price} MON
        </div>

        {/* Status */}
        <div
          style={{
            fontFamily: "'Crimson Pro', serif",
            fontSize: 14,
            color: plot.status === 'available' ? 'var(--verdigris)' : 'var(--parchment-dim)',
            marginBottom: 20,
          }}
        >
          Status: {plot.status === 'available' ? 'Available' : 'Claimed'}
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 10 }}>
          {plot.status === 'available' && (
            <button className="btn-solid" onClick={onClaim} style={{ flex: 1 }}>
              Claim &amp; Build
            </button>
          )}
          <button className="btn-ghost" onClick={onClose} style={{ flex: plot.status === 'available' ? undefined : 1 }}>
            Close
          </button>
        </div>
      </div>
      </div>
    </>
  );
}
