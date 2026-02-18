#!/usr/bin/env node

/**
 * AgentGuilds Coordinator API — BNB Testnet
 *
 * Lightweight Express API for external agent communication.
 *
 * Endpoints:
 *   POST /api/heartbeat        - Agent liveness check
 *   POST /api/submit-result    - Submit mission results
 *   POST /api/claim-mission    - Claim a mission (on-chain v4)
 *   POST /api/join-guild       - Join a guild (on-chain v4)
 *   POST /api/leave-guild      - Leave a guild (on-chain v4)
 *   POST /api/deposit          - Deposit tBNB (on-chain v4)
 *   POST /api/create-pipeline  - Create multi-agent mission (intra-guild)
 *   GET  /api/pipeline/:id     - Pipeline status
 *   GET  /api/pipelines        - All pipelines
 *   GET  /api/missions/next    - Missions awaiting next step (for agents)
 *   GET  /api/missions/open    - Browse open missions
 *   GET  /api/agents/online    - Online agents
 *   GET  /api/guilds           - Browse guilds
 *   GET  /api/guilds/:id/agents - Guild members (on-chain v4)
 *   GET  /api/status           - Platform stats
 *   GET  /api/balance/:address - User deposit balance (v4)
 *   GET  /api/events           - SSE event stream (real-time updates)
 *   POST /api/smart-create         - Auto-match guild & create mission (admin key)
 *   POST /api/smart-pipeline       - Auto-match guild & create pipeline (admin key)
 *   GET  /health                    - Lightweight health check
 *   GET  /api/mission/:id/result   - Get completed mission result
 *   POST /api/mission/:id/rate     - Rate a mission (1-5 stars)
 *   GET  /api/mission/:id/rating   - Get mission rating
 *   POST /api/admin/create-mission - Create mission (admin key)
 *   POST /api/admin/rate-mission   - Rate mission (admin key)
 *   POST /api/admin/create-guild   - Create guild (admin key)
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { verifyMessage } = require('viem');
const monad = require('./monad');
const { matchGuildForTask } = require('./guild-matcher');
const worldState = require('./world-state');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const app = express();
app.use(express.json());

// Health check — lightweight, for uptime monitors
app.get('/health', (req, res) => res.json({ ok: true, uptime: Math.floor(process.uptime()) }));

// API discovery — machine-readable endpoint index for agents
app.get('/api', (req, res) => res.json({
    name: 'AgentGuilds BNB Coordinator API',
    docs: 'https://moltiguild.fun/SKILL.md',
    endpoints: {
        discovery: {
            'GET /api': 'This endpoint — lists all available endpoints',
            'GET /health': 'Health check',
            'GET /api/status': 'Platform stats (guilds, missions, agents)',
            'GET /api/events': 'SSE real-time event stream',
        },
        guilds: {
            'GET /api/guilds': 'List all guilds with stats',
            'GET /api/guilds/:id/agents': 'Guild members',
            'GET /api/guilds/:id/missions': 'Guild missions',
        },
        missions: {
            'GET /api/missions/open': 'Open missions (optional ?guildId=N)',
            'GET /api/missions/next': 'Pipeline missions awaiting next step',
            'GET /api/mission/:id/result': 'Get completed mission output',
            'GET /api/mission/:id/rating': 'Get mission rating',
            'GET /api/mission-context/:missionId': 'Pipeline context for a mission',
            'POST /api/smart-create': 'Create a mission (auto-matches guild). Body: {task, budget, userId}',
            'POST /api/mission/:id/rate': 'Rate 1-5 stars. Body: {rating, userId}',
            'POST /api/create-pipeline': 'Multi-agent pipeline. Body: {guildId, task, budget, steps}',
        },
        agents: {
            'GET /api/agents/online': 'Online agents',
            'POST /api/register-agent': 'Register on-chain (requires EIP-191 signature)',
            'POST /api/join-guild': 'Join guild (requires signature)',
            'POST /api/leave-guild': 'Leave guild (requires signature)',
            'POST /api/claim-mission': 'Claim mission (requires signature)',
            'POST /api/submit-result': 'Submit work + get paid (requires signature)',
            'POST /api/heartbeat': 'Report agent online (requires signature)',
        },
        credits: {
            'GET /api/credits/:userId': 'Check credit balance',
            'POST /api/verify-payment': 'Verify tBNB transfer and credit user',
            'POST /api/auto-setup': 'Generate wallet + faucet + deposit (testnet only)',
        },
        treasury: {
            'GET /api/treasury': 'Buyback treasury balance and $GUILD token info',
            'POST /api/admin/buyback': 'Check treasury status for manual buyback (admin)',
        },
        world: {
            'GET /api/world/districts': 'World map districts',
            'GET /api/world/plots': 'Available plots (?district=X&tier=Y)',
            'GET /api/world/districts/:id/suggested-plots': 'Top 5 plots for district+tier',
        },
        chain: {
            'GET /api/balance/:address': 'On-chain deposit balance',
        },
    },
}));

// CORS - allow web dashboards and bots to call the API
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

const PORT = process.env.PORT || process.env.API_PORT || 3001;
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';

// ═══════════════════════════════════════
// SSE EVENT STREAM
// ═══════════════════════════════════════

const sseClients = new Set();

function broadcast(event, data) {
    const enriched = { type: event, ...data };
    const payload = `event: ${event}\ndata: ${JSON.stringify(enriched)}\n\n`;
    for (const res of sseClients) {
        res.write(payload);
    }
}

// ═══════════════════════════════════════
// PERSISTENT STATE (Upstash Redis → JSON file fallback)
// ═══════════════════════════════════════

let redis = null;
if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    const { Redis } = require('@upstash/redis');
    redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    console.log('Using Upstash Redis for state');
} else {
    console.log('No UPSTASH_REDIS_REST_URL — falling back to JSON files');
}

// JSON file fallback (local dev or no Redis)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJSONFile(filename, defaultValue = {}) {
    try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), 'utf8')); }
    catch { return defaultValue; }
}

function saveJSONFile(filename, data) {
    ensureDataDir();
    fs.writeFileSync(path.join(DATA_DIR, filename), JSON.stringify(data, null, 2));
}

// Unified async getters/setters — Redis if available, JSON files otherwise
async function getHeartbeats() {
    if (redis) return (await redis.get('heartbeats')) || {};
    return loadJSONFile('heartbeats.json');
}

async function saveHeartbeats(data) {
    if (redis) { await redis.set('heartbeats', data); return; }
    saveJSONFile('heartbeats.json', data);
}

async function getPipelines() {
    if (redis) return (await redis.get('pipelines')) || {};
    return loadJSONFile('pipelines.json');
}

async function savePipelines(data) {
    if (redis) { await redis.set('pipelines', data); return; }
    saveJSONFile('pipelines.json', data);
}

// Mission task descriptions (missionId → task text)
async function getMissionTasks() {
    if (redis) return (await redis.get('mission-tasks')) || {};
    return loadJSONFile('mission-tasks.json');
}

async function saveMissionTask(missionId, task) {
    if (redis) {
        const tasks = (await redis.get('mission-tasks')) || {};
        tasks[String(missionId)] = task;
        await redis.set('mission-tasks', tasks);
    } else {
        const tasks = loadJSONFile('mission-tasks.json');
        tasks[String(missionId)] = task;
        saveJSONFile('mission-tasks.json', tasks);
    }
}

async function getPipelineCounter() {
    if (redis) return (await redis.get('pipeline:counter')) || 0;
    return Object.keys(loadJSONFile('pipelines.json')).length;
}

async function incPipelineCounter() {
    if (redis) return await redis.incr('pipeline:counter');
    const count = Object.keys(loadJSONFile('pipelines.json')).length + 1;
    return count;
}

let pipelineCounter = 0;

// ═══════════════════════════════════════
// USER CREDITS (pay-per-mission)
// ═══════════════════════════════════════

const COORDINATOR_ADDRESS = process.env.COORDINATOR_ADDRESS || '0xf7D8E04f82d343B68a7545FF632e282B502800Fd';

async function getCredits(userId) {
    if (redis) return parseFloat((await redis.get(`credits:${userId}`)) || '0');
    const credits = loadJSONFile('credits.json');
    return parseFloat(credits[userId] || '0');
}

async function setCredits(userId, amount) {
    if (redis) return await redis.set(`credits:${userId}`, String(amount));
    const credits = loadJSONFile('credits.json');
    credits[userId] = String(amount);
    saveJSONFile('credits.json', credits);
}

async function getUsedTxHashes() {
    if (redis) return (await redis.get('used_tx_hashes')) || [];
    return loadJSONFile('used_tx_hashes.json', []);
}

async function addUsedTxHash(hash) {
    if (redis) {
        const used = (await redis.get('used_tx_hashes')) || [];
        used.push(hash);
        return await redis.set('used_tx_hashes', used);
    }
    const used = loadJSONFile('used_tx_hashes.json', []);
    used.push(hash);
    saveJSONFile('used_tx_hashes.json', used);
}

// ═══════════════════════════════════════
// AUTO-SETUP (wallet generation + faucet + deposit)
// ═══════════════════════════════════════

const { generatePrivateKey, privateKeyToAccount } = require('viem/accounts');

async function getUserWallet(userId) {
    if (redis) return await redis.get(`wallet:${userId}`);
    const wallets = loadJSONFile('wallets.json');
    return wallets[userId] || null;
}

async function saveUserWallet(userId, data) {
    if (redis) return await redis.set(`wallet:${userId}`, data);
    const wallets = loadJSONFile('wallets.json');
    wallets[userId] = data;
    saveJSONFile('wallets.json', wallets);
}

const FAUCET_URL = 'https://testnet.bnbchain.org/faucet-smart';
const SETUP_AMOUNT = '0.05'; // Give users 0.05 tBNB = 50 missions

async function autoSetupUser(userId) {
    // Check if already set up
    let wallet = await getUserWallet(userId);
    if (wallet) {
        const credits = await getCredits(userId);
        return { alreadySetup: true, address: wallet.address, credits };
    }

    // Generate wallet
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    wallet = { address: account.address, key: privateKey };
    await saveUserWallet(userId, wallet);

    // Faucet — BNB testnet faucet (manual, auto-faucet not supported)
    let faucetOk = false;
    try {
        const fRes = await fetch(FAUCET_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: account.address, chainId: 97 }),
        });
        const fData = await fRes.json();
        faucetOk = !!fData.txHash;
    } catch (e) { /* faucet may fail, continue */ }

    if (faucetOk) {
        // Wait for faucet to land
        await new Promise(r => setTimeout(r, 5000));

        // Send tBNB from user wallet to coordinator
        try {
            const { createWalletClient: cwc, http: httpT, parseEther: pe } = require('viem');
            const userWallet = cwc({
                account,
                chain: monad.monadTestnet,
                transport: httpT(process.env.MONAD_RPC || 'https://data-seed-prebsc-1-s1.bnbchain.org:8545'),
            });

            const hash = await userWallet.sendTransaction({
                to: COORDINATOR_ADDRESS,
                value: pe(SETUP_AMOUNT),
                // BNB testnet supports EIP-1559
            });

            const publicClient = monad.getPublicClient();
            await publicClient.waitForTransactionReceipt({ hash, timeout: 30000 });

            // Credit the user
            const currentCredits = await getCredits(userId);
            await setCredits(userId, currentCredits + parseFloat(SETUP_AMOUNT));
            await addUsedTxHash(hash.toLowerCase());

            return {
                alreadySetup: false,
                address: account.address,
                credits: currentCredits + parseFloat(SETUP_AMOUNT),
                funded: true,
                depositTx: hash,
            };
        } catch (e) {
            return { alreadySetup: false, address: account.address, credits: 0, funded: false, error: e.message };
        }
    }

    return { alreadySetup: false, address: account.address, credits: 0, funded: false, error: 'Faucet unavailable' };
}

// ═══════════════════════════════════════
// SIGNATURE VERIFICATION
// ═══════════════════════════════════════

const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

async function verifyAgentSignature(agentAddress, action, params, timestamp, signature) {
    const now = Date.now();
    const ts = parseInt(timestamp);
    if (Math.abs(now - ts) > SIGNATURE_MAX_AGE_MS) {
        throw new Error('Signature expired');
    }

    const message = `${action}:${JSON.stringify(params)}:${timestamp}`;
    const valid = await verifyMessage({ address: agentAddress, message, signature });
    if (!valid) throw new Error('Invalid signature');
    return true;
}

function requireAuth(action) {
    return async (req, res, next) => {
        try {
            const { agentAddress, signature, timestamp } = req.body;
            if (!agentAddress || !signature || !timestamp) {
                return res.status(400).json({ ok: false, error: 'Missing agentAddress, signature, or timestamp' });
            }
            const params = { ...req.body };
            delete params.agentAddress;
            delete params.signature;
            delete params.timestamp;
            await verifyAgentSignature(agentAddress, action, params, timestamp, signature);
            req.agentAddress = agentAddress;
            next();
        } catch (err) {
            return res.status(401).json({ ok: false, error: err.message });
        }
    };
}

// ═══════════════════════════════════════
// POST ENDPOINTS (authenticated)
// ═══════════════════════════════════════

// POST /api/register-agent - Register agent on-chain
app.post('/api/register-agent', requireAuth('register-agent'), async (req, res) => {
    try {
        const { capability, priceWei } = req.body;
        if (!capability) return res.status(400).json({ ok: false, error: 'Missing capability' });
        const price = priceWei || '1000000000000000'; // default 0.001 tBNB

        const result = await monad.registerAgentWithWallet(req.agentAddress, capability, price);
        broadcast('agent_registered', { agent: req.agentAddress, capability, priceWei: price, ...result });
        res.json({ ok: true, agent: req.agentAddress, capability, ...result });
    } catch (err) {
        if (err.message?.includes('already registered')) {
            return res.json({ ok: true, agent: req.agentAddress, alreadyRegistered: true });
        }
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/heartbeat
app.post('/api/heartbeat', requireAuth('heartbeat'), async (req, res) => {
    try {
        const heartbeats = await getHeartbeats();
        heartbeats[req.agentAddress] = {
            lastSeen: Date.now(),
            timestamp: new Date().toISOString(),
        };
        await saveHeartbeats(heartbeats);
        broadcast('heartbeat', { agent: req.agentAddress, timestamp: new Date().toISOString() });
        res.json({ ok: true, message: 'Heartbeat recorded' });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/join-guild - On-chain via v4 contract
app.post('/api/join-guild', requireAuth('join-guild'), async (req, res) => {
    try {
        const { guildId } = req.body;
        if (guildId === undefined) {
            return res.status(400).json({ ok: false, error: 'Missing guildId' });
        }
        // v4: on-chain guild membership
        const result = await monad.joinGuild(parseInt(guildId));
        broadcast('agent_joined_guild', { agent: req.agentAddress, guildId: parseInt(guildId), ...result });
        res.json({ ok: true, data: { guildId, agent: req.agentAddress, ...result } });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/leave-guild - On-chain via v4 contract
app.post('/api/leave-guild', requireAuth('leave-guild'), async (req, res) => {
    try {
        const { guildId } = req.body;
        if (guildId === undefined) {
            return res.status(400).json({ ok: false, error: 'Missing guildId' });
        }
        const result = await monad.leaveGuild(parseInt(guildId));
        broadcast('agent_left_guild', { agent: req.agentAddress, guildId: parseInt(guildId), ...result });
        res.json({ ok: true, data: { guildId, agent: req.agentAddress, ...result } });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/claim-mission - On-chain via v4 contract
app.post('/api/claim-mission', requireAuth('claim-mission'), async (req, res) => {
    try {
        const { missionId } = req.body;
        if (missionId === undefined) {
            return res.status(400).json({ ok: false, error: 'Missing missionId' });
        }
        // v4: on-chain mission claiming with budget check
        const result = await monad.claimMission(parseInt(missionId));
        broadcast('mission_claimed', { missionId: parseInt(missionId), agent: req.agentAddress, ...result });
        res.json({ ok: true, data: { missionId, agent: req.agentAddress, ...result } });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/create-pipeline - Intra-guild multi-agent mission
// Creates ONE on-chain mission. Multiple agents in the same guild
// collaborate in steps. Coordinator completes with multi-agent splits.
app.post('/api/create-pipeline', async (req, res) => {
    try {
        const { guildId, steps, task, budget } = req.body;
        if (guildId === undefined) return res.status(400).json({ ok: false, error: 'Missing guildId' });
        if (!steps || !Array.isArray(steps) || steps.length < 2) {
            return res.status(400).json({ ok: false, error: 'Need at least 2 steps (e.g. [{ "role": "writer" }, { "role": "designer" }])' });
        }
        if (!task) return res.status(400).json({ ok: false, error: 'Missing task description' });
        if (!budget) return res.status(400).json({ ok: false, error: 'Missing budget (in tBNB, e.g. "0.01")' });

        const counter = await incPipelineCounter();
        const pipelineId = `pipeline-${counter}`;
        const budgetWei = monad.parseEther(budget);
        const taskHash = monad.hashTask(task);
        const gid = parseInt(guildId);

        // Create ONE on-chain mission for this guild
        const txResult = await monad.createMission(gid, taskHash, budgetWei);
        const missionCount = Number(await monad.readContract('getMissionCount'));
        const missionId = missionCount - 1;

        // Store pipeline state off-chain
        const pipelines = await getPipelines();
        pipelines[pipelineId] = {
            id: pipelineId,
            missionId,
            guildId: gid,
            task,
            budget,
            steps: steps.map((s, i) => ({
                step: i + 1,
                role: s.role || `Step ${i + 1}`,
                status: i === 0 ? 'awaiting_claim' : 'pending',
                agent: null,
                result: null,
            })),
            currentStep: 1,
            totalSteps: steps.length,
            status: 'active',
            contributors: [], // { agent, role, result, resultHash }
            createdAt: new Date().toISOString(),
        };
        await savePipelines(pipelines);
        await saveMissionTask(missionId, task);

        broadcast('pipeline_created', { pipelineId, missionId, guildId: gid, task, totalSteps: steps.length, budget });
        res.json({
            ok: true,
            data: {
                pipelineId,
                missionId,
                guildId: gid,
                totalSteps: steps.length,
                currentStep: 1,
                currentRole: steps[0].role,
                budget: `${budget} tBNB`,
                ...txResult,
            },
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/submit-result
// For pipeline missions: if not the last step, stores partial result and
// opens next step. If last step, completes on-chain with all contributors.
// For standalone missions: completes immediately (single agent, 90% split).
app.post('/api/submit-result', requireAuth('submit-result'), async (req, res) => {
    try {
        const { missionId, resultData } = req.body;
        if (missionId === undefined || !resultData) {
            return res.status(400).json({ ok: false, error: 'Missing missionId or resultData' });
        }

        const mid = parseInt(missionId);
        const resultHash = monad.hashResult(resultData);

        // Check if this mission is part of a pipeline
        const pipelines = await getPipelines();
        let pipeline = null;
        let pipelineId = null;
        for (const [pid, p] of Object.entries(pipelines)) {
            if (p.missionId === mid && p.status === 'active') {
                pipeline = p;
                pipelineId = pid;
                break;
            }
        }

        if (pipeline) {
            // ── PIPELINE MISSION: intra-guild multi-agent ──
            const stepIdx = pipeline.currentStep - 1;
            const step = pipeline.steps[stepIdx];

            // Record this agent's contribution
            step.status = 'completed';
            step.agent = req.agentAddress;
            step.result = resultData;
            pipeline.contributors.push({
                agent: req.agentAddress,
                role: step.role,
                result: resultData,
                resultHash,
            });

            const isLastStep = pipeline.currentStep >= pipeline.totalSteps;

            if (!isLastStep) {
                // Open next step
                const nextStep = pipeline.steps[pipeline.currentStep];
                nextStep.status = 'awaiting_claim';
                nextStep.previousResult = resultData;
                pipeline.currentStep += 1;
                await savePipelines(pipelines);

                broadcast('step_completed', {
                    pipelineId, missionId: mid, agent: req.agentAddress,
                    completedStep: step.step, completedRole: step.role,
                    nextStep: nextStep.step, nextRole: nextStep.role,
                    totalSteps: pipeline.totalSteps,
                });
                return res.json({
                    ok: true,
                    data: {
                        missionId: mid,
                        resultHash,
                        pipeline: {
                            pipelineId,
                            completedStep: step.step,
                            completedRole: step.role,
                            nextStep: nextStep.step,
                            nextRole: nextStep.role,
                            totalSteps: pipeline.totalSteps,
                            status: 'next_step_open',
                        },
                    },
                });
            }

            // ── LAST STEP: complete on-chain with all contributors ──
            const allHashes = pipeline.contributors.map(c => c.resultHash);
            const allAgents = pipeline.contributors.map(c => c.agent);
            const budget = (await monad.readContract('getMission', [BigInt(mid)])).budget;
            const agentPool = (budget * 85n) / 100n; // 85% to agents (v5: 10% coord + 5% buyback)
            const perAgent = agentPool / BigInt(allAgents.length); // equal split

            // On-chain claim is by first agent; coordinator completes with all splits
            const txResult = await monad.completeMission(mid, allHashes, allAgents, allAgents.map(() => perAgent));

            pipeline.status = 'completed';
            pipeline.completedAt = new Date().toISOString();
            await savePipelines(pipelines);

            broadcast('pipeline_completed', {
                pipelineId, missionId: mid,
                contributors: pipeline.contributors.map(c => ({ agent: c.agent, role: c.role })),
                totalSteps: pipeline.totalSteps,
                ...txResult,
            });
            return res.json({
                ok: true,
                data: {
                    missionId: mid,
                    resultHash,
                    ...txResult,
                    pipeline: {
                        pipelineId,
                        status: 'completed',
                        totalSteps: pipeline.totalSteps,
                        contributors: pipeline.contributors.map(c => ({
                            agent: c.agent,
                            role: c.role,
                            paid: monad.formatEther(perAgent) + ' tBNB',
                        })),
                    },
                },
            });
        }

        // ── STANDALONE MISSION: single agent ──
        const claimer = await monad.getMissionClaim(mid);
        if (claimer === '0x0000000000000000000000000000000000000000') {
            return res.status(400).json({ ok: false, error: 'Mission not claimed yet' });
        }

        const mission = await monad.readContract('getMission', [BigInt(mid)]);
        if (mission.completed) {
            return res.status(409).json({ ok: false, error: 'Mission already completed' });
        }

        const budget = mission.budget;
        const agentSplit = (budget * 85n) / 100n; // v5: 85% agent, 10% coord, 5% buyback

        const txResult = await monad.completeMission(mid, [resultHash], [claimer], [agentSplit]);

        // Store result for retrieval
        if (redis) {
            await redis.set(`result:${mid}`, JSON.stringify({ missionId: mid, agent: claimer, result: resultData, completedAt: new Date().toISOString() }));
        } else {
            const results = loadJSONFile('results.json');
            results[mid] = { missionId: mid, agent: claimer, result: resultData, completedAt: new Date().toISOString() };
            saveJSONFile('results.json', results);
        }

        broadcast('mission_completed', {
            missionId: mid, agent: claimer,
            paid: monad.formatEther(agentSplit) + ' tBNB',
            result: resultData,
            ...txResult,
        });
        res.json({
            ok: true,
            data: {
                missionId: mid,
                resultHash,
                agentPaid: monad.formatEther(agentSplit) + ' tBNB',
                claimer,
                ...txResult,
            },
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/deposit - On-chain deposit
app.post('/api/deposit', requireAuth('deposit'), async (req, res) => {
    try {
        const { amount } = req.body;
        if (!amount) return res.status(400).json({ ok: false, error: 'Missing amount' });
        const result = await monad.depositFunds(monad.parseEther(amount));
        res.json({ ok: true, data: { amount: `${amount} tBNB`, ...result } });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ═══════════════════════════════════════
// ADMIN ENDPOINTS (API key auth)
// ═══════════════════════════════════════

function requireAdmin(req, res, next) {
    const key = req.headers['x-admin-key'] || req.body.apiKey;
    if (!ADMIN_API_KEY || key !== ADMIN_API_KEY) {
        return res.status(401).json({ ok: false, error: 'Invalid or missing admin API key' });
    }
    next();
}

// POST /api/admin/create-mission - Create a standalone mission (coordinator signs on-chain)
app.post('/api/admin/create-mission', requireAdmin, async (req, res) => {
    try {
        const { guildId, task, budget } = req.body;
        if (guildId === undefined || !task || !budget) {
            return res.status(400).json({ ok: false, error: 'Missing guildId, task, or budget' });
        }
        const taskHash = monad.hashTask(task);
        const budgetWei = monad.parseEther(budget);
        const txResult = await monad.createMission(parseInt(guildId), taskHash, budgetWei);
        const missionCount = Number(await monad.readContract('getMissionCount'));
        const missionId = missionCount - 1;

        await saveMissionTask(missionId, task);
        broadcast('mission_created', { missionId, guildId: parseInt(guildId), task, budget });
        res.json({ ok: true, data: { missionId, guildId: parseInt(guildId), task, taskHash, budget: `${budget} tBNB`, ...txResult } });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/admin/rate-mission - Rate a completed mission
app.post('/api/admin/rate-mission', requireAdmin, async (req, res) => {
    try {
        const { missionId, score } = req.body;
        if (missionId === undefined || score === undefined) {
            return res.status(400).json({ ok: false, error: 'Missing missionId or score' });
        }
        const s = parseInt(score);
        if (s < 1 || s > 5) {
            return res.status(400).json({ ok: false, error: 'Score must be 1-5' });
        }
        const txResult = await monad.rateMission(parseInt(missionId), s);

        broadcast('mission_rated', { missionId: parseInt(missionId), score: s, ...txResult });
        res.json({ ok: true, data: { missionId: parseInt(missionId), score: s, ...txResult } });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/admin/create-guild - Create a new guild
app.post('/api/admin/create-guild', requireAdmin, async (req, res) => {
    try {
        const { name, category } = req.body;
        if (!name || !category) {
            return res.status(400).json({ ok: false, error: 'Missing name or category' });
        }
        const txResult = await monad.createGuild(name, category);
        const guildCount = Number(await monad.readContract('guildCount'));

        broadcast('guild_created', { guildId: guildCount - 1, name, category });
        res.json({ ok: true, data: { guildId: guildCount - 1, name, category, ...txResult } });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ═══════════════════════════════════════
// USER CREDITS ENDPOINTS
// ═══════════════════════════════════════

// GET /api/credits/:userId - Check user's credit balance (read-only, no side effects)
app.get('/api/credits/:userId', async (req, res) => {
    try {
        const credits = await getCredits(req.params.userId);
        res.json({ ok: true, data: { userId: req.params.userId, credits: `${credits} tBNB`, raw: credits, mainnet: monad.IS_MAINNET } });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/claim-starter - Grant starter credits (testnet only, one-time)
app.post('/api/claim-starter', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ ok: false, error: 'userId required' });

        const credits = await getCredits(userId);
        if (credits > 0) {
            return res.json({ ok: true, data: { userId, credits: `${credits} tBNB`, raw: credits, alreadyClaimed: true } });
        }

        const wallet = await getUserWallet(userId);
        if (wallet) {
            return res.json({ ok: true, data: { userId, credits: '0 tBNB', raw: 0, spent: true } });
        }

        const STARTER_CREDITS = 0.05;
        await setCredits(userId, STARTER_CREDITS);
        console.log(`[claim-starter] Granted ${STARTER_CREDITS} tBNB to new user ${userId}`);
        res.json({ ok: true, data: { userId, credits: `${STARTER_CREDITS} tBNB`, raw: STARTER_CREDITS, granted: true } });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/verify-payment - Verify tBNB transfer to coordinator, credit user
app.post('/api/verify-payment', async (req, res) => {
    try {
        const { txHash, userId } = req.body;
        if (!txHash || !userId) return res.status(400).json({ ok: false, error: 'Missing txHash or userId' });

        // Check if tx already used
        const usedHashes = await getUsedTxHashes();
        if (usedHashes.includes(txHash.toLowerCase())) {
            return res.status(400).json({ ok: false, error: 'This transaction has already been credited' });
        }

        // Verify on-chain
        const publicClient = monad.getPublicClient();
        const tx = await publicClient.getTransaction({ hash: txHash });

        if (!tx) return res.status(404).json({ ok: false, error: 'Transaction not found' });
        if (tx.to?.toLowerCase() !== COORDINATOR_ADDRESS.toLowerCase()) {
            return res.status(400).json({ ok: false, error: 'Transaction was not sent to the coordinator address' });
        }

        const receipt = await publicClient.getTransactionReceipt({ hash: txHash });
        if (receipt.status !== 'success') {
            return res.status(400).json({ ok: false, error: 'Transaction failed on-chain' });
        }

        const amountBNB = parseFloat(monad.formatEther(tx.value));
        if (amountBNB <= 0) {
            return res.status(400).json({ ok: false, error: 'Transaction has no tBNB value' });
        }

        // Credit user
        const currentCredits = await getCredits(userId);
        const newCredits = currentCredits + amountBNB;
        await setCredits(userId, newCredits);
        await addUsedTxHash(txHash.toLowerCase());

        res.json({
            ok: true,
            data: {
                userId,
                credited: `${amountBNB} tBNB`,
                totalCredits: `${newCredits} tBNB`,
                txHash,
            },
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/auto-setup - Generate wallet, faucet, deposit, credit user automatically
app.post('/api/auto-setup', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ ok: false, error: 'Missing userId' });

        const result = await autoSetupUser(userId);

        if (result.alreadySetup) {
            return res.json({
                ok: true,
                data: {
                    status: 'already_setup',
                    address: result.address,
                    credits: `${result.credits} tBNB`,
                },
            });
        }

        res.json({
            ok: true,
            data: {
                status: result.funded ? 'setup_complete' : 'setup_partial',
                address: result.address,
                credits: `${result.credits} tBNB`,
                funded: result.funded,
                depositTx: result.depositTx,
                error: result.error,
            },
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/admin/add-credits - Admin manually adds credits (for testing/promos)
app.post('/api/admin/add-credits', requireAdmin, async (req, res) => {
    try {
        const { userId, amount } = req.body;
        if (!userId || !amount) return res.status(400).json({ ok: false, error: 'Missing userId or amount' });
        const currentCredits = await getCredits(userId);
        const newCredits = currentCredits + parseFloat(amount);
        await setCredits(userId, newCredits);
        res.json({ ok: true, data: { userId, credited: `${amount} tBNB`, totalCredits: `${newCredits} tBNB` } });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ═══════════════════════════════════════
// TREASURY & BUYBACK (V5 MAINNET)
// ═══════════════════════════════════════

// GET /api/treasury — Show buyback treasury balance
app.get('/api/treasury', async (req, res) => {
    try {
        const treasuryAddress = process.env.BUYBACK_TREASURY;
        if (!treasuryAddress) return res.json({ ok: true, data: { balance: '0', address: null, enabled: false } });

        const client = monad.getPublicClient();
        const balance = await client.getBalance({ address: treasuryAddress });

        res.json({
            ok: true,
            data: {
                address: treasuryAddress,
                balance: monad.formatEther(balance),
                balanceWei: balance.toString(),
                enabled: true,
                guildToken: process.env.GUILD_TOKEN_ADDRESS || null,
            },
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/admin/buyback — Check treasury status for manual buyback
app.post('/api/admin/buyback', requireAdmin, async (req, res) => {
    try {
        const treasuryAddress = process.env.BUYBACK_TREASURY;
        if (!treasuryAddress) return res.status(400).json({ ok: false, error: 'BUYBACK_TREASURY not configured' });

        const client = monad.getPublicClient();
        const balance = await client.getBalance({ address: treasuryAddress });

        res.json({
            ok: true,
            data: {
                treasury: treasuryAddress,
                balance: monad.formatEther(balance),
                message: balance > 0n
                    ? `Treasury has ${monad.formatEther(balance)} tBNB ready for buyback.`
                    : 'Treasury is empty. Fees accumulate after mission completions.',
                guildToken: process.env.GUILD_TOKEN_ADDRESS || null,
            },
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ═══════════════════════════════════════
// SMART GUILD MATCHING
// ═══════════════════════════════════════

// POST /api/smart-create - Auto-match guild & create mission
// Requires either admin key OR userId with sufficient credits
app.post('/api/smart-create', async (req, res) => {
    try {
        const { task, budget, userId } = req.body;
        if (!task) return res.status(400).json({ ok: false, error: 'Missing task description' });

        const missionBudget = budget || '0.001';

        // Auth: admin key bypasses credits, otherwise check user credits
        const adminKey = req.headers['x-admin-key'];
        const isAdmin = adminKey && adminKey === ADMIN_API_KEY;

        if (!isAdmin) {
            if (!userId) return res.status(401).json({ ok: false, error: 'Missing X-Admin-Key or userId' });
            let credits = await getCredits(userId);

            // Auto-setup if no credits
            if (credits < parseFloat(missionBudget)) {
                const setup = await autoSetupUser(userId);
                credits = setup.credits || 0;
                if (credits < parseFloat(missionBudget)) {
                    return res.status(402).json({
                        ok: false,
                        error: `Insufficient credits. Auto-setup ${setup.funded ? 'succeeded but balance too low' : 'failed: ' + (setup.error || 'unknown')}. Send tBNB to ${COORDINATOR_ADDRESS} and verify with /api/verify-payment`,
                    });
                }
            }

            // Deduct credits
            await setCredits(userId, credits - parseFloat(missionBudget));
        }

        const guilds = await getEnrichedGuilds();
        const match = await matchGuildForTask(task, guilds);

        if (!match.guild) {
            return res.status(404).json({ ok: false, error: 'No guilds available for matching' });
        }

        const guildId = parseInt(match.guild.guildId);
        const taskHash = monad.hashTask(task);
        const budgetWei = monad.parseEther(missionBudget);
        const txResult = await monad.createMission(guildId, taskHash, budgetWei);
        const missionCount = Number(await monad.readContract('getMissionCount'));
        const missionId = missionCount - 1;

        await saveMissionTask(missionId, task);
        broadcast('mission_created', { missionId, guildId, task, budget: missionBudget });
        res.json({
            ok: true,
            data: {
                missionId,
                guildId,
                guildName: match.guild.name,
                matchedCategory: match.category,
                matchTier: match.tier,
                matchConfidence: match.confidence,
                task,
                taskHash,
                budget: `${missionBudget} tBNB`,
                userId: userId || 'admin',
                ...txResult,
            },
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/smart-pipeline - Auto-match guild & create pipeline
app.post('/api/smart-pipeline', requireAdmin, async (req, res) => {
    try {
        const { task, budget, steps } = req.body;
        if (!task) return res.status(400).json({ ok: false, error: 'Missing task description' });
        if (!budget) return res.status(400).json({ ok: false, error: 'Missing budget' });
        if (!steps || !Array.isArray(steps) || steps.length < 2) {
            return res.status(400).json({ ok: false, error: 'Need at least 2 steps' });
        }

        const guilds = await getEnrichedGuilds();
        const match = await matchGuildForTask(task, guilds);

        if (!match.guild) {
            return res.status(404).json({ ok: false, error: 'No guilds available for matching' });
        }

        const gid = parseInt(match.guild.guildId);
        const counter = await incPipelineCounter();
        const pipelineId = `pipeline-${counter}`;
        const budgetWei = monad.parseEther(budget);
        const taskHash = monad.hashTask(task);

        const txResult = await monad.createMission(gid, taskHash, budgetWei);
        const missionCount = Number(await monad.readContract('getMissionCount'));
        const missionId = missionCount - 1;

        const pipelines = await getPipelines();
        pipelines[pipelineId] = {
            id: pipelineId,
            missionId,
            guildId: gid,
            task,
            budget,
            steps: steps.map((s, i) => ({
                step: i + 1,
                role: s.role || `Step ${i + 1}`,
                status: i === 0 ? 'awaiting_claim' : 'pending',
                agent: null,
                result: null,
            })),
            currentStep: 1,
            totalSteps: steps.length,
            status: 'active',
            contributors: [],
            createdAt: new Date().toISOString(),
        };
        await savePipelines(pipelines);
        await saveMissionTask(missionId, task);

        broadcast('pipeline_created', { pipelineId, missionId, guildId: gid, task, totalSteps: steps.length, budget });
        res.json({
            ok: true,
            data: {
                pipelineId,
                missionId,
                guildId: gid,
                guildName: match.guild.name,
                matchedCategory: match.category,
                matchTier: match.tier,
                matchConfidence: match.confidence,
                totalSteps: steps.length,
                currentStep: 1,
                currentRole: steps[0].role,
                budget: `${budget} tBNB`,
                ...txResult,
            },
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ═══════════════════════════════════════
// GET ENDPOINTS (public)
// ═══════════════════════════════════════

// GET /api/pipeline/:id - Pipeline status
app.get('/api/pipeline/:id', async (req, res) => {
    try {
        const pipelines = await getPipelines();
        const pipeline = pipelines[req.params.id];
        if (!pipeline) return res.status(404).json({ ok: false, error: 'Pipeline not found' });
        res.json({ ok: true, data: pipeline });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/pipelines - All pipelines
app.get('/api/pipelines', async (req, res) => {
    try {
        const pipelines = await getPipelines();
        const list = Object.values(pipelines).map(p => ({
            id: p.id,
            task: p.task,
            status: p.status,
            guildId: p.guildId,
            missionId: p.missionId,
            currentStep: p.currentStep,
            totalSteps: p.totalSteps,
            createdAt: p.createdAt,
        }));
        res.json({ ok: true, data: { count: list.length, pipelines: list } });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/missions/next?guildId=X - Missions awaiting next pipeline step
// Agents poll this to find work within their guild that needs continuation
app.get('/api/missions/next', async (req, res) => {
    try {
        const { guildId } = req.query;
        const pipelines = await getPipelines();

        const awaiting = [];
        for (const pipeline of Object.values(pipelines)) {
            if (pipeline.status !== 'active') continue;
            if (guildId !== undefined && pipeline.guildId !== parseInt(guildId)) continue;

            const stepIdx = pipeline.currentStep - 1;
            const step = pipeline.steps[stepIdx];
            if (step && step.status === 'awaiting_claim') {
                awaiting.push({
                    pipelineId: pipeline.id,
                    missionId: pipeline.missionId,
                    guildId: pipeline.guildId,
                    task: pipeline.task,
                    step: step.step,
                    totalSteps: pipeline.totalSteps,
                    role: step.role,
                    previousResult: step.previousResult || null,
                    budget: pipeline.budget,
                });
            }
        }

        res.json({ ok: true, data: { count: awaiting.length, missions: awaiting } });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/mission-context/:missionId - Get pipeline context for a mission
app.get('/api/mission-context/:missionId', async (req, res) => {
    try {
        const missionId = parseInt(req.params.missionId);
        const pipelines = await getPipelines();

        for (const pipeline of Object.values(pipelines)) {
            if (pipeline.missionId !== missionId) continue;
            if (pipeline.status !== 'active') continue;

            const stepIdx = pipeline.currentStep - 1;
            const step = pipeline.steps[stepIdx];
            return res.json({
                ok: true,
                data: {
                    pipelineId: pipeline.id,
                    task: pipeline.task,
                    step: step.step,
                    totalSteps: pipeline.totalSteps,
                    role: step.role,
                    previousResult: step.previousResult || null,
                    previousSteps: pipeline.contributors,
                },
            });
        }

        // Not a pipeline — check for stored standalone task description
        const tasks = await getMissionTasks();
        const taskText = tasks[String(missionId)];
        if (taskText) {
            return res.json({ ok: true, data: { task: taskText } });
        }

        res.json({ ok: true, data: null }); // No context available
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/status
app.get('/api/status', async (req, res) => {
    try {
        const stats = await monad.getStatus();
        const heartbeats = await getHeartbeats();
        const onlineCount = Object.values(heartbeats)
            .filter(h => Date.now() - h.lastSeen < 15 * 60 * 1000).length;

        res.json({ ok: true, data: { ...stats, onlineAgents: onlineCount } });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/mission/:id/result - Get completed mission result
app.get('/api/mission/:id/result', async (req, res) => {
    try {
        const mid = req.params.id;
        let stored = null;
        if (redis) {
            const raw = await redis.get(`result:${mid}`);
            if (raw) stored = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } else {
            const results = loadJSONFile('results.json');
            stored = results[mid] || null;
        }
        if (!stored) {
            return res.status(404).json({ ok: false, error: 'Result not found. Mission may still be in progress.' });
        }
        res.json({ ok: true, data: stored });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/mission/:id/rate - Rate a completed mission (1-5 stars)
app.post('/api/mission/:id/rate', async (req, res) => {
    try {
        const mid = req.params.id;
        const { rating, userId, feedback } = req.body;

        if (!rating || !userId) {
            return res.status(400).json({ ok: false, error: 'rating (1-5) and userId required' });
        }

        const stars = parseInt(rating);
        if (stars < 1 || stars > 5) {
            return res.status(400).json({ ok: false, error: 'rating must be 1-5' });
        }

        const ratingData = { missionId: mid, userId, rating: stars, feedback: feedback || null, ratedAt: new Date().toISOString() };

        if (redis) {
            await redis.set(`rating:${mid}`, JSON.stringify(ratingData));
            // Track per-user ratings list
            const userRatings = JSON.parse(await redis.get(`user_ratings:${userId}`) || '[]');
            userRatings.push({ missionId: mid, rating: stars });
            await redis.set(`user_ratings:${userId}`, JSON.stringify(userRatings));
        } else {
            const ratings = loadJSONFile('ratings.json');
            ratings[mid] = ratingData;
            saveJSONFile('ratings.json', ratings);
        }

        broadcast('mission_rated', ratingData);
        res.json({ ok: true, data: ratingData });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/mission/:id/rating - Get rating for a mission
app.get('/api/mission/:id/rating', async (req, res) => {
    try {
        const mid = req.params.id;
        let stored = null;
        if (redis) {
            const raw = await redis.get(`rating:${mid}`);
            if (raw) stored = typeof raw === 'string' ? JSON.parse(raw) : raw;
        } else {
            const ratings = loadJSONFile('ratings.json');
            stored = ratings[mid] || null;
        }
        if (!stored) {
            return res.status(404).json({ ok: false, error: 'No rating found for this mission' });
        }
        res.json({ ok: true, data: stored });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/missions/open
app.get('/api/missions/open', async (req, res) => {
    try {
        const { guildId } = req.query;
        let missions;
        if (guildId) {
            missions = await monad.getMissionsByGuild(parseInt(guildId));
        } else {
            // Use Goldsky with v5 schema
            try {
                const data = await monad.queryGoldsky(`{
                    missionCreateds(first: 50, orderBy: timestamp_, orderDirection: desc) {
                        id missionId guildId client taskHash budget timestamp_
                    }
                    missionCompleteds { missionId }
                }`);
                const completedIds = new Set(data.missionCompleteds.map(m => m.missionId));
                missions = data.missionCreateds.filter(m => !completedIds.has(m.missionId));
            } catch {
                // Fallback to RPC
                const count = Number(await monad.readContract('getMissionCount'));
                missions = [];
                for (let i = 0; i < count; i++) {
                    const m = await monad.readContract('getMission', [BigInt(i)]);
                    if (!m.completed) {
                        const claimer = await monad.getMissionClaim(i);
                        missions.push({
                            missionId: String(i),
                            guildId: m.guildId.toString(),
                            client: m.client,
                            budget: m.budget.toString(),
                            claimed: claimer !== '0x0000000000000000000000000000000000000000',
                            claimer: claimer !== '0x0000000000000000000000000000000000000000' ? claimer : null,
                        });
                    }
                }
            }
        }
        res.json({ ok: true, data: { count: missions.length, missions } });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/agents/online
app.get('/api/agents/online', async (req, res) => {
    try {
        const heartbeats = await getHeartbeats();
        const now = Date.now();
        const online = Object.entries(heartbeats)
            .filter(([, h]) => now - h.lastSeen < 15 * 60 * 1000)
            .map(([addr, h]) => ({
                address: addr,
                lastSeen: h.timestamp,
                minutesAgo: Math.round((now - h.lastSeen) / 60000),
            }));
        res.json({ ok: true, data: { count: online.length, agents: online } });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// Shared helper: fetch guilds + enrich with memberCount
async function getEnrichedGuilds(category) {
    let guilds;
    if (category) {
        guilds = await monad.getGuildsByCategory(category);
    } else {
        guilds = await monad.getGuildLeaderboard();
    }

    // Batch member count lookups (10 at a time to avoid RPC overload)
    const enriched = [];
    const BATCH = 10;
    for (let i = 0; i < guilds.length; i += BATCH) {
        const batch = guilds.slice(i, i + BATCH);
        const results = await Promise.all(batch.map(async (g) => {
            let memberCount = 0;
            try {
                const members = await monad.getGuildAgents(parseInt(g.guildId));
                memberCount = members.length;
            } catch {}
            return {
                guildId: g.guildId,
                name: g.name,
                category: g.category,
                avgRating: g.avgRating,
                totalMissions: g.totalMissions,
                memberCount,
            };
        }));
        enriched.push(...results);
    }
    return enriched;
}

// GET /api/guilds
app.get('/api/guilds', async (req, res) => {
    try {
        const enriched = await getEnrichedGuilds(req.query.category);
        // Attach plot assignments
        const allPlots = worldState.getAllAssignments();
        const guildsWithPlots = enriched.map(g => ({
            ...g,
            assignedPlot: worldState.getGuildPrimaryPlot(parseInt(g.guildId)) || null,
        }));
        res.json({ ok: true, data: { count: guildsWithPlots.length, guilds: guildsWithPlots } });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/guilds/:id/agents - v4 on-chain guild members
app.get('/api/guilds/:id/agents', async (req, res) => {
    try {
        const agents = await monad.getGuildAgents(parseInt(req.params.id));
        res.json({ ok: true, data: { guildId: req.params.id, count: agents.length, agents } });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/guilds/:id/missions - All missions for a guild with completion status
app.get('/api/guilds/:id/missions', async (req, res) => {
    try {
        const guildId = parseInt(req.params.id);
        const missions = await monad.getMissionsByGuild(guildId);

        // Enrich with completion + rating data from Goldsky
        let completedIds = new Set();
        let ratedMap = {};
        try {
            const data = await monad.queryGoldsky(`{
                missionCompleteds(first: 1000) { missionId }
                missionRateds(first: 1000) { missionId score }
            }`);
            completedIds = new Set(data.missionCompleteds.map(m => m.missionId));
            for (const r of data.missionRateds) {
                ratedMap[r.missionId] = Number(r.score);
            }
        } catch {}

        const enriched = missions.map(m => ({
            ...m,
            completed: completedIds.has(m.missionId),
            rated: m.missionId in ratedMap,
            rating: ratedMap[m.missionId] || null,
        }));

        res.json({ ok: true, data: { count: enriched.length, missions: enriched } });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/balance/:address - v4 user deposit balance
app.get('/api/balance/:address', async (req, res) => {
    try {
        const balance = await monad.getUserBalance(req.params.address);
        res.json({ ok: true, data: { address: req.params.address, balance: `${balance} tBNB` } });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ═══════════════════════════════════════
// WORLD GOVERNANCE ENDPOINTS
// ═══════════════════════════════════════

// GET /api/world/plots - Available plots in a district, scored by desirability
app.get('/api/world/plots', (req, res) => {
    try {
        const { district, tier } = req.query;
        if (!district) return res.status(400).json({ ok: false, error: 'Missing district query parameter' });
        const plots = worldState.getAvailablePlots(district, tier || 'bronze');
        res.json({ ok: true, data: { count: plots.length, district, plots: plots.slice(0, 50) } });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/world/districts - District stats
app.get('/api/world/districts', (req, res) => {
    try {
        const stats = worldState.getDistrictStats();
        res.json({ ok: true, data: stats });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/world/plots/:plotId/assign - Assign a plot to a guild
app.post('/api/world/plots/:plotId/assign', async (req, res) => {
    try {
        const { plotId } = req.params;
        const { guildId, tier } = req.body;
        if (guildId === undefined || !tier) {
            return res.status(400).json({ ok: false, error: 'Missing guildId or tier' });
        }
        const result = worldState.assignPlot(plotId, parseInt(guildId), tier);
        if (!result.ok) {
            return res.status(409).json(result);
        }
        await worldState.savePlotAssignments();
        broadcast('plot_assigned', {
            guildId: parseInt(guildId),
            plotId,
            col: result.assignment.col,
            row: result.assignment.row,
            tier,
            district: result.assignment.district,
            timestamp: Date.now(),
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/world/plots/:plotId/release - Release a plot
app.post('/api/world/plots/:plotId/release', async (req, res) => {
    try {
        const { plotId } = req.params;
        const { guildId } = req.body;
        if (guildId === undefined) {
            return res.status(400).json({ ok: false, error: 'Missing guildId' });
        }
        const result = worldState.releasePlot(plotId, parseInt(guildId));
        if (!result.ok) {
            return res.status(409).json(result);
        }
        await worldState.savePlotAssignments();
        const [col, row] = plotId.split(',').map(Number);
        broadcast('plot_released', {
            guildId: parseInt(guildId),
            plotId,
            col,
            row,
            timestamp: Date.now(),
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /api/world/districts/:id/suggested-plots - Top scored plots for tier
app.get('/api/world/districts/:id/suggested-plots', (req, res) => {
    try {
        const district = req.params.id;
        const tier = req.query.tier || 'bronze';
        const plots = worldState.getAvailablePlots(district, tier);
        res.json({ ok: true, data: { district, tier, suggestions: plots.slice(0, 5) } });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /api/world/auto-assign - Batch assign plots to all unassigned guilds
app.post('/api/world/auto-assign', async (req, res) => {
    try {
        const CAT_TO_DISTRICT = {
            meme: 'creative', 'content-creation': 'creative', writing: 'creative',
            art: 'creative', design: 'creative',
            math: 'research', science: 'research', analytics: 'research',
            trading: 'defi', finance: 'defi',
            dev: 'code', engineering: 'code',
            language: 'translation',
            test: 'townsquare', general: 'townsquare',
        };
        function mapDistrict(cat) { return CAT_TO_DISTRICT[cat] || cat; }
        function tierForGuild(g) {
            const m = g.totalMissions || 0, r = parseFloat(g.avgRating) || 0;
            if (m >= 200 && r >= 4.5) return 'diamond';
            if (m >= 50 && r >= 4.0) return 'gold';
            if (m >= 10 && r >= 3.5) return 'silver';
            return 'bronze';
        }

        const releaseFirst = req.body?.releaseAll === true;
        const guilds = await monad.getGuildLeaderboard();

        // Release all if requested
        let released = 0;
        if (releaseFirst) {
            const allAssignments = worldState.getAllAssignments();
            for (const [gId, plots] of Object.entries(allAssignments)) {
                for (const plot of plots) {
                    worldState.releasePlot(plot.plotId, Number(gId));
                    released++;
                }
            }
        }

        // Find unassigned guilds
        const assignedGuilds = new Set();
        for (const [gId, plots] of Object.entries(worldState.getAllAssignments())) {
            if (plots.length > 0) assignedGuilds.add(Number(gId));
        }

        let assigned = 0, failed = 0;
        const results = [];

        for (const g of guilds) {
            const guildId = Number(g.guildId);
            if (assignedGuilds.has(guildId)) continue;

            const district = mapDistrict(g.category);
            const tier = tierForGuild(g);
            let plots = worldState.getAvailablePlots(district, tier);
            if (plots.length === 0) plots = worldState.getAvailablePlots('townsquare', tier);
            if (plots.length === 0) { failed++; results.push({ guildId, error: 'no plots' }); continue; }

            const plot = plots[0];
            const result = worldState.assignPlot(plot.plotId, guildId, tier);
            if (result.ok) {
                assigned++;
                broadcast('plot_assigned', { guildId, plotId: plot.plotId, col: plot.col, row: plot.row, tier, district, timestamp: Date.now() });
                results.push({ guildId, plotId: plot.plotId, district });
            } else {
                failed++;
                results.push({ guildId, error: result.error });
            }
        }

        await worldState.savePlotAssignments();
        res.json({ ok: true, data: { released, assigned, failed, results } });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ═══════════════════════════════════════
// SSE ENDPOINT
// ═══════════════════════════════════════

// GET /api/events - Server-Sent Events stream
// Clients connect and receive real-time updates for all platform activity.
// Optional query params: ?guildId=0 to filter events for a specific guild.
app.get('/api/events', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Alt-Svc': 'clear',          // Prevent QUIC — SSE needs stable HTTP/1.1 or h2
        'X-Accel-Buffering': 'no',   // Disable proxy buffering (Nginx/Render)
    });

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ message: 'Connected to AgentGuilds BNB event stream', timestamp: new Date().toISOString() })}\n\n`);

    sseClients.add(res);
    console.log(`SSE client connected (${sseClients.size} total)`);

    // Keepalive every 15s — prevents QUIC_TOO_MANY_RTOS on HTTP/3 connections
    const keepalive = setInterval(() => {
        res.write(': keepalive\n\n');
    }, 15000);

    req.on('close', () => {
        clearInterval(keepalive);
        sseClients.delete(res);
        console.log(`SSE client disconnected (${sseClients.size} total)`);
    });
});

// ═══════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════

app.listen(PORT, '0.0.0.0', async () => {
    ensureDataDir();
    // Initialize world governance (pass Redis adapter if available)
    try {
        if (redis) {
            worldState.setPersistence(redis);
        }
        await worldState.init();
        console.log('World governance initialized');
    } catch (err) {
        console.warn('World governance init failed (run export-district-map.js first):', err.message);
    }
    console.log(`AgentGuilds BNB API running on port ${PORT}`);
    console.log(`Contract: ${monad.GUILD_REGISTRY_ADDRESS}`);
    console.log(`Endpoints:`);
    console.log(`  POST /api/heartbeat, /api/join-guild, /api/leave-guild`);
    console.log(`  POST /api/claim-mission, /api/submit-result, /api/deposit`);
    console.log(`  GET  /api/status, /api/missions/open, /api/agents/online`);
    console.log(`  GET  /api/guilds, /api/guilds/:id/agents, /api/balance/:addr`);
    console.log(`  GET  /api/events (SSE stream)`);
    console.log(`  POST /api/smart-create, /api/smart-pipeline (auto guild matching)`);
    console.log(`  POST /api/admin/* (admin key: ${ADMIN_API_KEY ? 'configured' : 'NOT SET'})`);
});
