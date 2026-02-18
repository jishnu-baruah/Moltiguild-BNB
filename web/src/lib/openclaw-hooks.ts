'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  connect,
  getState,
  onStateChange,
  onChatEvent,
  sendChat,
  abortChat,
  fetchHistory,
  fetchSessionToolCalls,
  buildSessionKey,
  type ConnectionState,
  type ChatEvent,
  type ChatContentBlock,
  type HistoryMessage,
} from './openclaw-client';

/**
 * Track the OpenClaw WebSocket connection state.
 * Initiates connection on first mount; singleton persists across unmounts.
 */
export function useOpenClawConnection() {
  const [state, setState] = useState<ConnectionState>(getState);

  useEffect(() => {
    const unsub = onStateChange(setState);
    // Connect if not already connected
    if (getState() === 'disconnected' || getState() === 'error') {
      connect();
    }
    return unsub;
  }, []);

  return {
    state,
    isConnected: state === 'connected',
    isConnecting: state === 'connecting',
  };
}

/**
 * Chat with an OpenClaw agent via WebSocket.
 * Provides send/abort + streaming text state + history loading.
 */
export function useOpenClawChat(sessionKey: string) {
  const [streamText, setStreamText] = useState('');
  const [streamBlocks, setStreamBlocks] = useState<ChatContentBlock[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryMessage[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [toolBlocks, setToolBlocks] = useState<ChatContentBlock[]>([]);
  const runIdRef = useRef<string | null>(null);
  const historyLoadedRef = useRef(false);

  // Subscribe to chat events for this session
  useEffect(() => {
    const unsub = onChatEvent((event: ChatEvent) => {
      if (event.sessionKey !== sessionKey) return;

      switch (event.state) {
        case 'delta':
          // Agent events give token-by-token text (blocks=[]), chat events give batched blocks.
          // Only update text if it's longer (agent events may arrive ahead of batched chat events).
          if (event.content) {
            setStreamText(prev => event.content.length >= prev.length ? event.content : prev);
          }

          // Handle blocks from different sources:
          if (event.blocks.length > 0) {
            const hasToolBlocks = event.blocks.some(b => b.type === 'tool_use' || b.type === 'tool_result');
            if (hasToolBlocks && event.blocks.length <= 2) {
              // Agent tool events — append new tool blocks to existing blocks
              setStreamBlocks(prev => {
                const newBlocks = [...prev];
                for (const block of event.blocks) {
                  // Avoid duplicates by checking toolId
                  if (block.type === 'tool_use' && block.toolId) {
                    const exists = newBlocks.some(b => b.type === 'tool_use' && b.toolId === block.toolId);
                    if (!exists) newBlocks.push(block);
                  } else if (block.type === 'tool_result' && block.toolId) {
                    const exists = newBlocks.some(b => b.type === 'tool_result' && b.toolId === block.toolId);
                    if (!exists) newBlocks.push(block);
                  } else {
                    newBlocks.push(block);
                  }
                }
                return newBlocks;
              });
            } else {
              // Full chat event blocks (batched update from gateway) — replace entirely
              setStreamBlocks(event.blocks);
            }
          }
          break;
        case 'final':
          // Final chat event always has the complete content and blocks
          setStreamText(event.content);
          setStreamBlocks(event.blocks);
          setIsStreaming(false);
          runIdRef.current = null;

          // OpenClaw gateway doesn't stream tool_use/tool_result events,
          // but tools DO run server-side. Fetch the session preview to
          // surface tool calls that happened during this response.
          fetchSessionToolCalls(sessionKey).then((tools) => {
            if (tools.length > 0) {
              setToolBlocks(tools);
            }
          });
          break;
        case 'aborted':
          setIsStreaming(false);
          runIdRef.current = null;
          break;
        case 'error':
          setError(event.errorMessage ?? 'Unknown error');
          setIsStreaming(false);
          runIdRef.current = null;
          break;
      }
    });
    return unsub;
  }, [sessionKey]);

  // Reset streaming state if connection drops mid-stream
  useEffect(() => {
    const unsub = onStateChange((s) => {
      if (s === 'error' || s === 'disconnected') {
        if (runIdRef.current) {
          // Connection dropped mid-stream — don't lose partial content
          setIsStreaming(false);
          runIdRef.current = null;
        }
      }
    });
    return unsub;
  }, []);

  // Load history once on connect
  useEffect(() => {
    if (historyLoadedRef.current) return;

    const unsub = onStateChange((s) => {
      if (s === 'connected' && !historyLoadedRef.current) {
        historyLoadedRef.current = true;
        fetchHistory(sessionKey, 50).then((msgs) => {
          setHistory(msgs);
          setHistoryLoaded(true);
        });
      }
    });

    // If already connected, load immediately
    if (getState() === 'connected' && !historyLoadedRef.current) {
      historyLoadedRef.current = true;
      fetchHistory(sessionKey, 50).then((msgs) => {
        setHistory(msgs);
        setHistoryLoaded(true);
      });
    }

    return unsub;
  }, [sessionKey]);

  const send = useCallback(async (message: string) => {
    setStreamText('');
    setStreamBlocks([]);
    setToolBlocks([]);
    setError(null);
    setIsStreaming(true);
    try {
      const runId = await sendChat(sessionKey, message);
      runIdRef.current = runId;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
      setIsStreaming(false);
    }
  }, [sessionKey]);

  const abort = useCallback(async () => {
    try {
      await abortChat(sessionKey, runIdRef.current ?? undefined);
    } catch {
      // ignore abort errors
    }
  }, [sessionKey]);

  return { send, abort, streamText, streamBlocks, toolBlocks, isStreaming, error, history, historyLoaded };
}

export { buildSessionKey };
