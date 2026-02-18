const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const ws = new WebSocket('wss://gateway.outdatedlabs.com', { headers: { Origin: 'http://localhost:3000' } });
let rid = 0;

function send(m, p) {
  const id = 'r' + (++rid);
  ws.send(JSON.stringify({ type: 'req', id, method: m, params: p }));
  return id;
}

const soulContent = fs.readFileSync(
  path.join(__dirname, '..', 'agents', 'coordinator', 'SOUL.md'),
  'utf-8'
);

ws.on('message', (d) => {
  const f = JSON.parse(d.toString());
  if (f.type === 'event' && f.event === 'connect.challenge') {
    send('connect', {
      minProtocol: 3, maxProtocol: 3,
      client: { id: 'webchat', version: '1.0.0', platform: 'web', mode: 'webchat' },
      role: 'operator', scopes: ['operator.read', 'operator.write', 'operator.admin'],
      auth: { token: 'agentguilds-gateway-2026' },
    });
    return;
  }
  if (f.type === 'res' && rid === 1 && f.ok) {
    console.log('Connected. Deploying SOUL.md...');
    send('agents.files.set', {
      agentId: 'coordinator',
      name: 'SOUL.md',
      content: soulContent,
    });
    return;
  }
  if (f.type === 'res' && rid === 2) {
    console.log('agents.files.set: ok=' + f.ok);
    console.log(JSON.stringify(f.payload || f.error || {}).slice(0, 500));
    if (f.ok) {
      console.log('SOUL.md deployed successfully! (' + soulContent.length + ' chars)');
    }
    ws.close();
    process.exit(f.ok ? 0 : 1);
  }
});

ws.on('error', (e) => console.log('ERR:', e.message));
setTimeout(() => { ws.close(); process.exit(1); }, 15000);
