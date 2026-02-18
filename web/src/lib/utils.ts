/** Format a timestamp as relative time (e.g. "3s", "5m", "2h", "1d"). */
export function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Truncate an address to "0xAbCd...1234" format. */
export function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/** Render star rating as unicode string. */
export function renderStars(rating: number, max = 5): string {
  const full = Math.floor(rating);
  const empty = max - full;
  return '\u2605'.repeat(full) + '\u2606'.repeat(empty);
}

/** Structured content block from OpenClaw responses. */
export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: unknown;
  toolId?: string;
}

/** Chat message structure for ChatBar. */
export interface ChatMessage {
  id: number;
  role: 'user' | 'system' | 'result' | 'assistant';
  text: string;
  txHash?: string;
  rating?: number;
  missionId?: number;
  timestamp: number;
  blocks?: ContentBlock[];
}
