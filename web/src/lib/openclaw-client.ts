/**
 * OpenClaw WebSocket client — singleton connection manager.
 *
 * Follows the same module-level singleton pattern as sse.ts:
 *   connect() / disconnect() / subscribe callbacks
 *
 * Protocol: challenge → connect (token auth) → hello-ok → chat.send / chat events
 */

import { OPENCLAW_WS_URL, OPENCLAW_TOKEN, OPENCLAW_AGENT_ID } from './constants';

/* ── Types ─────────────────────────────────────────────────────────── */

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';
export type ChatEventState = 'delta' | 'final' | 'aborted' | 'error';

export interface ChatContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: unknown;
  toolId?: string;
}

export interface ChatEvent {
  runId: string;
  sessionKey: string;
  state: ChatEventState;
  content: string;
  blocks: ChatContentBlock[];
  errorMessage?: string;
  usage?: { input: number; output: number };
}

type StateCallback = (state: ConnectionState) => void;
type ChatCallback = (event: ChatEvent) => void;

/* ── Protocol frame types ──────────────────────────────────────────── */

interface RequestFrame {
  type: 'req';
  id: string;
  method: string;
  params: Record<string, unknown>;
}

interface ResponseFrame {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { code: string; message: string };
}

interface EventFrame {
  type: 'event';
  event: string;
  payload?: Record<string, unknown>;
  seq?: number;
}

type Frame = RequestFrame | ResponseFrame | EventFrame;

/* ── Module-level singleton state ──────────────────────────────────── */

let ws: WebSocket | null = null;
let state: ConnectionState = 'disconnected';
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let reqCounter = 0;

const BASE_RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;

const stateListeners = new Set<StateCallback>();
const chatListeners = new Set<ChatCallback>();

// Pending request callbacks (for req/res pairing)
const pendingRequests = new Map<string, {
  resolve: (payload: Record<string, unknown>) => void;
  reject: (err: Error) => void;
}>();

/* ── Helpers ───────────────────────────────────────────────────────── */

function nextReqId(): string {
  return `req-${++reqCounter}`;
}

function setState(next: ConnectionState): void {
  if (next === state) return;
  state = next;
  for (const cb of stateListeners) cb(state);
}

function send(frame: RequestFrame): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error('WebSocket not connected');
  }
  ws.send(JSON.stringify(frame));
}

function sendRequest(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = nextReqId();
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    try {
      send({ type: 'req', id, method, params });
    } catch (err) {
      pendingRequests.delete(id);
      reject(err);
    }
    // Timeout after 30s
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error(`Request ${method} timed out`));
      }
    }, 30000);
  });
}

/* ── Handshake ─────────────────────────────────────────────────────── */

function handleChallenge(_nonce: string): void {
  sendRequest('connect', {
    minProtocol: 3,
    maxProtocol: 3,
    client: {
      id: 'webchat',
      version: '1.0.0',
      platform: 'web',
      mode: 'webchat',
    },
    role: 'operator',
    scopes: ['operator.read', 'operator.write'],
    auth: { token: OPENCLAW_TOKEN },
    locale: typeof navigator !== 'undefined' ? navigator.language : 'en-US',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'moltiguild-web/1.0',
  }).then(() => {
    setState('connected');
    reconnectAttempts = 0;
  }).catch((err) => {
    console.error('[openclaw] handshake failed:', err);
    setState('error');
    scheduleReconnect();
  });
}

/* ── Frame dispatcher ──────────────────────────────────────────────── */

function handleFrame(frame: Frame): void {
  switch (frame.type) {
    case 'res': {
      const pending = pendingRequests.get(frame.id);
      if (pending) {
        pendingRequests.delete(frame.id);
        if (frame.ok) {
          pending.resolve(frame.payload ?? {});
        } else {
          pending.reject(new Error(frame.error?.message ?? 'Unknown error'));
        }
      }
      break;
    }

    case 'event': {
      if (frame.event === 'connect.challenge') {
        const nonce = (frame.payload as { nonce?: string })?.nonce ?? '';
        handleChallenge(nonce);
      } else if (frame.event === 'chat') {
        handleChatEvent(frame.payload ?? {});
      } else if (frame.event === 'agent') {
        handleAgentEvent(frame.payload ?? {});
      }
      // tick/health events are just keepalives — no action needed
      break;
    }
  }
}

function handleChatEvent(payload: Record<string, unknown>): void {
  const msg = payload.message as Record<string, unknown> | undefined;
  const rawBlocks = msg?.content as Array<Record<string, unknown>> | undefined;
  const blocks = parseRawBlocks(rawBlocks);
  const textParts = blocks.filter(b => b.type === 'text' && b.text).map(b => b.text!);

  const chatEvent: ChatEvent = {
    runId: String(payload.runId ?? ''),
    sessionKey: String(payload.sessionKey ?? ''),
    state: (payload.state as ChatEventState) ?? 'delta',
    content: textParts.join(''),
    blocks,
    errorMessage: payload.errorMessage as string | undefined,
    usage: payload.usage as { input: number; output: number } | undefined,
  };

  for (const cb of chatListeners) cb(chatEvent);
}

/**
 * Handle agent streaming events for smoother text and tool updates.
 *
 * Agent events arrive in three streams:
 * - stream="assistant": token-by-token text (much more frequent than chat events)
 * - stream="tool_use": tool call started (name, input, id)
 * - stream="tool_result": tool call completed (content, tool_use_id)
 *
 * We emit synthetic chat deltas so the hooks get real-time updates.
 * Text events use empty blocks to avoid clobbering structured blocks.
 * Tool events inject blocks directly for immediate visualization.
 */
function handleAgentEvent(payload: Record<string, unknown>): void {
  const stream = payload.stream as string | undefined;
  const data = payload.data as Record<string, unknown> | undefined;
  if (!data) return;

  const baseEvent = {
    runId: String(payload.runId ?? ''),
    sessionKey: String(payload.sessionKey ?? ''),
  };

  if (stream === 'assistant') {
    const text = String(data.text ?? '');
    if (!text) return;

    const chatEvent: ChatEvent = {
      ...baseEvent,
      state: 'delta',
      content: text,
      blocks: [], // empty — don't clobber structured blocks from chat events
    };
    for (const cb of chatListeners) cb(chatEvent);
    return;
  }

  if (stream === 'tool_use') {
    // Tool call started — inject a tool_use block for immediate streaming visualization
    const block: ChatContentBlock = {
      type: 'tool_use',
      toolName: String(data.name ?? ''),
      toolInput: (data.input as Record<string, unknown>) ?? {},
      toolId: String(data.id ?? data.tool_use_id ?? ''),
    };
    const chatEvent: ChatEvent = {
      ...baseEvent,
      state: 'delta',
      content: '', // no text content for tool events
      blocks: [block],
    };
    for (const cb of chatListeners) cb(chatEvent);
    return;
  }

  if (stream === 'tool_result') {
    // Tool result arrived — inject a tool_result block
    const block: ChatContentBlock = {
      type: 'tool_result',
      toolResult: data.content ?? data.text ?? '',
      toolId: String(data.tool_use_id ?? data.id ?? ''),
    };
    const chatEvent: ChatEvent = {
      ...baseEvent,
      state: 'delta',
      content: '',
      blocks: [block],
    };
    for (const cb of chatListeners) cb(chatEvent);
    return;
  }
}

/* ── Reconnect ─────────────────────────────────────────────────────── */

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectAttempts++;
  const delay = Math.min(
    BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts - 1),
    MAX_RECONNECT_DELAY,
  );
  console.log(`[openclaw] reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

/* ── Public API ────────────────────────────────────────────────────── */

export function connect(): void {
  if (ws) return;
  if (typeof window === 'undefined') return; // SSR guard
  if (!OPENCLAW_WS_URL) return; // no gateway configured

  setState('connecting');

  try {
    ws = new WebSocket(OPENCLAW_WS_URL);
  } catch (err) {
    console.error('[openclaw] WebSocket creation failed:', err);
    setState('error');
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    // Wait for connect.challenge event — don't set connected yet
  };

  ws.onmessage = (evt) => {
    try {
      const frame = JSON.parse(evt.data) as Frame;
      handleFrame(frame);
    } catch {
      // ignore malformed frames
    }
  };

  ws.onerror = () => {
    // onclose will fire after this — handle reconnect there
  };

  ws.onclose = () => {
    ws = null;
    // Reject all pending requests
    for (const [id, pending] of pendingRequests) {
      pending.reject(new Error('Connection closed'));
      pendingRequests.delete(id);
    }
    if (state !== 'disconnected') {
      setState('error');
      scheduleReconnect();
    }
  };
}

export function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = 0;
  if (ws) {
    setState('disconnected');
    ws.close();
    ws = null;
  }
}

export function getState(): ConnectionState {
  return state;
}

export function isConnected(): boolean {
  return state === 'connected';
}

/**
 * Send a chat message to an OpenClaw agent.
 * Returns the runId for tracking/aborting.
 */
export async function sendChat(sessionKey: string, message: string): Promise<string> {
  const idempotencyKey = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = await sendRequest('chat.send', {
    sessionKey,
    message,
    deliver: false,
    idempotencyKey,
  });
  return String(payload.runId ?? idempotencyKey);
}

/**
 * Abort a running chat response.
 */
export async function abortChat(sessionKey: string, runId?: string): Promise<void> {
  await sendRequest('chat.abort', {
    sessionKey,
    ...(runId ? { runId } : {}),
  });
}

/**
 * Build the session key for a given user.
 * Format: agent:{agentId}:web-{userId}
 */
export function buildSessionKey(userId: string): string {
  return `agent:${OPENCLAW_AGENT_ID}:web-${userId}`;
}

/* ── Session Preview (surfaces tool calls) ─────────────────────────── */

export interface SessionPreviewItem {
  role: 'user' | 'assistant' | 'tool';
  text: string;
}

/**
 * Fetch session preview which includes tool calls the gateway doesn't stream.
 * The preview shows the full conversation including `role: "tool"` items
 * that contain exec calls and their results.
 *
 * Returns parsed tool blocks that can be injected into the UI.
 */
export async function fetchSessionToolCalls(sessionKey: string): Promise<ChatContentBlock[]> {
  try {
    const payload = await sendRequest('sessions.preview', { keys: [sessionKey] });
    const previews = (payload.previews as Array<Record<string, unknown>>) ?? [];
    if (previews.length === 0) return [];

    const preview = previews[0];
    const items = (preview.items as SessionPreviewItem[]) ?? [];

    // Extract tool items and pair them: "call <name>" followed by result JSON
    const blocks: ChatContentBlock[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.role !== 'tool') continue;

      const text = item.text || '';

      // Tool call announcement: "call exec", "*text* On it! Routing..."
      if (text.startsWith('call ') || text.match(/^[*_]|^On it|^Setting|^Routing|^Checking/i)) {
        // This is the tool invocation or coordinator pre-text
        // Look ahead for the result (next tool item with JSON or text)
        const nextTool = items[i + 1];
        if (nextTool && nextTool.role === 'tool') {
          // Try to parse as JSON (API result)
          let toolResult: unknown = nextTool.text;
          try { toolResult = JSON.parse(nextTool.text); } catch { /* keep as string */ }

          const toolName = text.startsWith('call ') ? text.slice(5).trim() : 'exec';
          const toolId = `preview-${i}`;

          blocks.push({
            type: 'tool_use',
            toolName,
            toolInput: inferToolInput(toolResult),
            toolId,
          });
          blocks.push({
            type: 'tool_result',
            toolResult,
            toolId,
          });
          i++; // skip the result item
        }
        continue;
      }

      // Standalone tool result (not paired with a call announcement)
      let toolResult: unknown = text;
      try { toolResult = JSON.parse(text); } catch { /* keep as string */ }

      if (typeof toolResult === 'object' && toolResult !== null) {
        const toolId = `preview-${i}`;
        blocks.push({
          type: 'tool_use',
          toolName: 'exec',
          toolInput: inferToolInput(toolResult),
          toolId,
        });
        blocks.push({
          type: 'tool_result',
          toolResult,
          toolId,
        });
      }
    }

    return blocks;
  } catch (err) {
    console.warn('[openclaw] fetchSessionToolCalls failed:', err);
    return [];
  }
}

/** Infer tool input from the result (best effort for display classification). */
function inferToolInput(result: unknown): Record<string, unknown> {
  if (typeof result !== 'object' || result === null) return {};
  const data = result as Record<string, unknown>;
  const inner = (data.data as Record<string, unknown>) ?? data;

  // Infer the API endpoint from the response shape
  if (inner.missionId !== undefined && inner.guildName !== undefined) {
    return { command: `curl -s -X POST .../api/smart-create` };
  }
  if (inner.guilds !== undefined && inner.missionsCreated !== undefined) {
    return { command: `curl -s .../api/status` };
  }
  if (inner.result !== undefined && inner.completedAt !== undefined) {
    return { command: `curl -s .../api/mission/${inner.missionId || '?'}/result` };
  }
  if (inner.credits !== undefined) {
    return { command: `curl -s .../api/credits` };
  }
  return {};
}

/* ── History ───────────────────────────────────────────────────────── */

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  blocks: ChatContentBlock[];
  timestamp?: number;
}

/**
 * Fetch chat history for a session.
 * Returns parsed messages with blocks.
 */
export async function fetchHistory(sessionKey: string, limit = 50): Promise<HistoryMessage[]> {
  try {
    const payload = await sendRequest('chat.history', { sessionKey, limit });
    const messages = (payload.messages as Array<Record<string, unknown>>) ?? [];

    return messages.map(msg => {
      // User messages may have content as a plain string; assistant messages use block arrays
      const rawContent = msg.content;
      if (typeof rawContent === 'string') {
        return {
          role: (msg.role as 'user' | 'assistant') ?? 'user',
          content: rawContent,
          blocks: [],
          timestamp: msg.timestamp as number | undefined,
        };
      }

      const rawBlocks = rawContent as Array<Record<string, unknown>> | undefined;
      const blocks = parseRawBlocks(rawBlocks);
      const textParts = blocks.filter(b => b.type === 'text' && b.text).map(b => b.text!);

      return {
        role: (msg.role as 'user' | 'assistant') ?? 'assistant',
        content: textParts.join(''),
        blocks,
        timestamp: msg.timestamp as number | undefined,
      };
    });
  } catch (err) {
    console.warn('[openclaw] fetchHistory failed:', err);
    return [];
  }
}

/**
 * Parse raw content blocks from OpenClaw into typed ChatContentBlocks.
 * Shared between live events and history loading.
 */
export function parseRawBlocks(rawBlocks?: Array<Record<string, unknown>>): ChatContentBlock[] {
  if (!rawBlocks) return [];

  const blocks: ChatContentBlock[] = [];
  for (const b of rawBlocks) {
    switch (b.type) {
      case 'text':
        if (b.text) {
          blocks.push({ type: 'text', text: String(b.text) });
        }
        break;
      case 'tool_use':
        blocks.push({
          type: 'tool_use',
          toolName: String(b.name ?? ''),
          toolInput: (b.input as Record<string, unknown>) ?? {},
          toolId: String(b.id ?? ''),
        });
        break;
      case 'tool_result':
        blocks.push({
          type: 'tool_result',
          toolResult: b.content ?? b.text ?? '',
          toolId: String(b.tool_use_id ?? ''),
        });
        break;
    }
  }
  return blocks;
}

/* ── Subscriptions ─────────────────────────────────────────────────── */

export function onStateChange(callback: StateCallback): () => void {
  stateListeners.add(callback);
  return () => { stateListeners.delete(callback); };
}

export function onChatEvent(callback: ChatCallback): () => void {
  chatListeners.add(callback);
  return () => { chatListeners.delete(callback); };
}
