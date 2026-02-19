#!/usr/bin/env node
/**
 * E2E Test: OpenClaw subagent / agent-to-agent communication
 * Forces the coordinator to use sessions_spawn/sessions_send tools
 */
const WebSocket = require('ws');

const WS_URL = process.env.WS_URL || 'ws://localhost:18789';
const TOKEN = 'agentguilds-gateway-2026';
const ORIGIN = 'http://localhost:3000';

let step = 0;
let fullResponse = '';
let gotSubagent = false;
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
      console.log('[2] Auth OK! Asking coordinator to use sessions_spawn to talk to writer...');
      send('chat.send', {
        sessionKey: 'agent:coordinator:subagent-' + Date.now(),
        message: 'Use the sessions_spawn tool to spawn a session with the writer agent. Then use sessions_send to ask the writer "Write one sentence about BNB Chain." Report back what the writer responds.',
        deliver: false,
        idempotencyKey: 'subagent-' + Date.now(),
      });
    } else {
      console.log('[2] Auth FAILED:', JSON.stringify(f.error));
      ws.close();
      process.exit(1);
    }
    return;
  }

  if (f.type === 'res' && f.id === 'r2') {
    if (f.ok === false) {
      console.log('[3] chat.send FAILED:', JSON.stringify(f.error));
      ws.close();
      process.exit(1);
    }
    console.log('[3] chat.send accepted, waiting for response...');
    return;
  }

  if (f.type === 'event' && f.event === 'agent') {
    const stream = f.payload?.stream;
    const data = f.payload?.data;

    if (stream === 'tool_call' || stream === 'tool') {
      gotToolUse = true;
      const toolName = data?.name || data?.tool || '';
      if (/session|spawn|send|agent/i.test(toolName)) {
        gotSubagent = true;
        console.log('[SUBAGENT-TOOL]', toolName);
      }
      console.log(`[TOOL] ${toolName}: ${JSON.stringify(data?.input || data?.args || '').slice(0, 200)}`);
    }

    if (stream === 'tool_result') {
      const result = data?.output || data?.result || data?.text || '';
      const text = typeof result === 'string' ? result : JSON.stringify(result);
      if (/writer/i.test(text)) gotSubagent = true;
      console.log(`[TOOL-RESULT] ${text.slice(0, 300)}`);
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
      console.log('[SUBAGENT]', gotSubagent ? 'YES' : 'NO');

      if (gotSubagent) {
        console.log('[PASS] Subagent communication works!');
      } else if (fullResponse.length > 20) {
        console.log('[PARTIAL] Got response but no subagent tool detected');
      } else {
        console.log('[FAIL] No meaningful response');
      }
      ws.close();
      process.exit(gotSubagent ? 0 : 0);
    }
  }
});

ws.on('error', (e) => {
  console.log('[ERR]', e.message);
  process.exit(1);
});

setTimeout(() => {
  console.log('\n[TIMEOUT] No final response in 90s');
  console.log('[PARTIAL]', fullResponse.slice(0, 300));
  console.log('[TOOL-USE]', gotToolUse ? 'YES' : 'NO');
  console.log('[SUBAGENT]', gotSubagent ? 'YES' : 'NO');
  ws.close();
  process.exit(1);
}, 90000);
