#!/usr/bin/env node
const WebSocket = require('ws');

const WS_URL = process.env.WS_URL || 'ws://localhost:18789';
const TOKEN = 'agentguilds-gateway-2026';
const ORIGIN = 'http://localhost:3000';

let step = 0;
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
      console.log('[2] Auth OK! Sending chat message...');
      send('chat.send', {
        sessionKey: 'agent:coordinator:test-' + Date.now(),
        message: 'Say hello in exactly 5 words.',
        deliver: false,
        idempotencyKey: 'test-' + Date.now(),
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
    console.log('[3] chat.send accepted');
    return;
  }

  if (f.type === 'event' && f.event === 'agent') {
    const stream = f.payload?.stream;
    if (stream === 'assistant') {
      process.stdout.write(f.payload?.data?.text || '');
    }
    return;
  }

  if (f.type === 'event' && f.event === 'chat') {
    if (f.payload?.state === 'final') {
      const blocks = f.payload.message?.content || [];
      const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('');
      console.log('\n[FINAL] Response:', text.slice(0, 300));
      console.log('[PASS] Gateway chat works end-to-end!');
      ws.close();
      process.exit(0);
    }
  }
});

ws.on('error', (e) => {
  console.log('[ERR]', e.message);
  process.exit(1);
});

setTimeout(() => {
  console.log('\n[TIMEOUT] No final response in 60s');
  ws.close();
  process.exit(1);
}, 60000);
