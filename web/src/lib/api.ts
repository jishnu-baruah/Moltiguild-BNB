import { getNetwork } from './network';

/* ── Response wrapper ───────────────────────────────────────────── */

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${getNetwork().apiUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  const json: ApiResponse<T> = await res.json();
  if (!json.ok || !json.data) {
    throw new Error(json.error || `API error: ${res.status}`);
  }
  return json.data;
}

/* ── Response types ─────────────────────────────────────────────── */

export interface StatusData {
  guilds: number;
  missionsCreated: number;
  missionsCompleted: number;
  agents: number;
  onlineAgents: number;
  totalFeesCollected?: string;
}

export interface GuildData {
  guildId: string;
  name: string;
  category: string;
  avgRating: number | string;
  totalMissions: number;
  memberCount: number;
  assignedPlot?: {
    plotId: string;
    col: number;
    row: number;
    tier: string;
    district: string;
    assignedAt: number;
  } | null;
}

export interface OnlineAgent {
  address: string;
  lastSeen: string;
  minutesAgo: number;
}

export interface MissionData {
  missionId: string;
  guildId: string;
  client?: string;
  budget?: string;
  claimed?: boolean;
  claimer?: string | null;
  completed?: boolean;
  rated?: boolean;
  rating?: number;
  taskHash?: string;
  timestamp_?: string;
  transactionHash_?: string;
}

export interface MissionResult {
  missionId: string;
  agent: string;
  result: string;
  completedAt: string;
}

export interface MissionRating {
  missionId: string;
  userId: string;
  rating: number;
  feedback: string | null;
}

export interface CreditsData {
  userId: string;
  credits: string;
  raw: number;
}

export interface SmartCreateResult {
  missionId: number;
  guildId: number;
  guildName: string;
  matchedCategory: string;
  task: string;
  budget: string;
  txHash?: string;
  status?: string;
}

export interface AutoSetupResult {
  status: string;
  address: string;
  credits: string;
  funded?: boolean;
}

export interface GuildCreateResult {
  guildId: number;
  name: string;
  category: string;
  txHash?: string;
}

/* ── Read endpoints ─────────────────────────────────────────────── */

export const fetchStatus = () =>
  apiFetch<StatusData>('/api/status');

export const fetchGuilds = () =>
  apiFetch<{ count: number; guilds: GuildData[] }>('/api/guilds');

export const fetchGuildAgents = (guildId: number) =>
  apiFetch<{ guildId: string; count: number; agents: string[] }>(`/api/guilds/${guildId}/agents`);

export const fetchOnlineAgents = () =>
  apiFetch<{ count: number; agents: OnlineAgent[] }>('/api/agents/online');

export const fetchOpenMissions = (guildId?: number) =>
  apiFetch<{ count: number; missions: MissionData[] }>(
    `/api/missions/open${guildId != null ? `?guildId=${guildId}` : ''}`,
  );

/** Fetch recent missions across all guilds for the activity feed. */
export const fetchRecentMissions = () =>
  apiFetch<{ count: number; missions: MissionData[] }>('/api/missions/open');

export const fetchMissionsByGuild = (guildId: number) =>
  apiFetch<{ count: number; missions: MissionData[] }>(
    `/api/guilds/${guildId}/missions`,
  );

export const fetchMissionResult = (missionId: number) =>
  apiFetch<MissionResult>(`/api/mission/${missionId}/result`);

export const fetchMissionRating = (missionId: number) =>
  apiFetch<MissionRating>(`/api/mission/${missionId}/rating`);

export const fetchCredits = (userId: string) =>
  apiFetch<CreditsData>(`/api/credits/${userId}`);

/* ── Write endpoints ────────────────────────────────────────────── */

export const smartCreate = (task: string, userId: string, budget = '0.001') =>
  apiFetch<SmartCreateResult>('/api/smart-create', {
    method: 'POST',
    body: JSON.stringify({ task, userId, budget }),
  });

export const rateMission = (missionId: number, userId: string, rating: number, feedback?: string) =>
  apiFetch<MissionRating>(`/api/mission/${missionId}/rate`, {
    method: 'POST',
    body: JSON.stringify({ rating, userId, feedback }),
  });

export const autoSetup = (userId: string) =>
  apiFetch<AutoSetupResult>('/api/auto-setup', {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });

export const verifyPayment = (txHash: string, userId: string) =>
  apiFetch<{ credited: string; totalCredits: string }>('/api/verify-payment', {
    method: 'POST',
    body: JSON.stringify({ txHash, userId }),
  });

export const claimStarter = (userId: string) =>
  apiFetch<CreditsData & { granted?: boolean; alreadyClaimed?: boolean; spent?: boolean }>(
    '/api/claim-starter',
    { method: 'POST', body: JSON.stringify({ userId }) },
  );

export const adminCreateGuild = (name: string, category: string, adminKey: string) =>
  apiFetch<GuildCreateResult>('/api/admin/create-guild', {
    method: 'POST',
    body: JSON.stringify({ name, category }),
    headers: { 'X-Admin-Key': adminKey },
  });

export const joinGuild = (agentAddress: string, guildId: number, signature: string, timestamp: number) =>
  apiFetch<{ txHash: string }>('/api/join-guild', {
    method: 'POST',
    body: JSON.stringify({ agentAddress, guildId, signature, timestamp }),
  });
