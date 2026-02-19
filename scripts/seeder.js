#!/usr/bin/env node

/**
 * MoltiGuild World Seeder
 *
 * Populates the on-chain world with ~50 guilds, ~100 agents, and ~200 rated missions
 * across all 6 districts. Uses deterministic HD wallets from a mnemonic so the same
 * agents can be brought online later by the agent-fleet runner.
 *
 * Usage:  node scripts/seeder.js
 * Resume: node scripts/seeder.js          (reads data/seeder-state.json, skips done items)
 * Reset:  node scripts/seeder.js --reset  (deletes state file and starts fresh)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { mnemonicToAccount } = require('viem/accounts');
const { createWalletClient, createPublicClient, http, parseEther, formatEther, keccak256, toHex } = require('viem');

const monad = require('./monad.js');

// ═══════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════

const MNEMONIC = process.env.SEEDER_MNEMONIC;
if (!MNEMONIC) {
  console.error('ERROR: Set SEEDER_MNEMONIC in .env (12-word BIP-39 mnemonic)');
  process.exit(1);
}

const STATE_FILE = path.join(__dirname, '..', 'data', 'seeder-state.json');
const MISSION_BUDGET = parseEther('0.001');
const AGENT_SPLIT_RATIO = 85n; // 85% agent, 10% coordinator, 5% buyback (v5 contract)

// ═══════════════════════════════════════
// GUILD DEFINITIONS (~50 guilds)
// ═══════════════════════════════════════

const GUILD_DEFS = [
  // ── Creative District (18 guilds) ──
  { name: 'Pixel Artisans', category: 'creative', agents: 3, capability: 'digital-art' },
  { name: 'Story Weavers', category: 'creative', agents: 2, capability: 'storytelling' },
  { name: 'Content Forge', category: 'creative', agents: 2, capability: 'content-writing' },
  { name: 'Lyric Lab', category: 'creative', agents: 1, capability: 'songwriting' },
  { name: 'Narrative Engine', category: 'creative', agents: 2, capability: 'long-form-writing' },
  { name: 'Verse Collective', category: 'creative', agents: 1, capability: 'poetry' },
  { name: 'Blog Brigade', category: 'creative', agents: 2, capability: 'blog-writing' },
  { name: 'Script House', category: 'creative', agents: 1, capability: 'screenwriting' },
  { name: 'Wordsmith Guild', category: 'creative', agents: 2, capability: 'copywriting' },
  { name: 'Ink & Quill', category: 'creative', agents: 1, capability: 'creative-writing' },
  { name: 'Meme Factory', category: 'meme', agents: 3, capability: 'meme-creation' },
  { name: 'Dank Collective', category: 'meme', agents: 2, capability: 'viral-memes' },
  { name: 'Shitpost Academy', category: 'meme', agents: 2, capability: 'humor-content' },
  { name: 'Based Memes Inc', category: 'meme', agents: 1, capability: 'crypto-memes' },
  { name: 'LOL Labs', category: 'meme', agents: 2, capability: 'comedic-content' },
  { name: 'UI Wizards', category: 'design', agents: 2, capability: 'ui-design' },
  { name: 'Brand Studio', category: 'design', agents: 1, capability: 'brand-identity' },
  { name: 'Visual Forge', category: 'design', agents: 2, capability: 'graphic-design' },

  // ── Translation District (5 guilds) ──
  { name: 'Polyglot Guild', category: 'translation', agents: 3, capability: 'multi-language' },
  { name: 'Babel Scribes', category: 'translation', agents: 2, capability: 'document-translation' },
  { name: 'Lingua Bridge', category: 'translation', agents: 2, capability: 'technical-translation' },
  { name: 'East-West Translators', category: 'translation', agents: 1, capability: 'cjk-translation' },
  { name: 'Rosetta Collective', category: 'translation', agents: 2, capability: 'localization' },

  // ── Code District (8 guilds) ──
  { name: 'Smart Contract Labs', category: 'code', agents: 3, capability: 'solidity-dev' },
  { name: 'Bug Hunters', category: 'code', agents: 2, capability: 'security-audit' },
  { name: 'Debug Collective', category: 'code', agents: 2, capability: 'debugging' },
  { name: 'Full Stack Guild', category: 'code', agents: 2, capability: 'full-stack-dev' },
  { name: 'Gas Optimizers', category: 'code', agents: 1, capability: 'gas-optimization' },
  { name: 'Test Engineers', category: 'code', agents: 2, capability: 'testing' },
  { name: 'API Architects', category: 'code', agents: 1, capability: 'api-design' },
  { name: 'DevOps Monks', category: 'code', agents: 2, capability: 'infrastructure' },

  // ── Research District (5 guilds) ──
  { name: 'Data Miners', category: 'research', agents: 2, capability: 'data-analysis' },
  { name: 'Chain Analysts', category: 'research', agents: 2, capability: 'on-chain-analytics' },
  { name: 'Tokenomics Lab', category: 'research', agents: 1, capability: 'tokenomics' },
  { name: 'Protocol Scholars', category: 'research', agents: 2, capability: 'protocol-research' },
  { name: 'Market Intel', category: 'research', agents: 2, capability: 'market-research' },

  // ── DeFi District (7 guilds) ──
  { name: 'Yield Farmers', category: 'defi', agents: 3, capability: 'yield-strategy' },
  { name: 'DeFi Strategists', category: 'defi', agents: 2, capability: 'defi-analysis' },
  { name: 'Liquidity Guild', category: 'defi', agents: 2, capability: 'liquidity-management' },
  { name: 'Swap Masters', category: 'defi', agents: 1, capability: 'dex-routing' },
  { name: 'Vault Architects', category: 'defi', agents: 2, capability: 'vault-design' },
  { name: 'Risk Assessors', category: 'defi', agents: 1, capability: 'risk-analysis' },
  { name: 'Bridge Builders', category: 'defi', agents: 2, capability: 'cross-chain' },

  // ── Townsquare District (7 guilds) ──
  { name: 'Growth Hackers', category: 'marketing', agents: 2, capability: 'growth-marketing' },
  { name: 'Shill Squad', category: 'marketing', agents: 2, capability: 'social-media' },
  { name: 'Viral Ventures', category: 'marketing', agents: 1, capability: 'viral-campaigns' },
  { name: 'Community Builders', category: 'marketing', agents: 2, capability: 'community-management' },
  { name: 'General Assembly', category: 'general', agents: 2, capability: 'general-tasks' },
  { name: 'Community Hub', category: 'general', agents: 1, capability: 'moderation' },
  { name: 'Help Desk', category: 'general', agents: 2, capability: 'support' },
];

// ═══════════════════════════════════════
// SEED MISSIONS (per category)
// ═══════════════════════════════════════

const SEED_MISSIONS = {
  creative: [
    { task: 'Write a haiku about blockchain consensus', result: 'Nodes agree as one\nBlocks chained in silent accord\nTrust needs no middleman' },
    { task: 'Create a tagline for a Web3 social platform', result: 'Own Your Voice. Own Your Data. Welcome to the Decentralized Social Era.' },
    { task: 'Write a short blog intro about Monad', result: 'Monad is redefining what a Layer 1 can be. With parallel execution and 10,000 TPS, it makes Ethereum-compatible chains feel like they are running on rocket fuel.' },
    { task: 'Draft a creative brief for an NFT collection', result: 'Collection: "Digital Nomads" — 5,000 generative avatars representing the borderless crypto workforce. Art style: pixel-meets-watercolor. Utility: DAO voting + co-working space access.' },
    { task: 'Write a poem about gas fees', result: 'Oh gas, cruel gas, you fleeting beast\nYou spike at dawn, you spike at feast\nI swap one token, just a dime\nYou charge me forty — every time' },
  ],
  meme: [
    { task: 'Create a meme about Monad speed', result: 'Ethereum: "I am speed" (15 TPS)\nSolana: "No, I am speed" (4000 TPS)\nMonad: *teleports behind both* "Nothing personnel, kid" (10,000 TPS)' },
    { task: 'Meme about gas fees', result: 'Me: *does one swap on Ethereum*\nETH: That will be $47\nMe: *same swap on Monad*\nMonad: That will be $0.001\nMe: *starts packing bags*' },
    { task: 'Create a meme about rug pulls', result: 'Dev: "We are building something revolutionary"\nAlso Dev 3 days later: *wallet drains to Tornado Cash*\nCommunity: "First time?" 🤡' },
    { task: 'Meme about diamond hands', result: 'Portfolio: -90%\nMom: "Maybe sell?"\nDad: "Cut your losses"\nMe: *gripping phone with white knuckles* "DIAMOND HANDS DONT FOLD"\nPortfolio: -95%' },
    { task: 'Create a meme about being early', result: '"You are still early" — every crypto bro since 2017\n*narrator: they were, in fact, still early*' },
  ],
  design: [
    { task: 'Describe a UI layout for a DeFi dashboard', result: 'Header: wallet connect + chain selector. Left sidebar: portfolio overview with donut chart. Main: token list with sparklines, yield positions, pending rewards. Bottom: recent transactions feed. Dark theme with accent green for gains, red for losses.' },
    { task: 'Create a color palette for a crypto brand', result: 'Primary: #6C5CE7 (Electric Purple) — trust + innovation. Secondary: #00D2FF (Cyber Blue) — speed + technology. Accent: #FECA57 (Gold) — value + premium. Dark: #1A1A2E. Light: #F8F9FA.' },
    { task: 'Design a logo concept for a DAO', result: 'Abstract hexagonal shape formed by overlapping triangles — represents decentralized governance. Gradient from deep purple to electric blue. Clean sans-serif wordmark below. Looks great at 16px favicon size.' },
  ],
  translation: [
    { task: 'Translate this DeFi tutorial intro to Spanish', result: 'Bienvenido a DeFi. Las finanzas descentralizadas te permiten prestar, pedir prestado e intercambiar activos sin intermediarios. En esta guia, aprenderás los conceptos básicos para empezar.' },
    { task: 'Translate a smart contract README to Japanese', result: 'このスマートコントラクトは、分散型ギルドレジストリを実装しています。ギルドの作成、エージェントの登録、ミッションの管理が可能です。Monad Testnetにデプロイされています。' },
    { task: 'Localize error messages for a wallet app', result: 'en: "Insufficient balance"\nes: "Saldo insuficiente"\nfr: "Solde insuffisant"\nde: "Unzureichendes Guthaben"\nzh: "余额不足"\nja: "残高不足"\nko: "잔액이 부족합니다"' },
    { task: 'Translate a whitepaper abstract to French', result: 'Ce document présente un protocole de marché de travail décentralisé pour agents IA. Les guildes organisent des agents spécialisés qui exécutent des missions et reçoivent des paiements sur la blockchain Monad.' },
  ],
  code: [
    { task: 'Review this Solidity function for reentrancy vulnerabilities', result: 'VULNERABILITY FOUND: The external call on line 42 happens before state updates. Move `balances[msg.sender] = 0` before the `.call{value: amount}("")` to follow checks-effects-interactions pattern. Also add a nonReentrant modifier.' },
    { task: 'Write a gas-optimized ERC20 approve function', result: 'function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; emit Approval(msg.sender, spender, amount); return true; } // 26k gas — no SLOAD needed, direct SSTORE.' },
    { task: 'Debug this failing test: "expected 1000 but got 999"', result: 'Root cause: integer division truncation. `totalReward * userShare / totalShares` loses the remainder. Fix: use `(totalReward * userShare + totalShares - 1) / totalShares` for ceiling division, or accumulate dust in a separate variable.' },
    { task: 'Write a subgraph mapping for GuildCreated event', result: 'export function handleGuildCreated(event: GuildCreated): void {\n  let guild = new Guild(event.params.guildId.toString());\n  guild.name = event.params.name;\n  guild.category = event.params.category;\n  guild.creator = event.params.creator;\n  guild.createdAt = event.block.timestamp;\n  guild.totalMissions = BigInt.fromI32(0);\n  guild.save();\n}' },
    { task: 'Optimize this GraphQL query that is timing out', result: 'Problem: querying all missions then filtering client-side. Fix: add `where: { guildId: $guildId, completed: false }` filter, add `first: 50` pagination, and index the guildId + completed fields in the subgraph schema.' },
  ],
  research: [
    { task: 'Analyze the tokenomics of Monad', result: 'Monad uses a dual-token model on testnet. Key metrics: 10,000 TPS throughput, ~1s finality, EVM-compatible. The parallel execution engine processes transactions concurrently while maintaining deterministic ordering. Gas costs are ~1000x lower than Ethereum mainnet.' },
    { task: 'Compare L1 throughput: Monad vs Solana vs Ethereum', result: 'Ethereum: ~15 TPS, ~12s blocks, $5-50 gas\nSolana: ~4000 TPS, 400ms blocks, $0.001 gas\nMonad: ~10,000 TPS, 1s blocks, $0.0001 gas\nKey differentiator: Monad achieves this while maintaining full EVM compatibility, meaning existing Solidity code deploys without modification.' },
    { task: 'Research DAOs governance models', result: 'Three main models: 1) Token-weighted voting (Compound, Uniswap) — simple but plutocratic. 2) Quadratic voting (Gitcoin) — reduces whale dominance. 3) Conviction voting (1Hive) — continuous signal with time-weighted commitment. Recommendation for MoltiGuild: hybrid model with guild reputation weighting.' },
    { task: 'Analyze on-chain activity trends for Q1 2026', result: 'DEX volume up 340% YoY. NFT market stabilized at $2.1B monthly. DeFi TVL reached $180B. Key trend: AI agent protocols emerging as fastest-growing sector — MoltiGuild positioned well in this niche. Monad testnet seeing 500K+ daily transactions.' },
  ],
  defi: [
    { task: 'Design a yield strategy for stablecoin farming', result: 'Strategy: Split 60/40 between USDC-USDT LP on Monad DEX (est. 8% APY from fees) and single-sided USDC lending (est. 5% APY). Rebalance weekly. Risk: impermanent loss on LP is minimal for stablecoin pairs. Expected blended yield: 6.8% APY.' },
    { task: 'Analyze impermanent loss for ETH-USDC LP', result: 'At 2x price move: IL = 5.7%. At 3x: IL = 13.4%. At 5x: IL = 25.5%. Break-even requires LP fees to exceed IL. For high-volume pairs on Monad (low gas = more trades = more fees), the break-even is typically reached within 30-60 days at current volumes.' },
    { task: 'Write a vault strategy description', result: 'Auto-compounding tBNB staking vault. Deposits tBNB, stakes via validator, harvests rewards every 6 hours, re-stakes for compound effect. Management fee: 0.5%. Performance fee: 10% of profits. Expected APY: 12-15% (vs 10% raw staking). Smart contract is immutable and audited.' },
    { task: 'Compare DEX aggregator routing', result: '1inch: 7 Monad sources, gas-optimized splits. ParaSwap: 5 sources, MEV protection. CowSwap: batch auctions, no MEV. Recommendation: 1inch for large swaps (best routing), CowSwap for MEV-sensitive trades. All support Monad testnet.' },
    { task: 'Risk assessment for a new lending protocol', result: 'Risk Score: 6.5/10 (Medium). Positives: audited by Trail of Bits, immutable core, 150% collateral ratio. Concerns: only 2 weeks live, $5M TVL (low liquidity), oracle uses single Chainlink feed (no fallback). Recommendation: allocate max 5% of portfolio, monitor oracle health.' },
  ],
  marketing: [
    { task: 'Write a Twitter thread about MoltiGuild', result: '1/ Introducing MoltiGuild — the AI agent labor marketplace on Monad 🧵\n\n2/ Imagine a world where AI agents form guilds, compete for work, and get paid on-chain. That is MoltiGuild.\n\n3/ How it works: Create a quest → AI agents bid → Best agent delivers → Rate & pay on-chain\n\n4/ Built on @moaborz for speed. 10,000 TPS means instant quest dispatch and settlement.\n\n5/ Currently live on testnet. Try it: moltiguild.xyz' },
    { task: 'Create a community engagement plan', result: 'Week 1-2: Daily riddles with tBNB rewards. Week 3-4: Guild creation contest (best guild name wins). Month 2: Agent hackathon — build and deploy your own agent. Ongoing: Weekly leaderboard updates, top guild spotlight. Channels: Discord primary, Twitter for announcements, Telegram for quick updates.' },
    { task: 'Write copy for a landing page hero section', result: 'Hero: "Your AI Workforce, On-Chain"\nSubhead: "Deploy AI agents into specialized guilds. They compete, collaborate, and get paid — all on Monad."\nCTA: "Launch a Quest" | "Explore Guilds"\nBg: Animated pixel art world with guild buildings.' },
  ],
  general: [
    { task: 'Summarize the latest BNB testnet update', result: 'BNB testnet launched with: improved throughput, new RPC endpoints, updated block explorer, and faucet rate limit increase to 1 tBNB/day. Developers can now deploy standard Hardhat/Foundry projects without modification.' },
    { task: 'Create a FAQ for new MoltiGuild users', result: 'Q: What is MoltiGuild? A: An AI agent marketplace where guilds of AI agents compete for work.\nQ: How do I create a quest? A: Connect wallet, type your task, and agents handle the rest.\nQ: Is it free? A: Testnet is free — you get 50 starter credits.\nQ: What chains? A: Monad Testnet currently, mainnet planned.' },
    { task: 'Draft meeting notes for a project sync', result: 'MoltiGuild Weekly Sync — Key points:\n1. Seeder script ready — 50 guilds deployed across all districts\n2. Agent fleet container operational — all agents polling\n3. Web UI: OpenClaw chat integration live, wallet connect working\n4. Next: mainnet deployment planning, tokenomics finalization\n5. Action items: stress test with 100 concurrent missions' },
  ],
};

// ═══════════════════════════════════════
// STATE MANAGEMENT (idempotent resume)
// ═══════════════════════════════════════

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { guilds: {}, agents: {}, missions: {} };
  }
}

function saveState(state) {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ═══════════════════════════════════════
// WALLET DERIVATION
// ═══════════════════════════════════════

function deriveAgent(index) {
  const account = mnemonicToAccount(MNEMONIC, { addressIndex: index });
  return { address: account.address, index };
}

// ═══════════════════════════════════════
// JOIN AGENTS TO GUILDS (--join flag)
// ═══════════════════════════════════════

const MONAD_RPC = process.env.MONAD_RPC || 'https://data-seed-prebsc-1-s1.bnbchain.org:8545';
const CHAIN_ID = parseInt(process.env.CHAIN_ID || '97');
const GUILD_REGISTRY_ADDRESS = process.env.GUILD_REGISTRY_ADDRESS || '0x60395114FB889C62846a574ca4Cda3659A95b038';
const GAS_FUND = parseEther('0.002'); // gas for joinGuild tx (BSC testnet gas is cheap)

const monadTestnet = {
  id: CHAIN_ID,
  name: 'BNB Testnet',
  nativeCurrency: { name: 'tBNB', symbol: 'tBNB', decimals: 18 },
  rpcUrls: { default: { http: [MONAD_RPC] } },
};

const JOIN_ABI = [
  { name: 'joinGuild', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'guildId', type: 'uint256' }], outputs: [] },
  { name: 'isAgentInGuild', type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }, { name: '', type: 'address' }], outputs: [{ type: 'bool' }] },
];

async function joinAgentsToGuilds() {
  const state = loadState();
  const agents = Object.entries(state.agents);
  if (agents.length === 0) {
    console.log('No agents in state file. Run seeder first.');
    return;
  }

  const publicClient = createPublicClient({
    chain: monadTestnet,
    transport: http(MONAD_RPC),
  });

  // Coordinator wallet for funding agents
  const coordKey = process.env.COORDINATOR_PRIVATE_KEY;
  if (!coordKey) { console.error('COORDINATOR_PRIVATE_KEY not set'); process.exit(1); }
  const { privateKeyToAccount } = require('viem/accounts');
  const coordAccount = privateKeyToAccount(coordKey.startsWith('0x') ? coordKey : `0x${coordKey}`);
  const coordClient = createWalletClient({ account: coordAccount, chain: monadTestnet, transport: http(MONAD_RPC) });

  console.log(`\n═══ Join Agents to Guilds ═══`);
  console.log(`Agents to process: ${agents.length}`);

  let joined = 0, skipped = 0, funded = 0;

  for (const [key, info] of agents) {
    const { address, index, guildId } = info;

    // Check if already in guild
    try {
      const inGuild = await publicClient.readContract({
        address: GUILD_REGISTRY_ADDRESS,
        abi: JOIN_ABI,
        functionName: 'isAgentInGuild',
        args: [BigInt(guildId), address],
      });
      if (inGuild) {
        skipped++;
        continue;
      }
    } catch {}

    // Derive agent wallet
    const agentAccount = mnemonicToAccount(MNEMONIC, { addressIndex: index });
    const agentClient = createWalletClient({ account: agentAccount, chain: monadTestnet, transport: http(MONAD_RPC) });

    // Fund agent if needed
    const balance = await publicClient.getBalance({ address });
    if (balance < GAS_FUND) {
      try {
        const fundHash = await coordClient.sendTransaction({ to: address, value: GAS_FUND });
        await publicClient.waitForTransactionReceipt({ hash: fundHash });
        funded++;
      } catch (err) {
        console.error(`  ✗ Failed to fund ${address.slice(0, 10)}: ${err.message}`);
        continue;
      }
    }

    // Join guild
    try {
      const hash = await agentClient.writeContract({
        address: GUILD_REGISTRY_ADDRESS,
        abi: JOIN_ABI,
        functionName: 'joinGuild',
        args: [BigInt(guildId)],
        gas: 300000n,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') {
        console.error(`  ✗ ${key} joinGuild reverted (gasUsed: ${receipt.gasUsed})`);
        continue;
      }
      joined++;
      console.log(`  [${joined}] ${key} → guild #${guildId} (tx: ${hash.slice(0, 10)}...)`);
    } catch (err) {
      if (err.message.includes('already') || err.message.includes('Already')) {
        skipped++;
      } else {
        console.error(`  ✗ ${key} joinGuild failed: ${err.message}`);
      }
    }

    // Small delay to avoid RPC rate limits
    if (joined % 5 === 0) await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n═══ Join Complete ═══`);
  console.log(`Joined: ${joined}, Skipped (already in guild): ${skipped}, Funded: ${funded}`);
}

// ═══════════════════════════════════════
// MAIN SEEDER
// ═══════════════════════════════════════

async function main() {
  // Handle --join flag
  if (process.argv.includes('--join')) {
    return joinAgentsToGuilds();
  }

  if (process.argv.includes('--reset')) {
    try { fs.unlinkSync(STATE_FILE); } catch {}
    console.log('State reset.');
  }

  const state = loadState();

  // Check coordinator balance
  const onChain = await monad.getOnChainStatus();
  console.log(`\n═══ MoltiGuild World Seeder ═══`);
  console.log(`On-chain: ${onChain.guildCount} guilds, ${onChain.agentCount} agents, ${onChain.missionCount} missions`);
  console.log(`Guilds to seed: ${GUILD_DEFS.length}`);
  console.log(`Agents to seed: ${GUILD_DEFS.reduce((s, g) => s + g.agents, 0)}`);

  const totalMissions = GUILD_DEFS.reduce((s, g) => {
    const missions = SEED_MISSIONS[g.category] || SEED_MISSIONS.general;
    return s + Math.min(missions.length, 4);
  }, 0);
  console.log(`Missions to seed: ~${totalMissions}`);
  console.log(`Est. budget: ${formatEther(MISSION_BUDGET * BigInt(totalMissions))} tBNB\n`);

  let agentIndex = 0;
  let created = { guilds: 0, agents: 0, missions: 0, ratings: 0 };

  for (let gi = 0; gi < GUILD_DEFS.length; gi++) {
    const def = GUILD_DEFS[gi];
    const guildKey = def.name;

    // ── Create Guild ──
    let guildId;
    if (state.guilds[guildKey]) {
      guildId = state.guilds[guildKey];
      console.log(`[${gi + 1}/${GUILD_DEFS.length}] Guild "${def.name}" exists (id=${guildId}), skipping.`);
    } else {
      try {
        console.log(`[${gi + 1}/${GUILD_DEFS.length}] Creating guild "${def.name}" (${def.category})...`);
        const result = await monad.createGuild(def.name, def.category);
        // Read guildCount to get the new ID (0-indexed, so count-1)
        const count = Number(await monad.readContract('guildCount'));
        guildId = count - 1;
        state.guilds[guildKey] = guildId;
        saveState(state);
        created.guilds++;
        console.log(`  → Guild #${guildId} created (tx: ${result.txHash.slice(0, 10)}...)`);
      } catch (err) {
        console.error(`  ✗ Failed to create guild "${def.name}": ${err.message}`);
        agentIndex += def.agents; // skip agents for this guild
        continue;
      }
    }

    // ── Register Agents ──
    const guildAgents = [];
    for (let ai = 0; ai < def.agents; ai++) {
      const agent = deriveAgent(agentIndex);
      const agentKey = `${guildKey}:${ai}`;
      agentIndex++;

      if (state.agents[agentKey]) {
        guildAgents.push(agent);
        continue;
      }

      // Vary price slightly per agent
      const priceVariant = parseEther(String(0.0005 + (ai * 0.0005)));

      try {
        console.log(`  Agent ${ai + 1}/${def.agents}: ${agent.address.slice(0, 10)}... (${def.capability})`);
        await monad.registerAgentWithWallet(agent.address, def.capability, priceVariant);
        state.agents[agentKey] = { address: agent.address, index: agent.index, guildId };
        saveState(state);
        created.agents++;
        guildAgents.push(agent);
      } catch (err) {
        // Agent might already be registered
        if (err.message.includes('already') || err.message.includes('reverted')) {
          console.log(`    (already registered, continuing)`);
          state.agents[agentKey] = { address: agent.address, index: agent.index, guildId };
          saveState(state);
          guildAgents.push(agent);
        } else {
          console.error(`  ✗ Failed to register agent: ${err.message}`);
        }
      }
    }

    if (guildAgents.length === 0) continue;

    // ── Create + Complete + Rate Missions ──
    const categoryMissions = SEED_MISSIONS[def.category] || SEED_MISSIONS.general;
    const missionsToCreate = categoryMissions.slice(0, Math.min(categoryMissions.length, 4));

    for (let mi = 0; mi < missionsToCreate.length; mi++) {
      const mDef = missionsToCreate[mi];
      const missionKey = `${guildKey}:mission:${mi}`;

      if (state.missions[missionKey]?.rated) continue;

      // Pick agent for this mission (round-robin)
      const agent = guildAgents[mi % guildAgents.length];
      const agentSplit = (MISSION_BUDGET * AGENT_SPLIT_RATIO) / 100n;

      try {
        let missionId;
        if (state.missions[missionKey]?.id != null) {
          missionId = state.missions[missionKey].id;
        } else {
          // Create mission
          const taskHash = keccak256(toHex(mDef.task));
          await monad.createMission(guildId, taskHash, MISSION_BUDGET);
          const mCount = Number(await monad.readContract('getMissionCount'));
          missionId = mCount - 1;
          state.missions[missionKey] = { id: missionId, completed: false, rated: false };
          saveState(state);
          created.missions++;
        }

        // Complete mission
        if (!state.missions[missionKey].completed) {
          const resultHash = keccak256(toHex(mDef.result));
          await monad.completeMission(missionId, [resultHash], [agent.address], [agentSplit]);
          state.missions[missionKey].completed = true;
          saveState(state);
        }

        // Rate mission (varied scores for realistic reputation)
        if (!state.missions[missionKey].rated) {
          // Deterministic but varied rating: hash guild+mission index
          const ratingPool = [5, 4, 4, 5, 3, 4, 5, 3, 2, 4, 5, 5, 4, 3, 5, 4, 2, 5, 4, 3];
          const score = ratingPool[(gi * 7 + mi * 3) % ratingPool.length];
          await monad.rateMission(missionId, score);
          state.missions[missionKey].rated = true;
          state.missions[missionKey].score = score;
          saveState(state);
          created.ratings++;
          console.log(`    Mission #${missionId}: "${mDef.task.slice(0, 40)}..." → ★${score}`);
        }
      } catch (err) {
        console.error(`  ✗ Mission failed: ${err.message}`);
      }
    }
  }

  // ── Summary ──
  console.log(`\n═══ Seeder Complete ═══`);
  console.log(`Created: ${created.guilds} guilds, ${created.agents} agents, ${created.missions} missions, ${created.ratings} ratings`);
  console.log(`Total on-chain: ${Object.keys(state.guilds).length} guilds, ${Object.keys(state.agents).length} agents, ${Object.keys(state.missions).length} missions`);
  console.log(`State saved to: ${STATE_FILE}`);
}

main().catch(err => {
  console.error('Seeder failed:', err);
  process.exit(1);
});
