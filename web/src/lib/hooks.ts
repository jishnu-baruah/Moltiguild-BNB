'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useMemo, useRef } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther } from 'viem';
import * as api from './api';
import { getUserId } from './user';
import { subscribeSSE, sseToFeedEvent, type SSEEvent } from './sse';
import type { FeedEvent, GuildVisual } from './world-state';
import { getGuildTier, getGuildPosition } from './world-state';
import { getGuildRegistryConfig } from './contract';
import { useNetworkKey, useNetwork } from './network';

/* ── User Identity ──────────────────────────────────────────────── */

export function useUser() {
  const { address, isConnected } = useAccount();
  const [fallbackId, setFallbackId] = useState('');
  useEffect(() => { setFallbackId(getUserId()); }, []);

  // Prefer connected wallet address; fall back to localStorage UUID
  const userId = isConnected && address ? address : fallbackId;
  return { userId, isWallet: isConnected && !!address };
}

/* ── Credits ────────────────────────────────────────────────────── */

export function useCredits() {
  const { userId } = useUser();
  const netKey = useNetworkKey();
  const network = useNetwork();
  const queryClient = useQueryClient();
  const claimedRef = useRef(false);

  const query = useQuery({
    queryKey: ['credits', netKey, userId],
    queryFn: () => api.fetchCredits(userId),
    enabled: !!userId,
    refetchInterval: 30_000,
    placeholderData: { userId: '', credits: '0 tBNB', raw: 0 },
  });

  // Auto-claim starter credits if balance is 0 (always testnet)
  useEffect(() => {
    if (query.data && query.data.raw <= 0 && userId && !claimedRef.current) {
      claimedRef.current = true;
      api.claimStarter(userId).then(() => {
        queryClient.invalidateQueries({ queryKey: ['credits'] });
      }).catch(() => {});
    }
  }, [query.data, userId, queryClient]);

  return query;
}

/* ── Platform Stats ─────────────────────────────────────────────── */

export function useStats() {
  const netKey = useNetworkKey();
  return useQuery({
    queryKey: ['status', netKey],
    queryFn: api.fetchStatus,
    refetchInterval: 15_000,
    placeholderData: {
      guilds: 0,
      missionsCreated: 0,
      missionsCompleted: 0,
      agents: 0,
      onlineAgents: 0,
    },
  });
}

/* ── Guilds ──────────────────────────────────────────────────────── */

export function useGuilds() {
  const netKey = useNetworkKey();
  return useQuery({
    queryKey: ['guilds', netKey],
    queryFn: async () => {
      const { guilds } = await api.fetchGuilds();
      return guilds;
    },
    refetchInterval: 30_000,
  });
}

/** Enrich raw GuildData into GuildVisual[] for Phaser and UI components. */
export function useGuildVisuals(): GuildVisual[] {
  const { data: guilds } = useGuilds();

  return useMemo(() => {
    if (!guilds || guilds.length === 0) return [];

    return guilds.map((g) => {
      const guildId = Number(g.guildId);
      const avgRating = typeof g.avgRating === 'string' ? parseFloat(g.avgRating) || 0 : g.avgRating;
      const position = getGuildPosition(guildId, g.category);
      const tier = getGuildTier(g.totalMissions, avgRating);

      return {
        guildId,
        name: g.name,
        category: g.category,
        tier,
        avgRating,
        totalMissions: g.totalMissions,
        position,
        agents: [],
        isAnimating: false,
        animationType: 'none' as const,
        assignedPlot: g.assignedPlot ?? null,
      };
    });
  }, [guilds]);
}

/* ── Guild Agents (on-demand) ───────────────────────────────────── */

export function useGuildAgents(guildId: number | null) {
  return useQuery({
    queryKey: ['guild-agents', guildId],
    queryFn: async () => {
      const res = await api.fetchGuildAgents(guildId!);
      return res.agents.map(addr => ({ address: addr }));
    },
    enabled: guildId != null,
  });
}

/* ── Online Agents ──────────────────────────────────────────────── */

export function useOnlineAgents() {
  return useQuery({
    queryKey: ['agents-online'],
    queryFn: async () => {
      const res = await api.fetchOnlineAgents();
      return res.agents;
    },
    refetchInterval: 30_000,
  });
}

/* ── Missions by Guild ──────────────────────────────────────────── */

export function useMissionsByGuild(guildId: number | null) {
  return useQuery({
    queryKey: ['missions', guildId],
    queryFn: async () => {
      const res = await api.fetchMissionsByGuild(guildId!);
      return res.missions;
    },
    enabled: guildId != null,
  });
}

/* ── Mission Result (poll while waiting) ────────────────────────── */

export function useMissionResult(missionId: number | null) {
  return useQuery({
    queryKey: ['mission-result', missionId],
    queryFn: () => api.fetchMissionResult(missionId!),
    enabled: missionId != null,
    refetchInterval: 5_000,
    retry: false,
  });
}

/* ── SSE Feed ───────────────────────────────────────────────────── */

export function useSSEFeed(maxItems = 20) {
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const queryClient = useQueryClient();

  // Seed feed with recent missions from the API on mount
  useEffect(() => {
    api.fetchRecentMissions()
      .then(({ missions }) => {
        const events: FeedEvent[] = missions
          .slice(0, maxItems)
          .map(m => ({
            type: 'mission_created' as const,
            guildId: Number(m.guildId),
            missionId: Number(m.missionId),
            timestamp: m.timestamp_ ? Number(m.timestamp_) * 1000 : Date.now(),
            txHash: m.transactionHash_ || '',
          }));
        if (events.length > 0) setFeed(events);
      })
      .catch(() => { /* API unavailable — feed stays empty until SSE events arrive */ });
  }, [maxItems]);

  // SSE for live updates
  useEffect(() => {
    const unsubscribe = subscribeSSE((sse: SSEEvent) => {
      const feedEvent = sseToFeedEvent(sse);
      if (feedEvent) {
        setFeed(prev => [feedEvent, ...prev].slice(0, maxItems));
      }

      // Invalidate relevant caches
      if (['mission_created', 'mission_completed', 'mission_rated'].includes(sse.type)) {
        queryClient.invalidateQueries({ queryKey: ['status'] });
        queryClient.invalidateQueries({ queryKey: ['missions'] });
      }
      if (sse.type === 'guild_created') {
        queryClient.invalidateQueries({ queryKey: ['guilds'] });
        queryClient.invalidateQueries({ queryKey: ['status'] });
      }
      if (sse.type === 'agent_joined_guild') {
        queryClient.invalidateQueries({ queryKey: ['guild-agents'] });
        queryClient.invalidateQueries({ queryKey: ['agents-online'] });
      }
    });
    return unsubscribe;
  }, [maxItems, queryClient]);

  return feed;
}

/* ── Mutations ──────────────────────────────────────────────────── */

export function useSmartCreate() {
  const { userId } = useUser();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ task, budget }: { task: string; budget?: string }) =>
      api.smartCreate(task, userId, budget),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credits'] });
      queryClient.invalidateQueries({ queryKey: ['status'] });
    },
  });
}

export function useRateMission() {
  const { userId } = useUser();
  return useMutation({
    mutationFn: ({ missionId, rating, feedback }: { missionId: number; rating: number; feedback?: string }) =>
      api.rateMission(missionId, userId, rating, feedback),
  });
}

export function useAutoSetup() {
  const { userId } = useUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.autoSetup(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credits'] });
    },
  });
}

export function useCreateGuild() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, category, adminKey }: { name: string; category: string; adminKey: string }) =>
      api.adminCreateGuild(name, category, adminKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['guilds'] });
      queryClient.invalidateQueries({ queryKey: ['status'] });
    },
  });
}

/* ── On-Chain Contract Hooks ──────────────────────────────────────── */

export function useContractBalance() {
  const { address } = useAccount();
  return useReadContract({
    ...getGuildRegistryConfig(),
    functionName: 'userBalances',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
      refetchInterval: 15_000,
    },
  });
}

export function useDepositFunds() {
  const { userId } = useUser();
  const queryClient = useQueryClient();
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess) {
      queryClient.invalidateQueries({ queryKey: ['credits'] });
      queryClient.invalidateQueries({ queryKey: ['contract-balance'] });
    }
  }, [isSuccess, queryClient, userId]);

  const deposit = (amount: string) => {
    writeContract({
      ...getGuildRegistryConfig(),
      functionName: 'depositFunds',
      value: parseEther(amount),
    });
  };

  return { deposit, hash, isPending, isConfirming, isSuccess, error, reset };
}

export function useWithdrawFunds() {
  const { userId } = useUser();
  const queryClient = useQueryClient();
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess) {
      queryClient.invalidateQueries({ queryKey: ['credits'] });
      queryClient.invalidateQueries({ queryKey: ['contract-balance'] });
    }
  }, [isSuccess, queryClient, userId]);

  const withdraw = (amount: string) => {
    writeContract({
      ...getGuildRegistryConfig(),
      functionName: 'withdrawFunds',
      args: [parseEther(amount)],
    });
  };

  return { withdraw, hash, isPending, isConfirming, isSuccess, error, reset };
}
