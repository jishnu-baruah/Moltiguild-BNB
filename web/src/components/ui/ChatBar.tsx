'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useSmartCreate, useRateMission, useMissionResult, useUser } from '@/lib/hooks';
import { useOpenClawConnection, useOpenClawChat, buildSessionKey } from '@/lib/openclaw-hooks';
import { subscribeSSE, sseToFeedEvent } from '@/lib/sse';
import { truncateAddress, timeAgo } from '@/lib/utils';
import { getNetwork } from '@/lib/network';
import type { ChatMessage, ContentBlock } from '@/lib/utils';
import type { ChatContentBlock } from '@/lib/openclaw-client';

interface ChatBarProps {
  expanded: boolean;
  onToggle: () => void;
}

let nextId = 1;

/* ── Quick action definitions ────────────────────────────────────────── */

const QUICK_ACTIONS = [
  { label: 'Create a quest', icon: '\u2694' },
  { label: 'Check balance', icon: '\u26C1' },
  { label: 'List guilds', icon: '\u2726' },
  { label: 'Open missions', icon: '\u2689' },
  { label: 'Help', icon: '\u2698' },
];

/* ── Tool action classification ──────────────────────────────────────── */

interface ToolAction {
  label: string;
  color: string;
  icon: string;
}

function classifyToolAction(block: ContentBlock | ChatContentBlock): ToolAction {
  const input = ('toolInput' in block ? block.toolInput : undefined) ?? {};
  const name = ('toolName' in block ? block.toolName : '') || 'tool';

  // OpenClaw coordinator uses `exec` tool with `command` input containing curl commands
  const command = typeof input.command === 'string' ? input.command : '';
  const url = typeof input.url === 'string' ? input.url : '';
  // Check both direct URL and curl command for API endpoint patterns
  const target = url || command;

  if (target.includes('/api/smart-create') || target.includes('smart-create')) {
    return { label: 'Dispatching quest', icon: '\u2694', color: 'var(--ember)' };
  }
  if (target.includes('/result')) {
    return { label: 'Fetching result', icon: '\u2689', color: 'var(--indigo)' };
  }
  if (target.includes('/rate')) {
    return { label: 'Submitting rating', icon: '\u2605', color: 'var(--gold)' };
  }
  if (target.includes('/credits') || target.includes('/balance')) {
    return { label: 'Checking balance', icon: '\u26C1', color: 'var(--gold)' };
  }
  if (target.includes('/api/status')) {
    return { label: 'Checking status', icon: '\u2726', color: 'var(--verdigris)' };
  }
  if (target.includes('/api/guilds')) {
    return { label: 'Listing guilds', icon: '\u2726', color: 'var(--indigo)' };
  }
  if (target.includes('/api/missions')) {
    return { label: 'Listing missions', icon: '\u2689', color: 'var(--indigo)' };
  }
  if (target.includes('/api/world/auto-assign')) {
    return { label: 'Assigning guild plots', icon: '\u26ED', color: 'var(--verdigris)' };
  }
  if (target.includes('/assign')) {
    return { label: 'Assigning plot', icon: '\u26ED', color: 'var(--verdigris)' };
  }
  if (target.includes('/release')) {
    return { label: 'Releasing plot', icon: '\u26EC', color: 'var(--gold)' };
  }
  if (target.includes('/api/world/plots') || target.includes('/api/world/districts')) {
    return { label: 'Querying world map', icon: '\u2609', color: 'var(--indigo)' };
  }
  if (name === 'exec') {
    // Generic exec — extract a short label from the command
    const cmdShort = command.split(' ').slice(0, 2).join(' ') || 'exec';
    return { label: `Running ${cmdShort}`, icon: '\u2699', color: 'var(--verdigris)' };
  }
  if (name === 'read') {
    return { label: 'Reading file', icon: '\u2689', color: 'var(--parchment-dim)' };
  }
  if (name === 'write') {
    return { label: 'Writing file', icon: '\u270E', color: 'var(--parchment-dim)' };
  }
  return { label: `Running ${name}`, icon: '\u2699', color: 'var(--parchment-dim)' };
}

function parseToolResult(block: ContentBlock | ChatContentBlock): { text: string; isError: boolean } {
  const raw = ('toolResult' in block ? block.toolResult : undefined);
  if (!raw) return { text: '', isError: false };

  if (typeof raw === 'string') {
    try { return formatResultObject(JSON.parse(raw)); }
    catch { return { text: raw, isError: false }; }
  }
  if (typeof raw === 'object') return formatResultObject(raw as Record<string, unknown>);
  return { text: String(raw), isError: false };
}

function formatResultObject(obj: Record<string, unknown>): { text: string; isError: boolean } {
  if (obj.error) return { text: String(obj.error), isError: true };
  if (obj.missionId != null) return { text: `Mission #${obj.missionId} created`, isError: false };
  if (obj.result) return { text: String(obj.result).slice(0, 400), isError: false };
  if (obj.credits != null) return { text: `Balance: ${obj.credits} tBNB`, isError: false };
  // World governance responses
  if (obj.assignment) {
    const a = obj.assignment as Record<string, unknown>;
    return { text: `Plot ${a.plotId} assigned to guild #${a.guildId} (${a.tier})`, isError: false };
  }
  if (obj.released) return { text: `Plot ${obj.released} released`, isError: false };
  if (obj.assigned != null && obj.skipped != null) {
    return { text: `Batch: ${obj.assigned} assigned, ${obj.skipped} skipped${obj.released ? `, ${obj.released} released` : ''}`, isError: false };
  }
  if (Array.isArray(obj.plots)) return { text: `${obj.plots.length} available plots`, isError: false };
  return { text: JSON.stringify(obj, null, 2).slice(0, 400), isError: false };
}

/* ── Model artifact stripping ──────────────────────────────────────────── */

/**
 * Strip model output artifacts (e.g. Kimi K2.5 emitting literal `<final`,
 * `</final>`, `<final_answer>` tags, and similar XML-like model control tokens).
 */
function stripModelArtifacts(text: string): string {
  return text
    .replace(/<\/?final[^>]*>/gi, '')  // <final>, </final>, <final_answer>, etc.
    .replace(/<\/?thinking[^>]*>/gi, '')  // <thinking>, </thinking>
    .replace(/<\/?answer[^>]*>/gi, '')  // <answer>, </answer>
    .replace(/<\/?result[^>]*>/gi, '')  // <result>, </result>
    .trim();
}

/* ── Markdown renderer (regex → React nodes) ─────────────────────────── */

function renderMarkdown(text: string): React.ReactNode[] {
  text = stripModelArtifacts(text);
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];
  let codeBlockKey = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block fence
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        nodes.push(
          <pre key={`code-${codeBlockKey++}`} style={{
            background: '#0a0c08',
            border: '1px solid var(--walnut-border)',
            borderRadius: 3,
            padding: '10px 14px',
            margin: '6px 0',
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 12,
            color: 'var(--verdigris)',
            overflowX: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            position: 'relative',
          }}>
            {codeLines.join('\n')}
          </pre>
        );
        codeLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Headers
    if (line.startsWith('### ')) {
      nodes.push(<div key={i} style={{ fontFamily: "'Cinzel', serif", fontSize: 13, color: 'var(--ember)', margin: '8px 0 4px', fontWeight: 600 }}>{line.slice(4)}</div>);
      continue;
    }
    if (line.startsWith('## ')) {
      nodes.push(<div key={i} style={{ fontFamily: "'Cinzel', serif", fontSize: 14, color: 'var(--ember)', margin: '10px 0 4px', fontWeight: 600 }}>{line.slice(3)}</div>);
      continue;
    }
    if (line.startsWith('# ')) {
      nodes.push(<div key={i} style={{ fontFamily: "'Cinzel', serif", fontSize: 15, color: 'var(--ember-glow)', margin: '12px 0 6px', fontWeight: 700 }}>{line.slice(2)}</div>);
      continue;
    }

    // Blockquote
    if (line.startsWith('> ')) {
      nodes.push(
        <div key={i} style={{ borderLeft: '2px solid var(--parchment-dim)', paddingLeft: 10, fontStyle: 'italic', color: 'var(--parchment-dim)', margin: '4px 0' }}>
          {renderInline(line.slice(2))}
        </div>
      );
      continue;
    }

    // Unordered list item
    if (line.match(/^[-*]\s/)) {
      nodes.push(
        <div key={i} style={{ paddingLeft: 16, margin: '2px 0', position: 'relative' }}>
          <span style={{ position: 'absolute', left: 4, color: 'var(--ember)' }}>{'\u25C6'}</span>
          {renderInline(line.slice(2))}
        </div>
      );
      continue;
    }

    // Numbered list item
    const numMatch = line.match(/^(\d+)[.)]\s(.+)/);
    if (numMatch) {
      nodes.push(
        <div key={i} style={{ paddingLeft: 20, margin: '2px 0', position: 'relative' }}>
          <span style={{ position: 'absolute', left: 0, color: 'var(--ember)', fontFamily: "'Cinzel', serif", fontSize: 11 }}>{numMatch[1]}.</span>
          {renderInline(numMatch[2])}
        </div>
      );
      continue;
    }

    // Table row (lines starting with |)
    if (line.trim().startsWith('|')) {
      // Collect consecutive table lines
      const tableLines: string[] = [line];
      while (i + 1 < lines.length && lines[i + 1].trim().startsWith('|')) {
        tableLines.push(lines[++i]);
      }
      // Parse table: first line = header, second = separator (skip), rest = rows
      const parseRow = (row: string) =>
        row.split('|').slice(1, -1).map(cell => cell.trim());

      const headerCells = parseRow(tableLines[0]);
      const dataRows = tableLines
        .slice(1)
        .filter(r => !r.match(/^\s*\|[\s\-:|]+\|\s*$/)) // skip separator rows
        .map(parseRow);

      nodes.push(
        <div key={i} style={{ overflowX: 'auto', margin: '6px 0' }}>
          <table style={{
            borderCollapse: 'collapse', width: '100%',
            fontFamily: "'Crimson Pro', serif", fontSize: 12,
          }}>
            <thead>
              <tr>
                {headerCells.map((cell, ci) => (
                  <th key={ci} style={{
                    borderBottom: '2px solid var(--ember)',
                    padding: '4px 8px', textAlign: 'left',
                    color: 'var(--ember)', fontFamily: "'Cinzel', serif",
                    fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
                  }}>{renderInline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dataRows.map((row, ri) => (
                <tr key={ri} style={{
                  borderBottom: '1px solid var(--walnut-border)',
                  background: ri % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.06)',
                }}>
                  {row.map((cell, ci) => (
                    <td key={ci} style={{
                      padding: '3px 8px', color: 'var(--parchment)',
                      whiteSpace: 'nowrap',
                    }}>{renderInline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Empty line
    if (!line.trim()) {
      nodes.push(<div key={i} style={{ height: 6 }} />);
      continue;
    }

    // Regular paragraph
    nodes.push(<div key={i} style={{ margin: '2px 0' }}>{renderInline(line)}</div>);
  }

  // Flush unclosed code block
  if (inCodeBlock && codeLines.length > 0) {
    nodes.push(
      <pre key={`code-${codeBlockKey}`} style={{
        background: '#0a0c08', border: '1px solid var(--walnut-border)', borderRadius: 3,
        padding: '10px 14px', margin: '6px 0', fontFamily: "'JetBrains Mono', monospace",
        fontSize: 12, color: 'var(--verdigris)', overflowX: 'auto', whiteSpace: 'pre-wrap',
      }}>
        {codeLines.join('\n')}
      </pre>
    );
  }

  return nodes;
}

function renderInline(text: string): React.ReactNode[] {
  // Process **bold**, *italic*, `code`, and [text](url)
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Bold (must check before italic since ** starts with *)
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    // Italic (single * not preceded/followed by another *)
    const italicMatch = remaining.match(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/);
    // Inline code
    const codeMatch = remaining.match(/`([^`]+)`/);
    // Link
    const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/);

    // Find the earliest match
    const matches = [
      boldMatch ? { type: 'bold', index: boldMatch.index!, length: boldMatch[0].length, content: boldMatch[1] } : null,
      italicMatch ? { type: 'italic', index: italicMatch.index!, length: italicMatch[0].length, content: italicMatch[1] } : null,
      codeMatch ? { type: 'code', index: codeMatch.index!, length: codeMatch[0].length, content: codeMatch[1] } : null,
      linkMatch ? { type: 'link', index: linkMatch.index!, length: linkMatch[0].length, content: linkMatch[1], url: linkMatch[2] } : null,
    ].filter(Boolean).sort((a, b) => a!.index - b!.index);

    if (matches.length === 0) {
      parts.push(remaining);
      break;
    }

    const m = matches[0]!;
    if (m.index > 0) {
      parts.push(remaining.slice(0, m.index));
    }

    if (m.type === 'bold') {
      parts.push(<strong key={key++} style={{ color: 'var(--parchment)' }}>{m.content}</strong>);
    } else if (m.type === 'italic') {
      parts.push(<em key={key++} style={{ color: 'var(--parchment-dim)', fontStyle: 'italic' }}>{m.content}</em>);
    } else if (m.type === 'code') {
      parts.push(
        <code key={key++} style={{
          background: '#0a0c08', color: 'var(--verdigris)',
          fontFamily: "'JetBrains Mono', monospace", fontSize: '0.9em',
          padding: '1px 5px', borderRadius: 2,
        }}>{m.content}</code>
      );
    } else if (m.type === 'link') {
      parts.push(
        <a key={key++} href={m.url} target="_blank" rel="noopener noreferrer"
          style={{ color: 'var(--ember)', textDecoration: 'underline', textDecorationColor: 'rgba(196,113,59,0.4)' }}
        >{m.content}</a>
      );
    }

    remaining = remaining.slice(m.index + m.length);
  }

  return parts;
}

/* ── Main Component ───────────────────────────────────────────────── */

export default function ChatBar({ expanded, onToggle }: ChatBarProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [hoveredStar, setHoveredStar] = useState(0);
  const [ratings, setRatings] = useState<Record<number, number>>({});
  const [pendingMissionId, setPendingMissionId] = useState<number | null>(null);
  const [quickActionsVisible, setQuickActionsVisible] = useState(true);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackedMissions = useRef<Set<number>>(new Set());
  const historyCountRef = useRef(0);
  const [, setTickCounter] = useState(0); // for timestamp refresh

  // OpenClaw connection + chat
  const { userId } = useUser();
  const sessionKey = buildSessionKey(userId || 'anon');
  const { isConnected, state: connState } = useOpenClawConnection();
  const openClaw = useOpenClawChat(sessionKey);

  // REST fallback hooks
  const smartCreate = useSmartCreate();
  const rateMission = useRateMission();
  const { data: missionResult } = useMissionResult(pendingMissionId);

  // Timestamp refresh every 30s
  useEffect(() => {
    const iv = setInterval(() => setTickCounter(c => c + 1), 30000);
    return () => clearInterval(iv);
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (expanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [expanded, messages, openClaw.streamText]);

  const addMessage = useCallback((partial: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    setMessages(prev => [...prev, { ...partial, id: nextId++, timestamp: Date.now() }]);
  }, []);

  // Load history on connect
  const historyLoadedRef = useRef(false);
  useEffect(() => {
    if (openClaw.historyLoaded && openClaw.history.length > 0 && !historyLoadedRef.current) {
      historyLoadedRef.current = true;
      const historyMessages: ChatMessage[] = openClaw.history.map(h => ({
        id: nextId++,
        role: h.role === 'user' ? 'user' as const : 'assistant' as const,
        text: h.role === 'assistant' ? stripModelArtifacts(h.content) : h.content,
        timestamp: h.timestamp || Date.now() - 60000,
        blocks: h.blocks.length > 0 ? h.blocks.map(b => ({
          type: b.type,
          text: b.type === 'text' && b.text ? stripModelArtifacts(b.text) : b.text,
          toolName: b.toolName,
          toolInput: b.toolInput,
          toolResult: b.toolResult as Record<string, unknown> | undefined,
          toolId: b.toolId,
        })) : undefined,
      }));
      if (historyMessages.length > 0) {
        historyCountRef.current = historyMessages.length;
        setMessages(prev => [...historyMessages, ...prev]);
        setQuickActionsVisible(false);
      }
    }
  }, [openClaw.historyLoaded, openClaw.history]);

  // Commit stream to messages + auto-track mission IDs
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    if (prevStreamingRef.current && !openClaw.isStreaming && openClaw.streamText) {
      const cleanedText = stripModelArtifacts(openClaw.streamText);
      const blocks: ContentBlock[] = openClaw.streamBlocks.map(b => ({
        type: b.type,
        text: b.type === 'text' && b.text ? stripModelArtifacts(b.text) : b.text,
        toolName: b.toolName,
        toolInput: b.toolInput,
        toolResult: b.toolResult as Record<string, unknown> | undefined,
        toolId: b.toolId,
      }));
      addMessage({
        role: 'assistant',
        text: cleanedText,
        blocks: blocks.length > 0 ? blocks : undefined,
      });

      // Auto-extract mission IDs from coordinator text and tool results
      const allText = openClaw.streamText + ' ' +
        blocks.filter(b => b.type === 'tool_result' && b.toolResult)
          .map(b => JSON.stringify(b.toolResult)).join(' ');
      const missionMatches = allText.match(/(?:mission|quest|Mission|Quest)\s*#?(\d+)/gi);
      if (missionMatches) {
        for (const match of missionMatches) {
          const num = match.match(/(\d+)/);
          if (num) trackedMissions.current.add(Number(num[1]));
        }
      }
      // Also check for missionId in JSON responses
      const jsonIdMatches = allText.match(/"missionId"\s*:\s*(\d+)/g);
      if (jsonIdMatches) {
        for (const match of jsonIdMatches) {
          const num = match.match(/(\d+)/);
          if (num) trackedMissions.current.add(Number(num[1]));
        }
      }
    }
    prevStreamingRef.current = openClaw.isStreaming;
  }, [openClaw.isStreaming, openClaw.streamText, openClaw.streamBlocks, addMessage]);

  // Enrich last assistant message with tool blocks from session preview
  useEffect(() => {
    if (openClaw.toolBlocks.length === 0) return;
    setMessages(prev => {
      // Find the last assistant message and add tool blocks
      const updated = [...prev];
      for (let i = updated.length - 1; i >= 0; i--) {
        if (updated[i].role === 'assistant') {
          const existing = updated[i].blocks || [];
          // Convert ChatContentBlock to ContentBlock
          const newBlocks: ContentBlock[] = openClaw.toolBlocks.map(b => ({
            type: b.type,
            text: b.text,
            toolName: b.toolName,
            toolInput: b.toolInput,
            toolResult: b.toolResult as Record<string, unknown> | undefined,
            toolId: b.toolId,
          }));
          updated[i] = {
            ...updated[i],
            blocks: [...newBlocks, ...existing],
          };

          // Also extract mission IDs from tool results
          for (const b of openClaw.toolBlocks) {
            if (b.toolResult) {
              const json = JSON.stringify(b.toolResult);
              const idMatch = json.match(/"missionId"\s*:\s*(\d+)/);
              if (idMatch) trackedMissions.current.add(Number(idMatch[1]));
            }
          }
          break;
        }
      }
      return updated;
    });
  }, [openClaw.toolBlocks]);

  // OpenClaw error
  useEffect(() => {
    if (openClaw.error) {
      addMessage({ role: 'system', text: `Scribe error: ${openClaw.error}` });
    }
  }, [openClaw.error, addMessage]);

  // REST fallback: mission result
  useEffect(() => {
    if (!missionResult || !pendingMissionId) return;
    if (missionResult.result) {
      addMessage({ role: 'system', text: `Quest #${pendingMissionId} complete.` });
      addMessage({ role: 'result', text: missionResult.result, missionId: pendingMissionId, rating: 0 });
      setPendingMissionId(null);
    }
  }, [missionResult, pendingMissionId, addMessage]);

  // SSE subscription — show ALL mission lifecycle events for real-time visibility
  useEffect(() => {
    if (!expanded) return; // only subscribe when chat is open
    const unsub = subscribeSSE((sse) => {
      const event = sseToFeedEvent(sse);
      if (!event) return;
      const mid = event.missionId;
      const isTracked = mid ? trackedMissions.current.has(mid) : false;

      switch (event.type) {
        case 'mission_created': {
          // budget may or may not include "tBNB" suffix
          const budgetStr = event.budget ? String(event.budget).replace(/ tBNB$/, '') : '';
          const budgetInfo = budgetStr ? ` \u2022 ${budgetStr} tBNB` : '';
          addMessage({
            role: 'system',
            text: `\u2694 Quest #${mid} dispatched${budgetInfo}`,
            txHash: event.txHash || undefined,
          });
          break;
        }
        case 'mission_claimed': {
          const agent = event.agent ? truncateAddress(event.agent) : 'an agent';
          addMessage({
            role: 'system',
            text: `\u269C Agent ${agent} accepted quest #${mid}`,
            txHash: event.txHash || undefined,
          });
          break;
        }
        case 'mission_completed': {
          // paid may already include "tBNB" suffix
          const paidStr = event.paid ? String(event.paid).replace(/ tBNB$/, '') : '';
          const payInfo = paidStr ? ` \u2014 paid ${paidStr} tBNB` : '';
          const agent = event.agent ? ` by ${truncateAddress(event.agent)}` : '';
          addMessage({
            role: 'system',
            text: `\u2713 Quest #${mid} complete${agent}${payInfo}`,
            txHash: event.txHash || undefined,
          });
          // Auto-fetch result for tracked missions
          if (isTracked && mid) {
            setPendingMissionId(mid);
          }
          break;
        }
        case 'mission_rated': {
          const stars = event.score ? '\u2605'.repeat(event.score) + '\u2606'.repeat(5 - event.score) : '';
          addMessage({
            role: 'system',
            text: `\u2605 Quest #${mid} rated ${stars}`,
            txHash: event.txHash || undefined,
          });
          break;
        }
      }
    });
    return unsub;
  }, [expanded, addMessage]);

  const isBusy = openClaw.isStreaming || smartCreate.isPending;

  const handleSend = useCallback((text?: string) => {
    const task = (text || inputValue).trim();
    if (!task || isBusy) return;

    addMessage({ role: 'user', text: task });
    setInputValue('');
    setQuickActionsVisible(false);

    if (isConnected) {
      openClaw.send(`[network:${getNetwork().key}] ${task}`);
    } else {
      addMessage({ role: 'system', text: 'Scribe offline \u2014 dispatching quest directly...' });
      smartCreate.mutate(
        { task },
        {
          onSuccess: (data) => {
            const mid = Number(data.missionId);
            trackedMissions.current.add(mid);
            addMessage({ role: 'system', text: `Quest #${mid} dispatched. Agent working (~60s)`, txHash: data.txHash });
            setPendingMissionId(mid);
          },
          onError: (err) => {
            addMessage({ role: 'system', text: `Error: ${err instanceof Error ? err.message : 'Quest dispatch failed'}` });
          },
        },
      );
    }
  }, [inputValue, isBusy, isConnected, openClaw, smartCreate, addMessage]);

  const handleRate = useCallback((messageId: number, star: number, missionId?: number) => {
    setRatings(prev => ({ ...prev, [messageId]: star }));
    if (missionId) rateMission.mutate({ missionId, rating: star });
  }, [rateMission]);

  const handleCopy = useCallback((msgId: number, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(msgId);
      setTimeout(() => setCopiedId(null), 1500);
    });
  }, []);

  // ── Collapsed bar ──
  if (!expanded) {
    return (
      <div
        onClick={onToggle}
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, height: 40,
          background: 'rgba(26, 22, 16, 0.95)',
          backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
          borderTop: '2px solid rgba(196, 113, 59, 0.5)',
          boxShadow: '0 -2px 12px rgba(196, 113, 59, 0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 20px', cursor: 'pointer', zIndex: 100, pointerEvents: 'auto',
          transition: 'all 150ms ease',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderTopColor = 'var(--ember-glow)'; }}
        onMouseLeave={e => { e.currentTarget.style.borderTopColor = 'rgba(196, 113, 59, 0.3)'; }}
      >
        <span style={{
          fontFamily: "'Crimson Pro', serif", fontStyle: 'italic', fontSize: 14,
          color: 'var(--parchment-dim)', display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <ConnectionDot state={connState} />
          &#10022; Summon the Scribe...
        </span>
        <span style={{ color: 'var(--parchment-dim)', fontSize: 16 }}>&#8862;</span>
      </div>
    );
  }

  // ── Expanded chat panel ──
  return (
    <div className="panel" style={{
      position: 'fixed', bottom: 0, left: 0, right: 0,
      maxHeight: 440, zIndex: 100, pointerEvents: 'auto',
      display: 'flex', flexDirection: 'column',
      animation: 'riseUp 350ms cubic-bezier(0.16, 1, 0.3, 1) both',
      borderTop: '2px solid var(--ember)',
    }}>
      {/* Connection banner */}
      {connState !== 'connected' && (
        <div style={{
          padding: '4px 20px', fontSize: 12,
          fontFamily: "'Crimson Pro', serif", fontStyle: 'italic',
          display: 'flex', alignItems: 'center', gap: 6,
          background: connState === 'connecting' ? 'rgba(184, 150, 46, 0.08)' : 'rgba(248, 113, 113, 0.06)',
          color: connState === 'connecting' ? 'var(--gold)' : 'var(--parchment-dim)',
          borderBottom: '1px solid var(--walnut-border)',
        }}>
          <span style={{
            display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
            background: connState === 'connecting' ? 'var(--gold)' : '#6b7280',
            animation: connState === 'connecting' ? 'coinPulse 1.5s ease-in-out infinite' : 'none',
            flexShrink: 0,
          }} />
          {connState === 'connecting' ? 'Reconnecting to the Scribe...'
           : connState === 'error' ? 'Connection lost \u2014 retrying...'
           : 'Scribe offline \u2014 quests dispatched directly'}
        </div>
      )}

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 20px', borderBottom: '1px solid var(--walnut-border)', flexShrink: 0,
      }}>
        <span className="font-display" style={{
          fontSize: 12, letterSpacing: '0.15em', color: 'var(--ember)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <ConnectionDot state={connState} />
          &#10022; SCRIBE&apos;S CODEX
        </span>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {openClaw.isStreaming && (
            <button onClick={() => openClaw.abort()} style={{
              background: 'none', border: '1px solid rgba(196, 113, 59, 0.4)',
              color: 'var(--ember)', fontSize: 11, fontFamily: "'Cinzel', serif",
              cursor: 'pointer', padding: '2px 10px', borderRadius: 3,
              transition: 'all 150ms ease',
            }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(196, 113, 59, 0.15)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
            >Stop</button>
          )}
          <button onClick={onToggle} style={{
            background: 'none', border: 'none', color: 'var(--parchment-dim)',
            fontSize: 16, cursor: 'pointer', padding: 2, transition: 'color 150ms ease',
          }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--ember)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--parchment-dim)')}
            aria-label="Close chat"
          >&#10005;</button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto', padding: '16px 20px',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        {/* Quick action chips */}
        {quickActionsVisible && messages.length === 0 && !openClaw.isStreaming && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', padding: '12px 0' }}>
            {QUICK_ACTIONS.map(qa => (
              <button key={qa.label} onClick={() => handleSend(qa.label)} style={{
                background: 'rgba(196, 113, 59, 0.08)',
                border: '1px solid rgba(196, 113, 59, 0.35)',
                borderRadius: 20, padding: '5px 14px',
                fontFamily: "'Cinzel', serif", fontSize: 11,
                color: 'var(--ember)', cursor: 'pointer',
                transition: 'all 200ms ease', letterSpacing: '0.05em',
                display: 'flex', alignItems: 'center', gap: 5,
              }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(196, 113, 59, 0.2)';
                  e.currentTarget.style.borderColor = 'var(--ember)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(196, 113, 59, 0.08)';
                  e.currentTarget.style.borderColor = 'rgba(196, 113, 59, 0.35)';
                  e.currentTarget.style.transform = 'none';
                }}
              >
                <span style={{ fontSize: 13 }}>{qa.icon}</span>
                {qa.label}
              </button>
            ))}
          </div>
        )}

        {/* History divider — rendered inline within messages map below */}

        {/* Empty state */}
        {messages.length === 0 && !openClaw.isStreaming && !quickActionsVisible && (
          <div style={{
            fontFamily: "'Crimson Pro', serif", fontStyle: 'italic',
            fontSize: 14, color: 'var(--parchment-dim)', textAlign: 'center', padding: '20px 0',
          }}>
            {isConnected ? 'The Scribe awaits your command...' : 'Write your quest below to dispatch an agent...'}
          </div>
        )}

        {messages.map((msg, idx) => (
          <React.Fragment key={msg.id}>
            {/* History divider — after last history message, before live messages */}
            {historyCountRef.current > 0 && idx === historyCountRef.current && (
              <div style={{
                textAlign: 'center', padding: '4px 0', margin: '4px 0',
                borderBottom: '1px dashed var(--walnut-border)',
              }}>
                <span style={{
                  fontFamily: "'Crimson Pro', serif", fontStyle: 'italic',
                  fontSize: 11, color: 'var(--parchment-dim)',
                  background: 'var(--walnut)', padding: '0 10px',
                }}>
                  Earlier scrolls {'\u2191'}
                </span>
              </div>
            )}
            <MessageBubble
              message={msg}
              rating={ratings[msg.id] ?? msg.rating ?? 0}
              hoveredStar={hoveredStar}
              onStarHover={setHoveredStar}
              onRate={star => handleRate(msg.id, star, msg.missionId ?? extractResultMissionId(msg) ?? undefined)}
              onCopy={() => handleCopy(msg.id, msg.text)}
              isCopied={copiedId === msg.id}
            />
          </React.Fragment>
        ))}

        {/* Live streaming bubble */}
        {openClaw.isStreaming && (openClaw.streamBlocks.length > 0 || openClaw.streamText) && (
          <StreamingBubble
            text={openClaw.streamText}
            blocks={openClaw.streamBlocks}
          />
        )}

        {/* Streaming started but no content yet */}
        {openClaw.isStreaming && openClaw.streamBlocks.length === 0 && !openClaw.streamText && (
          <div style={{ borderLeft: '2px solid var(--indigo)', paddingLeft: 12, marginLeft: 12 }}>
            <span style={{
              fontFamily: "'Crimson Pro', serif", fontSize: 13,
              color: 'var(--parchment-dim)', animation: 'coinPulse 2s ease-in-out infinite',
            }}>
              Scribe is thinking...
            </span>
          </div>
        )}

        {/* REST fallback: awaiting */}
        {pendingMissionId && (
          <div style={{ borderLeft: '2px solid var(--ember)', paddingLeft: 12, marginLeft: 12 }}>
            <span style={{
              fontFamily: "'Crimson Pro', serif", fontSize: 13,
              color: 'var(--parchment-dim)', animation: 'coinPulse 2s ease-in-out infinite',
            }}>Awaiting result...</span>
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 20px', borderTop: '1px solid var(--walnut-border)', flexShrink: 0,
      }}>
        <input
          className="input-field"
          type="text"
          placeholder={isConnected ? 'Ask the Scribe anything...' : 'Write your quest here...'}
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
          style={{ flex: 1 }}
          disabled={isBusy}
        />
        <button
          className="btn-solid"
          style={{ flexShrink: 0, opacity: isBusy ? 0.5 : 1 }}
          onClick={() => handleSend()}
          disabled={isBusy}
        >
          {isBusy ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  );
}

/* ── Connection indicator ────────────────────────────────────────────── */

function ConnectionDot({ state }: { state: string }) {
  const colors: Record<string, string> = {
    connected: '#4ade80', connecting: '#fbbf24', error: '#f87171', disconnected: '#6b7280',
  };
  const color = colors[state] ?? colors.disconnected;

  return (
    <span
      title={state === 'connected' ? 'Scribe online' : state === 'connecting' ? 'Connecting...' : 'Scribe offline (fallback mode)'}
      style={{
        display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
        background: color,
        boxShadow: state === 'connected' ? `0 0 6px ${color}` : 'none',
        animation: state === 'connecting' ? 'coinPulse 1.5s ease-in-out infinite' : 'none',
        flexShrink: 0,
      }}
    />
  );
}

/* ── Collapsible tool block ──────────────────────────────────────────── */

function CollapsibleToolBlock({ useBlock, resultBlock }: {
  useBlock: ContentBlock | ChatContentBlock;
  resultBlock?: ContentBlock | ChatContentBlock;
}) {
  const [expanded, setExpanded] = useState(false);
  const action = classifyToolAction(useBlock);
  const result = resultBlock ? parseToolResult(resultBlock) : null;

  return (
    <div style={{
      borderLeft: `3px solid ${action.color}`,
      borderRadius: 2,
      margin: '4px 0',
      overflow: 'hidden',
      transition: 'all 200ms ease',
    }}>
      {/* Collapsed header */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 12px', cursor: 'pointer',
          background: 'rgba(0,0,0,0.15)',
          transition: 'background 150ms ease',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.25)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.15)'; }}
      >
        <span style={{ fontSize: 13 }}>{action.icon}</span>
        <span style={{
          fontFamily: "'Crimson Pro', serif", fontSize: 13,
          color: action.color, fontStyle: 'italic', flex: 1,
        }}>
          {action.label}
          {result && !result.isError && <span style={{ color: 'var(--verdigris)', marginLeft: 6 }}>{'\u2713'}</span>}
          {result?.isError && <span style={{ color: '#f87171', marginLeft: 6 }}>{'\u2717'}</span>}
        </span>
        <span style={{
          color: 'var(--parchment-dim)', fontSize: 10,
          transform: expanded ? 'rotate(180deg)' : 'none',
          transition: 'transform 200ms ease',
        }}>{'\u25BC'}</span>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div style={{ padding: '8px 12px', background: 'rgba(0,0,0,0.08)' }}>
          {/* Tool input */}
          {'toolInput' in useBlock && useBlock.toolInput && Object.keys(useBlock.toolInput).length > 0 && (
            <pre style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
              color: 'var(--parchment-dim)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              margin: 0, marginBottom: result ? 8 : 0,
            }}>
              {JSON.stringify(useBlock.toolInput, null, 2)}
            </pre>
          )}
          {/* Tool result */}
          {result && (
            <div style={{
              borderTop: '1px solid var(--walnut-border)', paddingTop: 6,
              fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
              color: result.isError ? '#f87171' : 'var(--verdigris)',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {result.text}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Streaming bubble ────────────────────────────────────────────────── */

function StreamingBubble({ text, blocks }: { text: string; blocks: ChatContentBlock[] }) {
  // Ember cursor element
  const cursor = (
    <span style={{
      display: 'inline-block', width: 6, height: 14,
      background: 'var(--ember)', marginLeft: 2,
      verticalAlign: 'text-bottom',
      animation: 'coinPulse 1s ease-in-out infinite',
      borderRadius: 1,
    }} />
  );

  // If we have text from agent events but no structured blocks yet, render text directly
  const hasBlocks = blocks.length > 0;
  const displayText = hasBlocks
    ? blocks.filter(b => b.type === 'text' && b.text).map(b => b.text!).join('')
    : text;

  return (
    <div style={{
      borderLeft: '3px solid var(--indigo)',
      background: 'var(--walnut-light)', padding: '12px 14px',
      borderRadius: 2, marginLeft: 12,
    }}>
      {hasBlocks ? blocks.map((block, i) => {
        if (block.type === 'text' && block.text) {
          // Use the latest text from agent events if it's longer
          const blockText = (i === 0 && text.length > (block.text?.length ?? 0)) ? text : block.text;
          return (
            <div key={i} style={{
              fontFamily: "'Crimson Pro', serif", fontSize: 14,
              color: 'var(--parchment)', lineHeight: 1.5,
            }}>
              {renderMarkdown(blockText)}
              {i === blocks.length - 1 && cursor}
            </div>
          );
        }
        if (block.type === 'tool_use') {
          const action = classifyToolAction(block);
          return (
            <div key={i} style={{
              borderLeft: `3px solid ${action.color}`,
              padding: '6px 12px', margin: '4px 0', borderRadius: 2,
              background: 'rgba(0,0,0,0.15)',
            }}>
              <span style={{
                fontFamily: "'Crimson Pro', serif", fontSize: 13,
                color: action.color, fontStyle: 'italic',
                animation: 'coinPulse 2s ease-in-out infinite',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span>{action.icon}</span>
                {action.label}...
              </span>
            </div>
          );
        }
        if (block.type === 'tool_result') {
          const { text: rText, isError } = parseToolResult(block);
          if (!rText) return null;
          return (
            <div key={i} style={{
              borderLeft: `3px solid ${isError ? '#f87171' : 'var(--verdigris)'}`,
              padding: '6px 12px', margin: '4px 0', borderRadius: 2,
              background: 'rgba(0,0,0,0.15)',
            }}>
              <span className="font-mono" style={{
                fontSize: 11, color: isError ? '#f87171' : 'var(--verdigris)',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>{rText}</span>
            </div>
          );
        }
        return null;
      }) : (
        /* Text-only from agent events, no structured blocks yet */
        <div style={{
          fontFamily: "'Crimson Pro', serif", fontSize: 14,
          color: 'var(--parchment)', lineHeight: 1.5,
        }}>
          {renderMarkdown(displayText)}
          {cursor}
        </div>
      )}
    </div>
  );
}

/* ── Message bubble ───────────────────────────────────────────────── */

/** Extract missionId from an assistant message's tool result blocks that contain a mission result. */
function extractResultMissionId(msg: ChatMessage): number | null {
  if (!msg.blocks) return null;
  for (const b of msg.blocks) {
    if (b.type !== 'tool_result' || !b.toolResult) continue;
    const raw = typeof b.toolResult === 'string' ? (() => { try { return JSON.parse(b.toolResult as string); } catch { return null; } })() : b.toolResult;
    if (!raw || typeof raw !== 'object') continue;
    const obj = raw as Record<string, unknown>;
    // A result-fetching response has both `result` and `missionId`
    if (obj.result && obj.missionId != null) return Number(obj.missionId);
  }
  // Also check if the coordinator text mentions rating and a mission ID
  if (msg.text) {
    const rateMatch = msg.text.match(/[Rr]at(?:e|ing)\s+(?:this|the|quest|mission)\s*[#]?(\d+)/i);
    if (rateMatch) return Number(rateMatch[1]);
    // "Rate this? (1-5 stars)" pattern — grab last mentioned mission ID
    if (/rate\s+this/i.test(msg.text)) {
      const allIds = msg.text.match(/(?:mission|quest|Mission|Quest)\s*#?(\d+)/gi);
      if (allIds && allIds.length > 0) {
        const last = allIds[allIds.length - 1].match(/(\d+)/);
        if (last) return Number(last[1]);
      }
    }
  }
  return null;
}

function MessageBubble({
  message, rating, hoveredStar, onStarHover, onRate, onCopy, isCopied,
}: {
  message: ChatMessage;
  rating: number;
  hoveredStar: number;
  onStarHover: (star: number) => void;
  onRate: (star: number) => void;
  onCopy: () => void;
  isCopied: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  if (message.role === 'user') {
    return (
      <div style={{ textAlign: 'right' }}>
        <span style={{
          display: 'inline-block', fontFamily: "'Crimson Pro', serif",
          fontSize: 14, color: 'var(--parchment)',
          background: 'var(--walnut-light)', padding: '8px 14px',
          borderRadius: 2, maxWidth: '80%',
        }}>
          {message.text}
        </span>
        <div style={{ fontSize: 10, color: 'var(--parchment-dim)', marginTop: 2, opacity: 0.6 }}>
          {timeAgo(message.timestamp)}
        </div>
      </div>
    );
  }

  if (message.role === 'assistant') {
    // Pair tool_use and tool_result blocks by toolId
    const pairedBlocks: Array<{
      type: 'text'; text: string;
    } | {
      type: 'tool_pair'; useBlock: ContentBlock; resultBlock?: ContentBlock;
    }> = [];

    if (message.blocks && message.blocks.length > 0) {
      const resultMap = new Map<string, ContentBlock>();
      for (const b of message.blocks) {
        if (b.type === 'tool_result' && b.toolId) resultMap.set(b.toolId, b);
      }

      for (const block of message.blocks) {
        if (block.type === 'text' && block.text) {
          pairedBlocks.push({ type: 'text', text: block.text });
        } else if (block.type === 'tool_use') {
          const paired = block.toolId ? resultMap.get(block.toolId) : undefined;
          pairedBlocks.push({ type: 'tool_pair', useBlock: block, resultBlock: paired });
        }
        // tool_result blocks are consumed by the pairing above
      }
    }

    // Detect if this assistant message contains a mission result worth rating
    const resultMissionId = extractResultMissionId(message);
    const showRating = resultMissionId != null;

    return (
      <div
        style={{ position: 'relative' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div style={{
          borderLeft: `3px solid ${showRating ? 'var(--verdigris)' : 'var(--indigo)'}`,
          background: 'var(--walnut-light)', padding: '12px 14px',
          borderRadius: 2, marginLeft: 12,
        }}>
          {pairedBlocks.length > 0 ? pairedBlocks.map((pb, i) => {
            if (pb.type === 'text') {
              return (
                <div key={i} style={{
                  fontFamily: "'Crimson Pro', serif", fontSize: 14,
                  color: 'var(--parchment)', lineHeight: 1.5,
                }}>
                  {renderMarkdown(pb.text)}
                </div>
              );
            }
            return (
              <CollapsibleToolBlock
                key={i}
                useBlock={pb.useBlock}
                resultBlock={pb.resultBlock}
              />
            );
          }) : (
            <div style={{
              fontFamily: "'Crimson Pro', serif", fontSize: 14,
              color: 'var(--parchment)', lineHeight: 1.5,
            }}>
              {renderMarkdown(message.text)}
            </div>
          )}

          {/* Star rating for assistant messages containing mission results */}
          {showRating && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 4,
              marginTop: 10, paddingTop: 8,
              borderTop: '1px solid var(--walnut-border)',
            }}>
              <span style={{
                fontFamily: "'Cinzel', serif", fontSize: 11,
                color: 'var(--parchment-dim)', marginRight: 4,
                letterSpacing: '0.05em',
              }}>Rate quest #{resultMissionId}:</span>
              {[1, 2, 3, 4, 5].map(star => {
                const filled = star <= (hoveredStar || rating);
                return (
                  <span key={star}
                    onClick={() => onRate(star)}
                    onMouseEnter={() => onStarHover(star)}
                    onMouseLeave={() => onStarHover(0)}
                    style={{
                      cursor: rating > 0 ? 'default' : 'pointer', fontSize: 18,
                      color: filled ? 'var(--gold)' : 'var(--walnut-border)',
                      textShadow: filled ? '0 0 4px var(--glow-gold)' : 'none',
                      transition: 'all 100ms ease',
                      transform: hoveredStar === star ? 'scale(1.15)' : 'scale(1)',
                      display: 'inline-block',
                    }}
                  >{filled ? '\u2605' : '\u2606'}</span>
                );
              })}
              {rating > 0 && (
                <span style={{
                  fontFamily: "'Crimson Pro', serif", fontSize: 11,
                  color: 'var(--verdigris)', marginLeft: 6, fontStyle: 'italic',
                }}>Rated!</span>
              )}
            </div>
          )}
        </div>

        {/* Timestamp + copy button */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          marginTop: 2, marginLeft: 15,
        }}>
          <span style={{ fontSize: 10, color: 'var(--parchment-dim)', opacity: 0.6 }}>
            {timeAgo(message.timestamp)}
          </span>
          {hovered && (
            <button
              onClick={onCopy}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 11, color: isCopied ? 'var(--verdigris)' : 'var(--parchment-dim)',
                padding: '0 4px', transition: 'color 150ms ease',
              }}
              onMouseEnter={e => { if (!isCopied) e.currentTarget.style.color = 'var(--ember)'; }}
              onMouseLeave={e => { if (!isCopied) e.currentTarget.style.color = 'var(--parchment-dim)'; }}
              title="Copy to clipboard"
            >
              {isCopied ? '\u2713 Copied' : '\u2398 Copy'}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (message.role === 'result') {
    return (
      <div style={{
        borderLeft: '3px solid var(--verdigris)',
        background: 'var(--walnut-light)', padding: '12px 14px',
        borderRadius: 2, marginLeft: 12,
      }}>
        <div style={{
          fontFamily: "'Crimson Pro', serif", fontSize: 14,
          color: 'var(--parchment)', whiteSpace: 'pre-wrap', marginBottom: 10,
        }}>
          {message.text}
        </div>

        {/* Star Rating */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{
            fontFamily: "'Crimson Pro', serif", fontSize: 13,
            color: 'var(--parchment-dim)', marginRight: 4,
          }}>Rate:</span>
          {[1, 2, 3, 4, 5].map(star => {
            const filled = star <= (hoveredStar || rating);
            return (
              <span key={star}
                onClick={() => onRate(star)}
                onMouseEnter={() => onStarHover(star)}
                onMouseLeave={() => onStarHover(0)}
                style={{
                  cursor: 'pointer', fontSize: 18,
                  color: filled ? 'var(--gold)' : 'var(--walnut-border)',
                  textShadow: filled ? '0 0 4px var(--glow-gold)' : 'none',
                  transition: 'all 100ms ease',
                  transform: hoveredStar === star ? 'scale(1.15)' : 'scale(1)',
                  display: 'inline-block',
                }}
              >{filled ? '\u2605' : '\u2606'}</span>
            );
          })}
        </div>

        <div style={{ fontSize: 10, color: 'var(--parchment-dim)', marginTop: 4, opacity: 0.6 }}>
          {timeAgo(message.timestamp)}
        </div>
      </div>
    );
  }

  // System message — color-coded by event type
  const isQuestEvent = message.text.includes('\u2694') || message.text.includes('Quest');
  const isClaimEvent = message.text.includes('\u269C') || message.text.includes('accepted');
  const isCompleteEvent = message.text.includes('\u2713') || message.text.includes('complete');
  const isRateEvent = message.text.includes('\u2605') && message.text.includes('rated');
  const isPaidEvent = message.text.includes('tBNB');

  const borderColor = isCompleteEvent ? 'var(--verdigris)' :
    isClaimEvent ? 'var(--indigo)' :
    isRateEvent ? 'var(--gold)' :
    isQuestEvent ? 'var(--ember)' :
    'var(--ember)';

  return (
    <div style={{
      borderLeft: `2px solid ${borderColor}`, paddingLeft: 12, marginLeft: 12,
      animation: 'fadeIn 300ms ease',
    }}>
      <span style={{
        fontFamily: "'Crimson Pro', serif", fontSize: 13, color: 'var(--parchment-dim)',
      }}>
        {message.text}
      </span>
      {isPaidEvent && (
        <span style={{
          display: 'inline-block', marginLeft: 6,
          background: 'rgba(78, 204, 163, 0.12)', border: '1px solid rgba(78, 204, 163, 0.3)',
          borderRadius: 3, padding: '0 5px', fontSize: 11,
          fontFamily: "'JetBrains Mono', monospace", color: 'var(--verdigris)',
        }}>
          {'\u26C1'}
        </span>
      )}
      {message.txHash && (
        <a
          href={`${getNetwork().explorerUrl}/tx/${message.txHash}`}
          target="_blank" rel="noopener noreferrer" className="font-mono"
          style={{
            display: 'block', fontSize: 11, color: 'var(--indigo)',
            marginTop: 2, cursor: 'pointer', textDecoration: 'none',
            opacity: 0.8,
          }}
          onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.textDecoration = 'underline'; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '0.8'; e.currentTarget.style.textDecoration = 'none'; }}
        >
          On-chain: {message.txHash.slice(0, 10)}...{message.txHash.slice(-6)}
        </a>
      )}
      <div style={{ fontSize: 10, color: 'var(--parchment-dim)', marginTop: 2, opacity: 0.5 }}>
        {timeAgo(message.timestamp)}
      </div>
    </div>
  );
}
