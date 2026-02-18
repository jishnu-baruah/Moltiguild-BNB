'use client';

import { useState, useEffect, useCallback } from 'react';
import Header from '@/components/ui/Header';
import StatsSidebar from '@/components/ui/StatsSidebar';
import ChatBar from '@/components/ui/ChatBar';
import GuildCard from '@/components/ui/GuildCard';
import PlotDeed from '@/components/ui/PlotDeed';
import GuildCreateModal from '@/components/ui/GuildCreateModal';
import AgentRegisterModal from '@/components/ui/AgentRegisterModal';
import DepositModal from '@/components/ui/DepositModal';
import { useGuildVisuals } from '@/lib/hooks';

type ActiveModal = 'none' | 'guild-create' | 'agent-register' | 'deposit';

export default function UIOverlay() {
  const guildVisuals = useGuildVisuals();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatExpanded, setChatExpanded] = useState(false);
  const [activeGuild, setActiveGuild] = useState<number | null>(null);
  const [activePlot, setActivePlot] = useState<number | null>(null);
  const [activeModal, setActiveModal] = useState<ActiveModal>('none');
  const [inDistrict, setInDistrict] = useState(false);

  // Listen for Phaser events
  useEffect(() => {
    const handleDistrictClick = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) {
        setInDistrict(true);
        setSidebarOpen(true);
      }
    };

    const handleGuildClick = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.guildId != null) {
        setActiveGuild(detail.guildId);
        setActivePlot(null);
      }
    };

    const handleEmptyLotClick = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.plotId != null) {
        setActivePlot(detail.plotId);
        setActiveGuild(null);
      }
    };

    const handleBackToOverview = () => {
      setInDistrict(false);
      setSidebarOpen(false);
      setChatExpanded(false);
      setActiveGuild(null);
      setActivePlot(null);
      setActiveModal('none');
    };

    window.addEventListener('district-clicked', handleDistrictClick);
    window.addEventListener('guild-clicked', handleGuildClick);
    window.addEventListener('empty-lot-clicked', handleEmptyLotClick);
    window.addEventListener('back-to-overview', handleBackToOverview);

    return () => {
      window.removeEventListener('district-clicked', handleDistrictClick);
      window.removeEventListener('guild-clicked', handleGuildClick);
      window.removeEventListener('empty-lot-clicked', handleEmptyLotClick);
      window.removeEventListener('back-to-overview', handleBackToOverview);
    };
  }, []);

  const handleBack = useCallback(() => {
    setInDistrict(false);
    setSidebarOpen(false);
    setChatExpanded(false);
    setActiveGuild(null);
    setActivePlot(null);
    setActiveModal('none');
    // Also tell Phaser to zoom out
    window.dispatchEvent(new CustomEvent('request-overview'));
  }, []);

  const selectedGuild = activeGuild != null
    ? guildVisuals.find(g => g.guildId === activeGuild) ?? guildVisuals[0]
    : null;

  const selectedPlot = activePlot != null
    ? { plotId: activePlot, district: 'Unknown', positionTier: 'mid-ring' as const, price: 0, status: 'available' as const }
    : null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 100,
      }}
    >
      {/* Header */}
      <Header
        onToggleSidebar={() => setSidebarOpen(prev => !prev)}
        onBack={handleBack}
        showBack={inDistrict}
        onOpenDeposit={() => setActiveModal('deposit')}
      />

      {/* Sidebar */}
      <StatsSidebar open={sidebarOpen} />

      {/* Chat Bar */}
      <ChatBar
        expanded={chatExpanded}
        onToggle={() => setChatExpanded(prev => !prev)}
      />

      {/* Guild Card */}
      {selectedGuild && activeModal === 'none' && (
        <GuildCard
          guild={selectedGuild}
          onClose={() => setActiveGuild(null)}
          onNewQuest={() => {
            setActiveGuild(null);
            setChatExpanded(true);
          }}
          onAddAgent={() => {
            setActiveGuild(null);
            setActiveModal('agent-register');
          }}
        />
      )}

      {/* Plot Deed */}
      {selectedPlot && activeModal === 'none' && !activeGuild && (
        <PlotDeed
          plot={selectedPlot}
          onClose={() => setActivePlot(null)}
          onClaim={() => {
            setActivePlot(null);
            setActiveModal('guild-create');
          }}
        />
      )}

      {/* Guild Create Modal */}
      {activeModal === 'guild-create' && (
        <GuildCreateModal
          plotId={selectedPlot?.plotId}
          district={selectedPlot?.district}
          price={selectedPlot?.price}
          onClose={() => setActiveModal('none')}
        />
      )}

      {/* Agent Register Modal */}
      {activeModal === 'agent-register' && (
        <AgentRegisterModal
          onClose={() => setActiveModal('none')}
        />
      )}

      {/* Deposit Modal */}
      {activeModal === 'deposit' && (
        <DepositModal
          onClose={() => setActiveModal('none')}
        />
      )}
    </div>
  );
}
