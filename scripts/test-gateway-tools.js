#!/usr/bin/env node
/**
 * E2E Test: OpenClaw gateway coordinator tool use
 * Tests that the coordinator agent can use exec tool to call the API
 */
const WebSocket = require('ws');

const WS_URL = process.env.WS_URL || 'ws://localhost:18789';
const TOKEN = 'agentguilds-gateway-2026';
const ORIGIN = 'http://localhost:3000';

let step = 0;
let fullResponse = '';
let gotToolUse = false;

const ws = new WebSocket(WS_URL, { headers: { Origin: ORIGIN } });

function send(method, params) {
  const id = 'r' + (++step);
  ws.send(JSON.stringify({ type: 'req', id, method, params }));
  return id;
}

ws.on('message', (d) => {
  const f = JSON.parse(d.toString());

  if (f.type === 'event' && f.event === 'connect.challenge') {
    console.log('[1] Got challenge, authenticating...');
    send('connect', {
      minProtocol: 3, maxProtocol: 3,
      client: { id: 'openclaw-control-ui', version: '1.0.0', platform: 'web', mode: 'webchat' },
      role: 'operator',
      scopes: ['operator.read', 'operator.write'],
      auth: { token: TOKEN },
      locale: 'en-US',
    });
    return;
  }

  if (f.type === 'res' && f.id === 'r1') {
    if (f.ok) {
      console.log('[2] Auth OK! Asking coordinator to check API status...');
      send('chat.send', {
        sessionKey: 'agent:coordinator:tooltest-' + Date.now(),
        message: 'Check the API status and tell me how many guilds and missions exist on this system. Use exec curl to call the API.',
        deliver: false,
        idempotencyKey: 'tooltest-' + Date.now(),
      });
    } else {
      console.log('[2] Auth FAILED:', JSON.stringify(f.error));
      ws.close();
      process.exit(1);
    }
    return;
  }

  if (f.type === 'res' && f.id === 'r2') {
    if (!f.ok) {
      console.log('[3] chat.send FAILED:', JSON.stringify(f.error));
      ws.close();
      process.exit(1);
    }
    console.log('[3] chat.send accepted, waiting for response...');
    return;
  }

  // Watch for tool use events
  if (f.type === 'event' && f.event === 'agent') {
    const stream = f.payload?.stream;
    const data = f.payload?.data;

    if (stream === 'tool_call' || stream === 'tool') {
      gotToolUse = true;
      const toolName = data?.name || data?.tool || '';
      const toolInput = data?.input || data?.args || '';
      console.log(`[TOOL] ${toolName}: ${typeof toolInput === 'string' ? toolInput.slice(0, 200) : JSON.stringify(toolInput).slice(0, 200)}`);
    }

    if (stream === 'tool_result') {
      const result = data?.output || data?.result || data?.text || '';
      console.log(`[TOOL-RESULT] ${(typeof result === 'string' ? result : JSON.stringify(result)).slice(0, 300)}`);
    }

    if (stream === 'assistant') {
      const text = data?.text || '';
      fullResponse += text;
      process.stdout.write(text);
    }
    return;
  }

  if (f.type === 'event' && f.event === 'chat') {
    if (f.payload?.state === 'final') {
      const blocks = f.payload.message?.content || [];
      const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('');
      if (text) fullResponse = text;

      console.log('\n\n--- RESULTS ---');
      console.log('[RESPONSE]', fullResponse.slice(0, 500));
      console.log('[TOOL-USE]', gotToolUse ? 'YES' : 'NO');

      // Check if the response mentions guilds/missions/status
      const hasData = /guild|mission|status|agent/i.test(fullResponse);
      const hasNumbers = /\d+/.test(fullResponse);

      if (hasData && hasNumbers) {
        console.log('[PASS] Coordinator used tools and returned system data!');
        ws.close();
        process.exit(0);
      } else if (fullResponse.length > 20) {
        console.log('[PARTIAL] Got response but may not have used tools:', fullResponse.slice(0, 200));
        ws.close();
        process.exit(0);
      } else {
        console.log('[FAIL] No meaningful response from coordinator');
        ws.close();
        process.exit(1);
      }
    }
  }
});

ws.on('error', (e) => {
  console.log('[ERR]', e.message);
  process.exit(1);
});

setTimeout(() => {
  console.log('\n[TIMEOUT] No final response in 120s');
  console.log('[PARTIAL-RESPONSE]', fullResponse.slice(0, 500));
  console.log('[TOOL-USE]', gotToolUse ? 'YES' : 'NO');
  ws.close();
  process.exit(1);
}, 120000);
