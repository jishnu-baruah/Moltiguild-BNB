#!/usr/bin/env node
/**
 * Test mission lifecycle visibility through SSE events.
 * Creates a real mission via the REST API and monitors SSE events to verify
 * the full lifecycle is properly broadcast.
 */

const http = require('http');
const https = require('https');

const API_BASE = 'https://moltiguild-api.onrender.com';
const TEST_USER = 'gw:lifecycle-test-' + Date.now();
const startTime = Date.now();

function ts() { return ((Date.now() - startTime) / 1000).toFixed(1) + 's'; }

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const options = {
      method,
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json' },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  console.log('=== Mission Lifecycle SSE Test ===\n');

  // 1. Connect to SSE and collect events
  const events = [];
  let sseConnected = false;

  console.log('[' + ts() + '] Connecting to SSE...');
  const ssePromise = new Promise((resolve) => {
    const url = new URL('/api/events', API_BASE);
    https.get(url, (res) => {
      sseConnected = true;
      console.log('[' + ts() + '] SSE connected (status ' + res.statusCode + ')');

      let buffer = '';
      res.on('data', chunk => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ') && currentEvent) {
            try {
              const data = JSON.parse(line.slice(6));
              events.push({ type: currentEvent, data, time: ts() });
              console.log('[' + ts() + '] SSE: ' + currentEvent + ' — ' + JSON.stringify(data).slice(0, 200));
            } catch { /* skip */ }
            currentEvent = '';
          }
        }
      });

      // Auto-close after timeout
      setTimeout(() => { res.destroy(); resolve(); }, 90000);
    }).on('error', (err) => {
      console.log('[' + ts() + '] SSE error: ' + err.message);
      resolve();
    });
  });

  // Wait for SSE to connect
  await new Promise(r => setTimeout(r, 2000));

  if (!sseConnected) {
    console.log('SSE failed to connect. Testing without it.\n');
  }

  // 2. Check API status
  console.log('\n[' + ts() + '] Checking API status...');
  const status = await apiRequest('GET', '/api/status');
  console.log('[' + ts() + '] Status:', JSON.stringify(status).slice(0, 200));

  // 3. Create a mission via smart-create
  console.log('\n[' + ts() + '] Creating mission via smart-create...');
  const mission = await apiRequest('POST', '/api/smart-create', {
    task: 'Write a haiku about blockchain',
    budget: '0.001',
    userId: TEST_USER,
  });
  console.log('[' + ts() + '] smart-create response:', JSON.stringify(mission).slice(0, 300));

  const missionId = mission.missionId || (mission.data && mission.data.missionId);
  if (!missionId) {
    console.log('\nFailed to create mission. Response:', JSON.stringify(mission));
    process.exit(1);
  }

  console.log('[' + ts() + '] Mission #' + missionId + ' created. Waiting for lifecycle events...');

  // 4. Wait for agent claim + completion (up to 90s)
  let claimed = false;
  let completed = false;
  const checkInterval = setInterval(() => {
    for (const e of events) {
      if (e.data.missionId == missionId) {
        if (e.type === 'mission_claimed' && !claimed) {
          claimed = true;
          console.log('\n[' + e.time + '] CLAIMED by agent: ' + (e.data.agent || 'unknown'));
        }
        if (e.type === 'mission_completed' && !completed) {
          completed = true;
          console.log('[' + e.time + '] COMPLETED! Paid: ' + (e.data.paid || 'unknown') + ' MON');
          console.log('  TX: ' + (e.data.txHash || 'none'));
        }
      }
    }
  }, 1000);

  // Wait up to 90s for completion
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 85000);
    const poll = setInterval(() => {
      if (completed) {
        clearInterval(poll);
        clearTimeout(timeout);
        resolve();
      }
    }, 1000);
  });

  clearInterval(checkInterval);

  // 5. Fetch the result
  if (missionId) {
    console.log('\n[' + ts() + '] Fetching result...');
    const result = await apiRequest('GET', '/api/mission/' + missionId + '/result');
    console.log('[' + ts() + '] Result:', JSON.stringify(result).slice(0, 400));
  }

  // 6. Summary
  console.log('\n=== Lifecycle Summary ===');
  console.log('Mission #' + missionId);
  console.log('Created: YES');
  console.log('Claimed: ' + (claimed ? 'YES' : 'NO (timeout)'));
  console.log('Completed: ' + (completed ? 'YES' : 'NO (timeout)'));
  console.log('SSE events received: ' + events.length);
  console.log('Mission-specific events: ' + events.filter(e => e.data.missionId == missionId).length);

  const missionEvents = events.filter(e => e.data.missionId == missionId);
  if (missionEvents.length > 0) {
    console.log('\nTimeline:');
    for (const e of missionEvents) {
      console.log('  [' + e.time + '] ' + e.type + ': ' + JSON.stringify(e.data).slice(0, 150));
    }
  }

  process.exit(completed ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
