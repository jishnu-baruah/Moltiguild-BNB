#!/usr/bin/env node

/**
 * MoltiGuild Agent Fleet Runner
 *
 * Runs ALL seeded agents concurrently in a single Node.js process.
 * Derives wallets from the same SEEDER_MNEMONIC used by seeder.js.
 * Each agent polls for missions in its guild, does work via LLM, and submits results.
 *
 * Usage:
 *   node scripts/agent-fleet.js              # Run all agents
 *   AGENT_COUNT=10 node scripts/agent-fleet.js  # Run first 10 agents only
 *
 * Requires:
 *   - SEEDER_MNEMONIC in .env (same as seeder.js)
 *   - COORDINATOR_PRIVATE_KEY in .env (to fund agents if needed)
 *   - data/seeder-state.json (created by seeder.js)
 *   - LLM endpoint (OLLAMA_API_URL or GEMINI_API_KEY)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { mnemonicToAccount } = require('viem/accounts');
const { createPublicClient, createWalletClient, http, parseEther, formatEther, keccak256, toHex } = require('viem');

// ═══════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════

const MNEMONIC = process.env.SEEDER_MNEMONIC;
if (!MNEMONIC) {
  console.error('ERROR: Set SEEDER_MNEMONIC in .env');
  process.exit(1);
}

const CONFIG = {
  apiUrl: (process.env.API_URL || 'https://moltiguild-api.onrender.com').replace(/\/+$/, ''),
  rpcUrl: process.env.RPC_URL || 'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
  registryAddress: process.env.REGISTRY_ADDRESS || '0x60395114FB889C62846a574ca4Cda3659A95b038',
  goldskyEndpoint: process.env.GOLDSKY_ENDPOINT || 'https://api.goldsky.com/api/public/project_cmlgbdp3o5ldb01uv0nu66cer/subgraphs/agentguilds-monad-testnet-monad-testnet/v5/gn',
  pollInterval: parseInt(process.env.POLL_INTERVAL || '60') * 1000, // 60s default
  heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL || '300') * 1000,
  maxAgents: parseInt(process.env.AGENT_COUNT || '0'), // 0 = all
  gasPerAgent: parseEther('0.002'), // tBNB to send each agent for gas
  // LLM config
  ollamaUrl: process.env.OLLAMA_API_URL || '',
  ollamaKey: process.env.OLLAMA_API_KEY || '',
  ollamaModel: process.env.OLLAMA_MODEL || 'llama3.1',
  geminiKey: process.env.GEMINI_API_KEY || '',
};

const STATE_FILE = path.join(__dirname, '..', 'data', 'seeder-state.json');

const monadTestnet = {
  id: 97,
  name: 'BNB Testnet',
  nativeCurrency: { name: 'tBNB', symbol: 'tBNB', decimals: 18 },
  rpcUrls: { default: { http: [CONFIG.rpcUrl] } },
};

const ABI = [
  { name: 'registerAgent', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'capability', type: 'string' }, { name: 'priceWei', type: 'uint256' }], outputs: [] },
  { name: 'joinGuild', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'guildId', type: 'uint256' }], outputs: [] },
  { name: 'claimMission', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'missionId', type: 'uint256' }], outputs: [] },
  { name: 'agents', type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'address' }], outputs: [{ name: 'wallet', type: 'address' }, { name: 'owner', type: 'address' }, { name: 'capability', type: 'string' }, { name: 'priceWei', type: 'uint256' }, { name: 'missionsCompleted', type: 'uint256' }, { name: 'active', type: 'bool' }] },
  { name: 'isAgentInGuild', type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }, { name: '', type: 'address' }], outputs: [{ type: 'bool' }] },
  { name: 'missionClaims', type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }], outputs: [{ type: 'address' }] },
];

// ═══════════════════════════════════════
// SHARED CLIENTS
// ═══════════════════════════════════════

const publicClient = createPublicClient({ chain: monadTestnet, transport: http(CONFIG.rpcUrl) });
const contractConfig = { address: CONFIG.registryAddress, abi: ABI };

// Coordinator wallet (for funding agents)
let coordinatorClient = null;
function getCoordinatorClient() {
  if (!coordinatorClient && process.env.COORDINATOR_PRIVATE_KEY) {
    const { privateKeyToAccount } = require('viem/accounts');
    const key = process.env.COORDINATOR_PRIVATE_KEY.startsWith('0x')
      ? process.env.COORDINATOR_PRIVATE_KEY
      : `0x${process.env.COORDINATOR_PRIVATE_KEY}`;
    const account = privateKeyToAccount(key);
    coordinatorClient = createWalletClient({ account, chain: monadTestnet, transport: http(CONFIG.rpcUrl) });
  }
  return coordinatorClient;
}

// ═══════════════════════════════════════
// LLM INTEGRATION
// ═══════════════════════════════════════

const CAPABILITY_PROMPTS = {
  'digital-art': 'You are a digital artist specializing in pixel art and digital illustrations for Web3 projects.',
  'storytelling': 'You are a creative storyteller who writes engaging narratives about crypto and blockchain.',
  'content-writing': 'You are a content writer creating blog posts and articles about Web3, DeFi, and blockchain.',
  'meme-creation': 'You are a meme creator making viral crypto memes. Be funny, reference crypto culture.',
  'viral-memes': 'You are a viral content specialist creating shareable memes about crypto and blockchain.',
  'humor-content': 'You are a comedy writer creating humorous takes on crypto culture and DeFi.',
  'crypto-memes': 'You are a crypto-native meme lord. Reference specific chains, protocols, and CT culture.',
  'ui-design': 'You are a UI/UX designer creating interfaces for DeFi and Web3 applications.',
  'solidity-dev': 'You are a Solidity developer reviewing and writing smart contracts. Be precise and security-focused.',
  'security-audit': 'You are a smart contract auditor finding vulnerabilities. Reference OWASP, reentrancy, access control.',
  'debugging': 'You are a debugging specialist who identifies and fixes software bugs.',
  'data-analysis': 'You are a data analyst specializing in on-chain analytics and blockchain data.',
  'on-chain-analytics': 'You are an on-chain analytics expert tracking whale movements, DeFi flows, and protocol metrics.',
  'yield-strategy': 'You are a DeFi yield strategist optimizing returns across protocols.',
  'defi-analysis': 'You are a DeFi analyst evaluating protocols, risks, and opportunities.',
  'multi-language': 'You are a polyglot translator specializing in technical blockchain documentation.',
  'document-translation': 'You are a document translator converting crypto content between languages.',
  'growth-marketing': 'You are a growth marketer for Web3 projects. Focus on community, virality, and engagement.',
  'social-media': 'You are a social media specialist creating engaging crypto content for Twitter/X.',
  'general-tasks': 'You are a helpful assistant that completes various tasks for a crypto project.',
};

function getSystemPrompt(capability) {
  return CAPABILITY_PROMPTS[capability]
    || `You are a skilled agent specializing in ${capability}. Complete tasks accurately and concisely.`;
}

async function callLLM(systemPrompt, userMessage) {
  // Try Ollama first
  if (CONFIG.ollamaUrl) {
    try {
      const res = await fetch(`${CONFIG.ollamaUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(CONFIG.ollamaKey ? { 'Authorization': `Bearer ${CONFIG.ollamaKey}` } : {}),
        },
        body: JSON.stringify({
          model: CONFIG.ollamaModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          max_tokens: 500,
        }),
      });
      const data = await res.json();
      if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;
    } catch {}
  }

  // Fallback: Gemini
  if (CONFIG.geminiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${CONFIG.geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${systemPrompt}\n\nTask: ${userMessage}` }] }],
            generationConfig: { maxOutputTokens: 500 },
          }),
        },
      );
      const data = await res.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || null;
    } catch {}
  }

  // No LLM available — return a simple template response
  return `[Agent response] Task: "${userMessage.slice(0, 100)}". Completed by ${capability} agent.`;
}

// ═══════════════════════════════════════
// AGENT CLASS
// ═══════════════════════════════════════

class Agent {
  constructor({ address, privateKey, index, guildId, capability }) {
    this.address = address;
    this.index = index;
    this.guildId = guildId;
    this.capability = capability;
    this.tag = `[Agent#${index} ${address.slice(0, 8)}… G${guildId}]`;
    this.working = false;

    const account = privateKey;
    this.walletClient = createWalletClient({
      account,
      chain: monadTestnet,
      transport: http(CONFIG.rpcUrl),
    });
    this.account = account;
  }

  log(msg) {
    const ts = new Date().toISOString().slice(11, 19);
    console.log(`[${ts}] ${this.tag} ${msg}`);
  }

  // ── On-chain actions (agent pays gas) ──

  async sendTx(functionName, args) {
    const hash = await this.walletClient.writeContract({ ...contractConfig, functionName, args });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return receipt.status === 'success';
  }

  async isRegistered() {
    const data = await publicClient.readContract({ ...contractConfig, functionName: 'agents', args: [this.address] });
    return data[5]; // active field
  }

  async isInGuild() {
    return publicClient.readContract({ ...contractConfig, functionName: 'isAgentInGuild', args: [BigInt(this.guildId), this.address] });
  }

  async joinGuild() {
    return this.sendTx('joinGuild', [BigInt(this.guildId)]);
  }

  async claimMission(missionId) {
    return this.sendTx('claimMission', [BigInt(missionId)]);
  }

  // ── API interactions ──

  async signMessage(message) {
    return this.walletClient.signMessage({ account: this.account, message });
  }

  async apiPost(endpoint, params) {
    const timestamp = String(Date.now());
    const action = endpoint.replace('/api/', '');
    const message = `${action}:${JSON.stringify(params)}:${timestamp}`;
    const signature = await this.signMessage(message);

    const res = await fetch(`${CONFIG.apiUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, agentAddress: this.address, signature, timestamp }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(`API ${endpoint}: ${data.error}`);
    return data;
  }

  async heartbeat() {
    try {
      await this.apiPost('/api/heartbeat', {});
    } catch {}
  }

  async submitResult(missionId, resultData) {
    return this.apiPost('/api/submit-result', { missionId: String(missionId), resultData });
  }

  // ── Work ──

  async doWork(task) {
    const systemPrompt = getSystemPrompt(this.capability);
    const result = await callLLM(systemPrompt, task);
    return result || `Completed by ${this.capability} agent.`;
  }

  // ── Mission polling ──

  async getNextStepMissions() {
    try {
      const res = await fetch(`${CONFIG.apiUrl}/api/missions/next?guildId=${this.guildId}`);
      const data = await res.json();
      return data.ok ? data.data?.missions || [] : [];
    } catch { return []; }
  }

  async getOpenMissions() {
    try {
      const res = await fetch(CONFIG.goldskyEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `{ missionCreateds(first: 20, where: { guildId: "${this.guildId}" }, orderBy: timestamp_, orderDirection: desc) { missionId guildId taskHash budget } missionCompleteds { missionId } missionCancelleds { missionId } }`,
        }),
      });
      const json = await res.json();
      if (json.errors) return [];
      const completedIds = new Set([
        ...json.data.missionCompleteds.map(m => m.missionId),
        ...json.data.missionCancelleds.map(m => m.missionId),
      ]);
      return json.data.missionCreateds.filter(m => !completedIds.has(m.missionId));
    } catch { return []; }
  }

  async poll() {
    if (this.working) return;

    try {
      // Priority 1: Pipeline steps
      const nextSteps = await this.getNextStepMissions();
      for (const mission of nextSteps) {
        this.working = true;
        this.log(`Pipeline step: "${mission.role}" for mission #${mission.missionId}`);
        try {
          const task = mission.previousResult
            ? `${mission.task}\n\nPrevious agent's work:\n${mission.previousResult}`
            : mission.task;
          const result = await this.doWork(task);
          await this.submitResult(mission.missionId, result);
          this.log(`Submitted pipeline step result.`);
        } catch (err) {
          this.log(`Pipeline error: ${err.message}`);
        }
        this.working = false;
        return;
      }

      // Priority 2: Open missions
      const missions = await this.getOpenMissions();
      for (const mission of missions) {
        try {
          const claimer = await publicClient.readContract({
            ...contractConfig,
            functionName: 'missionClaims',
            args: [BigInt(mission.missionId)],
          });
          if (claimer !== '0x0000000000000000000000000000000000000000') continue;

          this.working = true;
          this.log(`Claiming mission #${mission.missionId} (${formatEther(BigInt(mission.budget))} tBNB)`);

          await this.claimMission(mission.missionId);

          // Get task description from API (works for standalone + pipeline missions)
          let taskText = `Complete mission ${mission.missionId} for guild ${this.guildId}`;
          try {
            const ctx = await fetch(`${CONFIG.apiUrl}/api/mission-context/${mission.missionId}`);
            const ctxData = await ctx.json();
            if (ctxData.ok && ctxData.data?.task) taskText = ctxData.data.task;
          } catch {}

          const result = await this.doWork(taskText);
          await this.submitResult(mission.missionId, result);
          this.log(`Completed mission #${mission.missionId}`);

          this.working = false;
          return;
        } catch (err) {
          this.log(`Mission error: ${err.message}`);
          this.working = false;
        }
      }
    } catch (err) {
      this.log(`Poll error: ${err.message}`);
    }
  }
}

// ═══════════════════════════════════════
// FLEET STARTUP
// ═══════════════════════════════════════

async function main() {
  console.log('\n═══ MoltiGuild Agent Fleet ═══\n');

  // Load seeder state to know which agents → which guilds
  let seederState;
  try {
    seederState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    console.error(`ERROR: No seeder state found at ${STATE_FILE}`);
    console.error('Run the seeder first: node scripts/seeder.js');
    process.exit(1);
  }

  const agentEntries = Object.entries(seederState.agents || {});
  if (agentEntries.length === 0) {
    console.error('ERROR: No agents in seeder state. Run seeder first.');
    process.exit(1);
  }

  const limit = CONFIG.maxAgents > 0 ? CONFIG.maxAgents : agentEntries.length;
  const agentsToRun = agentEntries.slice(0, limit);

  console.log(`Agents: ${agentsToRun.length} / ${agentEntries.length}`);
  console.log(`API: ${CONFIG.apiUrl}`);
  console.log(`LLM: ${CONFIG.ollamaUrl ? 'Ollama' : CONFIG.geminiKey ? 'Gemini' : 'Template fallback'}`);
  console.log(`Poll interval: ${CONFIG.pollInterval / 1000}s\n`);

  // Create agent instances
  const agents = [];
  for (const [key, info] of agentsToRun) {
    const hdAccount = mnemonicToAccount(MNEMONIC, { addressIndex: info.index });
    agents.push(new Agent({
      address: hdAccount.address,
      privateKey: hdAccount,
      index: info.index,
      guildId: info.guildId,
      capability: key.split(':')[0], // guild name as capability hint
    }));
  }

  // ── Fund agents that need gas ──
  console.log('Checking agent balances...');
  const coordinator = getCoordinatorClient();
  let funded = 0;

  for (const agent of agents) {
    const balance = await publicClient.getBalance({ address: agent.address });
    if (balance < parseEther('0.0005')) {
      if (coordinator) {
        try {
          agent.log(`Low balance (${formatEther(balance)} tBNB), funding...`);
          const hash = await coordinator.sendTransaction({
            to: agent.address,
            value: CONFIG.gasPerAgent,
            type: 'legacy',
          });
          await publicClient.waitForTransactionReceipt({ hash });
          funded++;
        } catch (err) {
          agent.log(`Funding failed: ${err.message}`);
        }
      } else {
        agent.log(`Low balance (${formatEther(balance)} tBNB), no coordinator key to fund.`);
      }
    }
  }
  if (funded > 0) console.log(`Funded ${funded} agents with ${formatEther(CONFIG.gasPerAgent)} tBNB each.\n`);

  // ── Join guilds ──
  console.log('Ensuring all agents are in their guilds...');
  for (const agent of agents) {
    try {
      const inGuild = await agent.isInGuild();
      if (!inGuild) {
        agent.log(`Joining guild ${agent.guildId}...`);
        await agent.joinGuild();
      }
    } catch (err) {
      agent.log(`Join guild error: ${err.message}`);
    }
  }

  // ── Initial heartbeats (staggered) ──
  console.log('\nSending initial heartbeats...');
  for (let i = 0; i < agents.length; i++) {
    agents[i].heartbeat();
    if (i % 10 === 9) await sleep(1000); // batch 10 at a time
  }

  // ── Start poll loops (staggered to avoid thundering herd) ──
  console.log(`\nAll agents online. Polling for missions...\n`);

  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    const offset = Math.floor((i / agents.length) * CONFIG.pollInterval); // spread evenly

    setTimeout(() => {
      // Initial poll
      agent.poll();

      // Recurring poll
      setInterval(() => agent.poll(), CONFIG.pollInterval);
    }, offset);
  }

  // Heartbeat timer (all agents, staggered)
  setInterval(async () => {
    for (let i = 0; i < agents.length; i++) {
      agents[i].heartbeat();
      if (i % 10 === 9) await sleep(500);
    }
  }, CONFIG.heartbeatInterval);

  // Graceful shutdown
  const shutdown = () => {
    console.log('\nShutting down fleet...');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error('Fleet startup failed:', err);
  process.exit(1);
});
