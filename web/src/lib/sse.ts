import { getNetwork } from './network';
import type { FeedEvent } from './world-state';

export type SSEEventType =
  | 'connected'
  | 'heartbeat'
  | 'mission_created'
  | 'mission_completed'
  | 'mission_rated'
  | 'mission_claimed'
  | 'guild_created'
  | 'agent_joined_guild'
  | 'agent_left_guild'
  | 'pipeline_created'
  | 'step_completed'
  | 'pipeline_completed'
  | 'plot_assigned'
  | 'plot_released';

export interface SSEEvent {
  type: SSEEventType;
  data: Record<string, unknown>;
}

type SSECallback = (event: SSEEvent) => void;

let eventSource: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<SSECallback>();
const BASE_RECONNECT_DELAY = 3000;
const MAX_RECONNECT_DELAY = 60000;
let reconnectAttempts = 0;

const EVENT_TYPES: SSEEventType[] = [
  'connected', 'heartbeat',
  'mission_created', 'mission_completed', 'mission_rated', 'mission_claimed',
  'guild_created', 'agent_joined_guild', 'agent_left_guild',
  'pipeline_created', 'step_completed', 'pipeline_completed',
  'plot_assigned', 'plot_released',
];

export function connectSSE(): void {
  if (eventSource) return;

  const url = `${getNetwork().apiUrl}/api/events`;
  eventSource = new EventSource(url);

  eventSource.onopen = () => {
    reconnectAttempts = 0; // reset on successful connection
  };

  for (const type of EVENT_TYPES) {
    eventSource.addEventListener(type, (raw: MessageEvent) => {
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(raw.data); } catch { /* ignore */ }
      const sse: SSEEvent = { type, data };
      for (const cb of listeners) cb(sse);
    });
  }

  eventSource.onerror = () => {
    disconnectSSE();
    reconnectAttempts++;
    const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts - 1), MAX_RECONNECT_DELAY);
    reconnectTimer = setTimeout(connectSSE, delay);
  };
}

export function disconnectSSE(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

export function subscribeSSE(callback: SSECallback): () => void {
  listeners.add(callback);
  if (!eventSource) connectSSE();
  return () => {
    listeners.delete(callback);
    if (listeners.size === 0) disconnectSSE();
  };
}

/** Convert SSE event into a FeedEvent for the activity feed. Returns null if not mappable. */
export function sseToFeedEvent(sse: SSEEvent): FeedEvent | null {
  const d = sse.data;
  const now = Date.now();

  switch (sse.type) {
    case 'mission_completed':
      return {
        type: 'mission_completed',
        guildId: Number(d.guildId ?? 0),
        missionId: Number(d.missionId),
        timestamp: now,
        txHash: String(d.txHash || ''),
        ...(d.paid != null ? { paid: String(d.paid) } : {}),
        ...(d.agent ? { agent: String(d.agent) } : {}),
      };
    case 'mission_created':
      return {
        type: 'mission_created',
        guildId: Number(d.guildId ?? 0),
        missionId: Number(d.missionId),
        timestamp: now,
        txHash: String(d.txHash || ''),
        ...(d.budget != null ? { budget: String(d.budget) } : {}),
      };
    case 'mission_rated':
      return {
        type: 'mission_rated',
        guildId: Number(d.guildId ?? 0),
        missionId: Number(d.missionId),
        score: Number(d.score ?? d.rating ?? 0),
        timestamp: now,
        txHash: String(d.txHash || ''),
      };
    case 'mission_claimed':
      return {
        type: 'mission_claimed',
        guildId: Number(d.guildId ?? 0),
        missionId: Number(d.missionId),
        timestamp: now,
        txHash: String(d.txHash || ''),
        ...(d.agent ? { agent: String(d.agent) } : {}),
      };
    case 'guild_created':
      return {
        type: 'guild_created',
        guildId: Number(d.guildId),
        timestamp: now,
        txHash: String(d.txHash || ''),
      };
    case 'agent_joined_guild':
      return {
        type: 'agent_registered',
        guildId: Number(d.guildId),
        timestamp: now,
        txHash: String(d.txHash || ''),
      };
    case 'plot_assigned':
      return {
        type: 'plot_assigned',
        guildId: Number(d.guildId),
        timestamp: now,
        txHash: '',
        plotId: String(d.plotId || ''),
        col: Number(d.col),
        row: Number(d.row),
        tier: String(d.tier || ''),
        district: String(d.district || ''),
      };
    case 'plot_released':
      return {
        type: 'plot_released',
        guildId: Number(d.guildId),
        timestamp: now,
        txHash: '',
        plotId: String(d.plotId || ''),
        col: Number(d.col),
        row: Number(d.row),
      };
    default:
      return null;
  }
}
