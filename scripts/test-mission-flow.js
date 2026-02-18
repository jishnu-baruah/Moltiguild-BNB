#!/usr/bin/env node
/**
 * Test full mission lifecycle through OpenClaw gateway.
 * Logs EVERY event to understand the complete flow.
 */

const WebSocket = require('ws');

const WS_URL = 'wss://gateway.outdatedlabs.com';
const TOKEN = 'agentguilds-gateway-2026';
const ORIGIN = 'http://localhost:3000';
const SESSION = 'agent:coordinator:web-missionflow-' + Date.now();

let localReqId = 0;
const startTime = Date.now();

function ts() { return ((Date.now() - startTime) / 1000).toFixed(1) + 's'; }

const ws = new WebSocket(WS_URL, { headers: { Origin: ORIGIN } });

function sendReq(method, params) {
  const id = 'r' + (++localReqId);
  ws.send(JSON.stringify({ type: 'req', id, method, params }));
  return id;
}

ws.on('open', () => console.log('[' + ts() + '] WebSocket opened'));

ws.on('message', (d) => {
  const frame = JSON.parse(d.toString());

  if (frame.type === 'event' && frame.event === 'connect.challenge') {
    console.log('[' + ts() + '] Challenge received, authenticating...');
    sendReq('connect', {
      minProtocol: 3, maxProtocol: 3,
      client: { id: 'webchat', version: '1.0.0', platform: 'web', mode: 'webchat' },
      role: 'operator', scopes: ['operator.read', 'operator.write'],
      auth: { token: TOKEN },
      locale: 'en-US', userAgent: 'moltiguild-web/1.0',
    });
    return;
  }

  if (frame.type === 'res' && localReqId === 1 && frame.ok) {
    console.log('[' + ts() + '] Connected! Sending mission creation request...\n');
    sendReq('chat.send', {
      sessionKey: SESSION,
      message: 'Create a quest for the Pixel Artisans guild: "Design a pixel art logo for MoltiGuild". Budget: 0.001 MON. Then track everything that happens.',
      deliver: false,
      idempotencyKey: 'mission-' + Date.now(),
    });
    return;
  }

  if (frame.type === 'res' && localReqId === 2) {
    console.log('[' + ts() + '] Chat started, runId: ' + (frame.payload?.runId || 'unknown'));
    return;
  }

  // Skip tick/health
  if (frame.type === 'event' && (frame.event === 'tick' || frame.event === 'health')) return;

  // Agent events
  if (frame.type === 'event' && frame.event === 'agent') {
    const p = frame.payload;
    const stream = p?.stream;

    if (stream === 'lifecycle') {
      console.log('[' + ts() + '] LIFECYCLE: ' + p.data?.phase);
      return;
    }

    if (stream === 'assistant') {
      // Only log periodically to avoid spam
      const text = String(p.data?.text || '');
      if (text.length % 50 < 5 || p.data?.delta === '\n') {
        process.stdout.write('[' + ts() + '] TEXT (' + text.length + ' chars): ...' + text.slice(-80).replace(/\n/g, '\\n') + '\n');
      }
      return;
    }

    if (stream === 'tool_use') {
      const data = p.data || {};
      console.log('\n[' + ts() + '] === TOOL_USE ===');
      console.log('  Name: ' + (data.name || 'unknown'));
      console.log('  Input: ' + JSON.stringify(data.input || {}).slice(0, 500));
      return;
    }

    if (stream === 'tool_result') {
      const data = p.data || {};
      const content = data.content || data.text || data;
      const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
      console.log('\n[' + ts() + '] === TOOL_RESULT ===');
      console.log('  Content: ' + contentStr.slice(0, 500));
      console.log('  Is Error: ' + (data.is_error || false));
      return;
    }

    // Other agent streams
    console.log('[' + ts() + '] AGENT.' + stream + ': ' + JSON.stringify(p.data || {}).slice(0, 200));
    return;
  }

  // Chat events
  if (frame.type === 'event' && frame.event === 'chat') {
    const p = frame.payload;
    const blocks = p.message?.content || [];
    const textBlocks = blocks.filter(b => b.type === 'text');
    const toolUseBlocks = blocks.filter(b => b.type === 'tool_use');
    const toolResultBlocks = blocks.filter(b => b.type === 'tool_result');

    if (p.state === 'delta') {
      // Only log when new block types appear
      const summary = blocks.map(b => b.type).join(', ');
      process.stdout.write('[' + ts() + '] CHAT delta: ' + blocks.length + ' blocks [' + summary + ']\r');
      return;
    }

    if (p.state === 'final') {
      console.log('\n\n[' + ts() + '] ========== CHAT FINAL ==========');
      console.log('Blocks: ' + blocks.length + ' total');
      console.log('  Text blocks: ' + textBlocks.length);
      console.log('  Tool_use blocks: ' + toolUseBlocks.length);
      console.log('  Tool_result blocks: ' + toolResultBlocks.length);

      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        console.log('\n--- Block ' + i + ' [' + b.type + '] ---');
        if (b.type === 'text') {
          console.log(b.text.slice(0, 300));
        } else if (b.type === 'tool_use') {
          console.log('  Tool: ' + b.name);
          console.log('  ID: ' + b.id);
          console.log('  Input: ' + JSON.stringify(b.input || {}).slice(0, 300));
        } else if (b.type === 'tool_result') {
          console.log('  Tool ID: ' + b.tool_use_id);
          const content = Array.isArray(b.content) ? b.content.map(c => c.text || JSON.stringify(c)).join('') : String(b.content || '');
          console.log('  Content: ' + content.slice(0, 300));
        }
      }

      console.log('\n=== DONE ===');
      ws.close();
      process.exit(0);
    }
    return;
  }

  // Other events
  if (frame.type === 'event') {
    console.log('[' + ts() + '] EVENT.' + frame.event + ': ' + JSON.stringify(frame.payload || {}).slice(0, 200));
  }
});

ws.on('error', (e) => console.log('ERR:', e.message));
setTimeout(() => { console.log('\nTIMEOUT after 120s'); ws.close(); process.exit(1); }, 120000);
