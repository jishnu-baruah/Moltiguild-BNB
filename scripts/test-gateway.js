#!/usr/bin/env node
/**
 * Live gateway integration test.
 * Tests the OpenClaw WebSocket protocol end-to-end.
 */

const WebSocket = require('ws');

const WS_URL = 'wss://gateway.outdatedlabs.com';
const TOKEN = 'agentguilds-gateway-2026';
const ORIGIN = 'http://localhost:3000';

let reqId = 0;
let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) { passed++; console.log('  \u2713 ' + name); }
  else { failed++; console.log('  \u2717 ' + name); }
}

function runTest(label, message) {
  return new Promise((resolve) => {
    const session = 'agent:coordinator:web-test-' + Date.now();
    let localReqId = 0;
    let agentDeltas = 0;
    let chatDeltas = 0;
    let lastAgentText = '';
    let toolUses = [];
    let toolResults = [];

    const ws = new WebSocket(WS_URL, { headers: { Origin: ORIGIN } });

    function sendReq(method, params) {
      const id = 'r' + (++localReqId);
      ws.send(JSON.stringify({ type: 'req', id, method, params }));
      return id;
    }

    ws.on('message', (d) => {
      const frame = JSON.parse(d.toString());

      if (frame.type === 'event' && frame.event === 'connect.challenge') {
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
        sendReq('chat.send', {
          sessionKey: session,
          message: message,
          deliver: false,
          idempotencyKey: 'test-' + Date.now(),
        });
        return;
      }

      if (frame.type === 'event' && frame.event === 'agent') {
        const stream = frame.payload?.stream;
        if (stream === 'assistant') {
          agentDeltas++;
          lastAgentText = String(frame.payload?.data?.text || '');
        } else if (stream === 'tool_use') {
          toolUses.push(frame.payload?.data);
        } else if (stream === 'tool_result') {
          toolResults.push(frame.payload?.data);
        }
        return;
      }

      if (frame.type === 'event' && frame.event === 'chat' && frame.payload?.state === 'final') {
        chatDeltas++;
        const blocks = frame.payload.message?.content || [];
        const textBlocks = blocks.filter(b => b.type === 'text');
        const toolBlocks = blocks.filter(b => b.type === 'tool_use');
        const resultBlocksInChat = blocks.filter(b => b.type === 'tool_result');
        const fullText = textBlocks.map(b => b.text || '').join('');

        ws.close();
        resolve({
          label, agentDeltas, chatDeltas, lastAgentText, fullText,
          textBlocks: textBlocks.length,
          toolUsesInBlocks: toolBlocks.length,
          toolResultsInBlocks: resultBlocksInChat.length,
          toolUsesFromAgent: toolUses.length,
          toolResultsFromAgent: toolResults.length,
          toolUses, toolResults, blocks,
        });
      }

      if (frame.type === 'event' && frame.event === 'chat' && frame.payload?.state === 'delta') {
        chatDeltas++;
      }
    });

    ws.on('error', (e) => {
      console.log('  ERR:', e.message);
      resolve(null);
    });

    setTimeout(() => { ws.close(); resolve(null); }, 90000);
  });
}

async function main() {
  console.log('\n=== MoltiGuild Gateway Integration Tests ===\n');

  // Test 1: Basic text response
  console.log('Test 1: Basic text response');
  const t1 = await runTest('basic', 'Hello! Briefly, what is MoltiGuild?');
  if (t1) {
    check('Got response', t1.fullText.length > 0);
    check('Agent streaming works', t1.agentDeltas > 0);
    check('Agent smoother than chat', t1.agentDeltas > t1.chatDeltas);
    check('Text matches between streams', t1.lastAgentText.trim() === t1.fullText.trim());
    console.log('  Stats: ' + t1.agentDeltas + ' agent / ' + t1.chatDeltas + ' chat deltas, ' + t1.fullText.length + ' chars');
    console.log('  Preview: ' + t1.fullText.slice(0, 150).replace(/\n/g, ' '));
  } else {
    failed++; console.log('  \u2717 Test 1 failed to complete');
  }

  // Test 2: Markdown-rich response
  console.log('\nTest 2: Markdown formatting');
  const t2 = await runTest('markdown', 'Give me a numbered list of 3 tips for new guild creators. Use bold for keywords.');
  if (t2) {
    check('Got response', t2.fullText.length > 0);
    check('Contains bold markdown', /\*\*/.test(t2.fullText));
    check('Contains list items', /\d+[.)]\s/.test(t2.fullText) || /^[-*]\s/m.test(t2.fullText));
    console.log('  Preview: ' + t2.fullText.slice(0, 200).replace(/\n/g, ' | '));
  } else {
    failed++; console.log('  \u2717 Test 2 failed to complete');
  }

  // Test 3: Tool usage (ask something that requires reading files/data)
  console.log('\nTest 3: Tool usage');
  const t3 = await runTest('tools', 'Run "date" in the terminal and tell me the output.');
  if (t3) {
    check('Got response', t3.fullText.length > 0);
    const hasTools = t3.toolUsesFromAgent > 0 || t3.toolUsesInBlocks > 0;
    if (hasTools) {
      check('Tool use detected', true);
      check('Tool result received', t3.toolResultsFromAgent > 0 || t3.toolResultsInBlocks > 0);
      console.log('  Tools: ' + t3.toolUsesFromAgent + ' uses (agent), ' + t3.toolUsesInBlocks + ' uses (blocks)');
      console.log('  Results: ' + t3.toolResultsFromAgent + ' (agent), ' + t3.toolResultsInBlocks + ' (blocks)');
      if (t3.toolUses[0]) {
        console.log('  Tool name: ' + (t3.toolUses[0].name || 'unknown'));
      }
    } else {
      console.log('  (No tools used - agent answered from knowledge)');
      check('Text response fallback', t3.fullText.length > 20);
    }
    console.log('  Preview: ' + t3.fullText.slice(0, 150).replace(/\n/g, ' '));
  } else {
    failed++; console.log('  \u2717 Test 3 failed to complete');
  }

  console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed ===\n');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
