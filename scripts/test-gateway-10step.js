#!/usr/bin/env node
/**
 * 10-step gateway conversation test.
 * Tests the OpenClaw WebSocket protocol with sequential messages
 * to the coordinator agent, evaluating response quality.
 */

const WebSocket = require('ws');

const WS_URL = 'ws://localhost:18789';
const TOKEN = 'agentguilds-gateway-2026';
const ORIGIN = 'http://localhost:3000';
// Use per-step sessions to isolate issues, but keep a shared session option
const SESSION_BASE = 'agent:coordinator:web-test-' + Date.now();
const USE_SHARED_SESSION = true; // true = single session (conversation continuity), false = per-step
const TIMEOUT_MS = 180000; // 3 minutes per message (tool-heavy steps need more)
const INTER_STEP_DELAY = 5000; // 5s delay between steps to let the gateway settle

const ALL_STEPS = [
  { id: 1, message: 'What can you help me with?', label: 'Capabilities awareness' },
  { id: 2, message: 'List all guilds', label: 'Guild listing (API access)' },
  { id: 3, message: 'What missions are available?', label: 'Mission listing' },
  { id: 4, message: 'Create a quest: write a haiku about blockchain', label: 'Mission creation' },
  { id: 5, message: 'Check the status of the platform', label: 'Status endpoint' },
  { id: 6, message: 'How do I register as an agent?', label: 'Onboarding knowledge' },
  { id: 7, message: 'Assign plots to all unassigned guilds', label: 'World governance' },
  { id: 8, message: 'What districts are available in the world?', label: 'World knowledge' },
  { id: 9, message: 'How can I create my own guild?', label: 'Guild creation knowledge' },
  { id: 10, message: 'Show me the leaderboard', label: 'Leaderboard access' },
];

// Parse --skip-to=N from command line to skip already-tested steps
const skipTo = parseInt((process.argv.find(a => a.startsWith('--skip-to=')) || '').split('=')[1]) || 1;
const STEPS = ALL_STEPS.filter(s => s.id >= skipTo);

let ws = null;
let reqCounter = 0;
let connected = false;
const pendingRequests = new Map();

function nextId() { return 'r' + (++reqCounter); }

function sendFrame(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId();
    pendingRequests.set(id, { resolve, reject });
    const frame = JSON.stringify({ type: 'req', id, method, params });
    ws.send(frame);
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error('Request ' + method + ' timed out'));
      }
    }, 30000);
  });
}

function connectAndAuth() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(WS_URL, { headers: { Origin: ORIGIN } });

    ws.on('error', (e) => {
      reject(new Error('WebSocket error: ' + e.message));
    });

    ws.on('message', (data) => {
      const frame = JSON.parse(data.toString());

      // Handle challenge
      if (frame.type === 'event' && frame.event === 'connect.challenge') {
        sendFrame('connect', {
          minProtocol: 3, maxProtocol: 3,
          client: { id: 'webchat', version: '1.0.0', platform: 'web', mode: 'webchat' },
          role: 'operator', scopes: ['operator.read', 'operator.write'],
          auth: { token: TOKEN },
          locale: 'en-US', userAgent: 'moltiguild-test/1.0',
        }).then(() => {
          connected = true;
          resolve();
        }).catch(reject);
        return;
      }

      // Handle response frames for pending requests
      if (frame.type === 'res') {
        const pending = pendingRequests.get(frame.id);
        if (pending) {
          pendingRequests.delete(frame.id);
          if (frame.ok) {
            pending.resolve(frame.payload || {});
          } else {
            pending.reject(new Error(frame.error?.message || 'Request failed'));
          }
        }
      }
    });

    setTimeout(() => reject(new Error('Connection timeout')), 15000);
  });
}

function sendChatAndCollect(message, sessionKey) {
  return new Promise((resolve, reject) => {
    let agentText = '';
    let toolUses = [];
    let toolResults = [];
    let chatFinalText = '';
    let chatFinalBlocks = [];
    let agentDeltas = 0;
    let chatDeltas = 0;
    let gotFinal = false;
    let errorMessage = null;
    let allFrames = []; // debug: capture all frames

    function onMessage(data) {
      const raw = data.toString();
      const frame = JSON.parse(raw);
      const debugEntry = { t: Date.now(), type: frame.type, event: frame.event, state: frame.payload?.state };

      // Capture raw agent events for debugging
      if (frame.type === 'event' && (frame.event === 'agent' || frame.event === 'chat')) {
        debugEntry.stream = frame.payload?.stream;
        debugEntry.dataKeys = frame.payload?.data ? Object.keys(frame.payload.data) : undefined;
        debugEntry.dataText = frame.payload?.data?.text ? String(frame.payload.data.text).slice(0, 100) : undefined;
        if (frame.event === 'chat') {
          const blocks = frame.payload?.message?.content || [];
          debugEntry.blockTypes = blocks.map(b => b.type);
          debugEntry.textPreview = blocks.filter(b => b.type === 'text').map(b => (b.text || '').slice(0, 80)).join('|');
        }
      }
      allFrames.push(debugEntry);

      // Handle response frames
      if (frame.type === 'res') {
        const pending = pendingRequests.get(frame.id);
        if (pending) {
          pendingRequests.delete(frame.id);
          if (frame.ok) pending.resolve(frame.payload || {});
          else pending.reject(new Error(frame.error?.message || 'Request failed'));
        }
        return;
      }

      if (frame.type !== 'event') return;

      // Agent streaming events
      if (frame.event === 'agent') {
        const stream = frame.payload?.stream;
        const d = frame.payload?.data;
        if (stream === 'assistant' && d?.text) {
          agentDeltas++;
          agentText += d.text;
        } else if (stream === 'tool_use') {
          toolUses.push(d);
        } else if (stream === 'tool_result') {
          toolResults.push(d);
        }
        return;
      }

      // Chat events
      if (frame.event === 'chat') {
        const state = frame.payload?.state;
        if (state === 'delta') {
          chatDeltas++;
        } else if (state === 'final') {
          gotFinal = true;
          const blocks = frame.payload?.message?.content || [];
          chatFinalBlocks = blocks;
          chatFinalText = blocks.filter(b => b.type === 'text').map(b => b.text || '').join('');
          ws.removeListener('message', onMessage);
          resolve({
            agentText,
            chatFinalText,
            chatFinalBlocks,
            toolUses,
            toolResults,
            agentDeltas,
            chatDeltas,
            errorMessage: frame.payload?.errorMessage || null,
            allFrames,
          });
        } else if (state === 'error' || state === 'aborted') {
          errorMessage = frame.payload?.errorMessage || state;
          ws.removeListener('message', onMessage);
          resolve({
            agentText, chatFinalText: '', chatFinalBlocks: [],
            toolUses, toolResults, agentDeltas, chatDeltas,
            errorMessage,
            allFrames,
          });
        }
      }
    }

    ws.on('message', onMessage);

    const idempotencyKey = 'test-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    sendFrame('chat.send', {
      sessionKey: sessionKey,
      message: message,
      deliver: false,
      idempotencyKey: idempotencyKey,
    }).catch((err) => {
      ws.removeListener('message', onMessage);
      reject(err);
    });

    setTimeout(() => {
      if (!gotFinal) {
        ws.removeListener('message', onMessage);
        resolve({
          agentText, chatFinalText: agentText, chatFinalBlocks: [],
          toolUses, toolResults, agentDeltas, chatDeltas,
          errorMessage: 'TIMEOUT: No final event received within ' + (TIMEOUT_MS / 1000) + 's',
          allFrames,
        });
      }
    }, TIMEOUT_MS);
  });
}

function evaluateResponse(stepNum, label, result) {
  const sep = '='.repeat(70);
  const text = result.chatFinalText || result.agentText || '';
  const hasText = text.length > 10;
  const hasError = !!result.errorMessage;
  const hasToolUse = result.toolUses.length > 0;
  const hasToolResult = result.toolResults.length > 0;
  const hasFinalTags = /<final/i.test(text);
  const hasArtifacts = /<artifact/i.test(text) || /<antArtifact/i.test(text);

  console.log(sep);
  console.log('STEP ' + stepNum + ': ' + label);
  console.log(sep);
  console.log('');

  // Show response text (truncated)
  const displayText = text.length > 600 ? text.slice(0, 600) + '\n... [truncated, ' + text.length + ' chars total]' : text;
  console.log('RESPONSE:');
  console.log(displayText);
  console.log('');

  // Tool usage
  if (hasToolUse) {
    console.log('TOOLS USED:');
    for (const t of result.toolUses) {
      const name = t?.name || 'unknown';
      const inputPreview = JSON.stringify(t?.input || {}).slice(0, 200);
      console.log('  - ' + name + ': ' + inputPreview);
    }
    console.log('');
  }

  if (hasToolResult) {
    console.log('TOOL RESULTS: ' + result.toolResults.length + ' result(s)');
    for (const r of result.toolResults) {
      const preview = JSON.stringify(r?.content || r?.text || r || '').slice(0, 300);
      console.log('  - ' + preview);
    }
    console.log('');
  }

  // Evaluation
  console.log('EVALUATION:');
  console.log('  Understood request:   ' + (hasText ? 'YES' : 'NO'));
  console.log('  Used tools:           ' + (hasToolUse ? 'YES (' + result.toolUses.length + ' call(s))' : 'NO'));
  console.log('  Tool results:         ' + (hasToolResult ? 'YES (' + result.toolResults.length + ')' : (hasToolUse ? 'MISSING' : 'N/A')));
  console.log('  Response helpful:     ' + (hasText && text.length > 30 ? 'YES' : 'WEAK'));
  console.log('  <final> tags:         ' + (hasFinalTags ? 'YES (BAD - should not leak)' : 'NONE (good)'));
  console.log('  Artifacts in text:    ' + (hasArtifacts ? 'YES (BAD - should not leak)' : 'NONE (good)'));
  console.log('  Errors:               ' + (hasError ? 'YES: ' + result.errorMessage : 'NONE'));
  console.log('  Streaming stats:      ' + result.agentDeltas + ' agent deltas, ' + result.chatDeltas + ' chat deltas');
  console.log('  Response length:      ' + text.length + ' chars');
  console.log('');

  return {
    step: stepNum,
    label,
    understood: hasText,
    usedTools: hasToolUse,
    helpful: hasText && text.length > 30,
    hasFinalTags,
    hasArtifacts,
    hasError,
    errorMessage: result.errorMessage,
    responseLength: text.length,
    toolCount: result.toolUses.length,
  };
}

async function main() {
  console.log('');
  console.log('######################################################################');
  console.log('#  MoltiGuild Gateway 10-Step Conversation Test                      #');
  console.log('#  Target: ' + WS_URL.padEnd(55) + '  #');
  console.log('#  Session: ' + SESSION_BASE.slice(0, 54).padEnd(54) + ' #');
  console.log('######################################################################');
  console.log('');

  // Step 0: Connect
  console.log('Connecting to gateway...');
  try {
    await connectAndAuth();
    console.log('Connected and authenticated successfully.');
  } catch (err) {
    console.error('FATAL: Could not connect to gateway: ' + err.message);
    process.exit(1);
  }

  console.log('');
  console.log('Starting 10-step conversation (same session for continuity)...');
  console.log('');

  const evaluations = [];
  let lastRunTimedOut = false;
  const sessionKey = SESSION_BASE;

  for (const step of STEPS) {
    // If the previous step timed out, abort the stuck run and wait for recovery
    if (lastRunTimedOut) {
      console.log('    [Previous step timed out - sending abort and waiting 8s for recovery...]');
      try {
        await sendFrame('chat.abort', { sessionKey });
      } catch (e) {
        console.log('    [Abort request: ' + (e.message || 'ok') + ']');
      }
      await new Promise(r => setTimeout(r, 8000));
      lastRunTimedOut = false;
    }

    // Inter-step delay to let the gateway settle
    if (step.id > 1) {
      console.log('    [Waiting ' + (INTER_STEP_DELAY / 1000) + 's between steps...]');
      await new Promise(r => setTimeout(r, INTER_STEP_DELAY));
    }

    const stepSession = USE_SHARED_SESSION ? sessionKey : (SESSION_BASE + '-s' + step.id);
    console.log('>>> Sending step ' + step.id + ': "' + step.message + '"');
    console.log('    Session: ' + stepSession);
    console.log('    Waiting for response...');

    const startTime = Date.now();
    let result;
    try {
      result = await sendChatAndCollect(step.message, stepSession);
    } catch (err) {
      console.log('    ERROR: ' + err.message);
      evaluations.push({
        step: step.id, label: step.label, understood: false,
        usedTools: false, helpful: false, hasFinalTags: false,
        hasArtifacts: false, hasError: true, errorMessage: err.message,
        responseLength: 0, toolCount: 0,
      });
      continue;
    }
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('    Response received in ' + elapsed + 's');
    console.log('    Frames received: ' + (result.allFrames || []).length);

    if (result.errorMessage && result.errorMessage.startsWith('TIMEOUT')) {
      lastRunTimedOut = true;
    }

    // Debug: show frame details for empty responses
    if ((!result.chatFinalText && !result.agentText) && result.allFrames) {
      console.log('    DEBUG - All frames:');
      for (const f of result.allFrames) {
        console.log('      ' + JSON.stringify(f));
      }
    }

    console.log('');

    const evaluation = evaluateResponse(step.id, step.label, result);
    evaluation.elapsed = elapsed;
    evaluations.push(evaluation);
  }

  // Summary
  console.log('');
  console.log('######################################################################');
  console.log('#  SUMMARY                                                           #');
  console.log('######################################################################');
  console.log('');

  let passCount = 0;
  let failCount = 0;

  for (const e of evaluations) {
    const status = (e.understood && e.helpful && !e.hasError) ? 'PASS' : 'FAIL';
    if (status === 'PASS') passCount++; else failCount++;

    const flags = [];
    if (e.usedTools) flags.push('tools:' + e.toolCount);
    if (e.hasFinalTags) flags.push('LEAKED_FINAL_TAGS');
    if (e.hasArtifacts) flags.push('LEAKED_ARTIFACTS');
    if (e.hasError) flags.push('ERROR');
    const flagStr = flags.length > 0 ? ' [' + flags.join(', ') + ']' : '';

    console.log('  ' + status + '  Step ' + e.step + ': ' + e.label + ' (' + (e.elapsed || '?') + 's, ' + e.responseLength + ' chars)' + flagStr);
  }

  console.log('');
  console.log('  Total: ' + passCount + ' passed, ' + failCount + ' failed out of ' + evaluations.length);
  console.log('');

  // Cleanup
  ws.close();
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
