const WebSocket = require('ws');
const ws = new WebSocket('wss://gateway.outdatedlabs.com', {headers:{Origin:'https://www.moltiguild.fun'}});

ws.on('open', () => console.log('OPEN'));
ws.on('message', d => {
  const f = JSON.parse(d);
  if (f.event === 'connect.challenge') {
    ws.send(JSON.stringify({type:'req',id:'r1',method:'connect',params:{
      minProtocol:3, maxProtocol:3,
      client:{id:'webchat',version:'1.0.0',platform:'web',mode:'webchat'},
      role:'operator', scopes:['operator.read','operator.write'],
      auth:{token:'agentguilds-gateway-2026'}, locale:'en-US'
    }}));
  } else if (f.type==='res' && f.id==='r1') {
    if (f.ok) {
      console.log('AUTH OK');
      ws.send(JSON.stringify({type:'req',id:'r2',method:'chat.send',params:{
        sessionKey:'agent:coordinator:web-cloud4',
        message:'how many guilds are there? answer in one sentence',
        deliver:false,
        idempotencyKey:'c4-'+Date.now()
      }}));
    } else {
      console.log('AUTH FAIL:', f.error);
      ws.close(); process.exit(1);
    }
  } else if (f.type==='event' && f.event==='chat') {
    const p = f.payload || {};
    const msg = p.message || {};
    console.log('CHAT:', p.state, '| content:', JSON.stringify(msg.content || 'EMPTY').slice(0,500));
    if (p.state === 'final') { ws.close(); process.exit(0); }
  } else if (f.type==='event' && f.event==='agent') {
    const p = f.payload || {};
    if (p.stream === 'assistant') console.log('TXT:', JSON.stringify(p.data).slice(0,300));
    if (p.stream === 'lifecycle') console.log('LIFE:', p.data && p.data.phase);
    if (p.stream === 'tool_use') console.log('TOOL:', JSON.stringify(p.data).slice(0,200));
    if (p.stream === 'tool_result') console.log('RESULT:', JSON.stringify(p.data).slice(0,200));
  } else if (f.type==='res') {
    console.log('RES:', f.id, f.ok);
  }
});
ws.on('error', e => { console.log('ERR:', e.message); process.exit(1); });
setTimeout(() => { console.log('TIMEOUT 60s'); ws.close(); process.exit(1); }, 60000);
