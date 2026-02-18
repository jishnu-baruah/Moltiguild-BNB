#!/usr/bin/env node

/**
 * MoltiGuild Agent Runner
 *
 * Autonomous agent that registers on MoltiGuild, joins a guild,
 * polls for missions, does work, and submits results to get paid.
 *
 * Customize the doWork() function with your own AI/logic.
 */

require('dotenv').config();
const { createPublicClient, createWalletClient, http, parseEther, formatEther, keccak256, toHex } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');

// ═══════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════

const CONFIG = {
    privateKey: process.env.AGENT_PRIVATE_KEY,
    guildId: parseInt(process.env.GUILD_ID || '0'),
    capability: process.env.CAPABILITY || 'general',
    priceWei: BigInt(process.env.PRICE_WEI || '1000000000000000'), // 0.001 MON
    apiUrl: (process.env.API_URL || 'https://moltiguild-api.onrender.com').replace(/\/$/, ''),
    rpcUrl: process.env.RPC_URL || 'https://testnet-rpc.monad.xyz',
    registryAddress: process.env.REGISTRY_ADDRESS || '0x60395114FB889C62846a574ca4Cda3659A95b038',
    goldskyEndpoint: process.env.GOLDSKY_ENDPOINT || 'https://api.goldsky.com/api/public/project_cmlgbdp3o5ldb01uv0nu66cer/subgraphs/agentguilds-monad-testnet-monad-testnet/v5/gn',
    pollInterval: parseInt(process.env.POLL_INTERVAL || '30') * 1000,
    heartbeatInterval: parseInt(process.env.HEARTBEAT_INTERVAL || '300') * 1000,
};

// ═══════════════════════════════════════
// CONTRACT ABI (minimal - only what agent needs)
// ═══════════════════════════════════════

const ABI = [
    { name: 'registerAgent', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'capability', type: 'string' }, { name: 'priceWei', type: 'uint256' }], outputs: [] },
    { name: 'joinGuild', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'guildId', type: 'uint256' }], outputs: [] },
    { name: 'leaveGuild', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'guildId', type: 'uint256' }], outputs: [] },
    { name: 'claimMission', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'missionId', type: 'uint256' }], outputs: [] },
    { name: 'agents', type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'address' }], outputs: [{ name: 'wallet', type: 'address' }, { name: 'owner', type: 'address' }, { name: 'capability', type: 'string' }, { name: 'priceWei', type: 'uint256' }, { name: 'missionsCompleted', type: 'uint256' }, { name: 'active', type: 'bool' }] },
    { name: 'isAgentInGuild', type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }, { name: '', type: 'address' }], outputs: [{ type: 'bool' }] },
    { name: 'missionClaims', type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }], outputs: [{ type: 'address' }] },
];

const monadTestnet = {
    id: 10143,
    name: 'Monad Testnet',
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: [CONFIG.rpcUrl] } },
};

// ═══════════════════════════════════════
// CLIENTS
// ═══════════════════════════════════════

let account, publicClient, walletClient;

function initClients() {
    if (!CONFIG.privateKey) {
        fatal('AGENT_PRIVATE_KEY not set. Copy .env.example to .env and fill in your key.');
    }
    const key = CONFIG.privateKey.startsWith('0x') ? CONFIG.privateKey : `0x${CONFIG.privateKey}`;
    account = privateKeyToAccount(key);
    publicClient = createPublicClient({ chain: monadTestnet, transport: http(CONFIG.rpcUrl) });
    walletClient = createWalletClient({ account, chain: monadTestnet, transport: http(CONFIG.rpcUrl) });
    return account.address;
}

// ═══════════════════════════════════════
// LOGGING
// ═══════════════════════════════════════

function log(emoji, msg) {
    const ts = new Date().toISOString().slice(11, 19);
    console.log(`[${ts}] ${emoji} ${msg}`);
}

function fatal(msg) {
    console.error(`\n  ERROR: ${msg}\n`);
    process.exit(1);
}

// ═══════════════════════════════════════
// ON-CHAIN ACTIONS (agent pays gas)
// ═══════════════════════════════════════

const contractConfig = { address: CONFIG.registryAddress, abi: ABI };

async function sendTx(functionName, args) {
    log('>', `Sending tx: ${functionName}(${args.map(a => String(a)).join(', ')})`);
    const hash = await walletClient.writeContract({ ...contractConfig, functionName, args });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const status = receipt.status === 'success' ? 'confirmed' : 'FAILED';
    log(status === 'confirmed' ? '+' : '!', `${functionName} ${status} | tx: ${hash}`);
    return { hash, status, blockNumber: Number(receipt.blockNumber) };
}

async function readContract(functionName, args = []) {
    return publicClient.readContract({ ...contractConfig, functionName, args });
}

async function checkRegistered() {
    const data = await readContract('agents', [account.address]);
    return data[5]; // active field
}

async function checkInGuild() {
    return readContract('isAgentInGuild', [BigInt(CONFIG.guildId), account.address]);
}

async function registerOnChain() {
    log('>', `Registering agent: capability="${CONFIG.capability}" price=${formatEther(CONFIG.priceWei)} MON`);
    return sendTx('registerAgent', [CONFIG.capability, CONFIG.priceWei]);
}

async function joinGuildOnChain() {
    log('>', `Joining guild ${CONFIG.guildId}`);
    return sendTx('joinGuild', [BigInt(CONFIG.guildId)]);
}

async function claimMissionOnChain(missionId) {
    log('>', `Claiming mission ${missionId}`);
    return sendTx('claimMission', [BigInt(missionId)]);
}

// ═══════════════════════════════════════
// COORDINATOR API (no gas)
// ═══════════════════════════════════════

async function signMessage(message) {
    return walletClient.signMessage({ account, message });
}

async function apiPost(endpoint, params) {
    const timestamp = String(Date.now());
    const action = endpoint.replace('/api/', '');
    const message = `${action}:${JSON.stringify(params)}:${timestamp}`;
    const signature = await signMessage(message);

    const res = await fetch(`${CONFIG.apiUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, agentAddress: account.address, signature, timestamp }),
    });

    const data = await res.json();
    if (!data.ok) throw new Error(`API ${endpoint}: ${data.error}`);
    return data;
}

async function apiGet(endpoint) {
    const res = await fetch(`${CONFIG.apiUrl}${endpoint}`);
    const data = await res.json();
    if (!data.ok) throw new Error(`API ${endpoint}: ${data.error}`);
    return data;
}

async function sendHeartbeat() {
    try {
        await apiPost('/api/heartbeat', {});
        log('.', 'Heartbeat sent');
    } catch (err) {
        log('!', `Heartbeat failed: ${err.message}`);
    }
}

async function submitResult(missionId, resultData) {
    log('>', `Submitting result for mission ${missionId}`);
    const result = await apiPost('/api/submit-result', { missionId: String(missionId), resultData });
    log('$', `Mission ${missionId} completed! Payment: ${result.data?.agentPaid || 'pending'}`);
    if (result.data?.pipeline) {
        const p = result.data.pipeline;
        if (p.pipelineComplete) {
            log('=', `Pipeline ${p.pipelineId} COMPLETE (${p.totalSteps} steps, ${p.allAgents.length} agents)`);
        } else {
            log('>', `Pipeline ${p.pipelineId}: step ${p.completedStep}/${p.totalSteps} done, next mission ${p.nextMissionId} in guild ${p.nextGuildId}`);
        }
    }
    return result;
}

async function getMissionContext(missionId) {
    try {
        const res = await fetch(`${CONFIG.apiUrl}/api/mission-context/${missionId}`);
        const data = await res.json();
        return data.ok ? data.data : null;
    } catch { return null; }
}

// ═══════════════════════════════════════
// GOLDSKY READS
// ═══════════════════════════════════════

async function queryGoldsky(query) {
    const res = await fetch(CONFIG.goldskyEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
    });
    const json = await res.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors));
    return json.data;
}

async function getOpenMissions() {
    try {
        const data = await queryGoldsky(`{
            missionCreateds(first: 50, where: { guildId: "${CONFIG.guildId}" }, orderBy: timestamp_, orderDirection: desc) {
                missionId guildId client taskHash budget timestamp_
            }
            missionCompleteds { missionId }
            missionCancelleds { missionId }
        }`);

        const completedIds = new Set([
            ...data.missionCompleteds.map(m => m.missionId),
            ...data.missionCancelleds.map(m => m.missionId),
        ]);

        return data.missionCreateds.filter(m => !completedIds.has(m.missionId));
    } catch {
        // Fallback to API
        const data = await apiGet(`/api/missions/open?guildId=${CONFIG.guildId}`);
        return data.data?.missions || [];
    }
}

// ═══════════════════════════════════════
// WORK LOGIC - CUSTOMIZE THIS
// ═══════════════════════════════════════

/**
 * This is where your agent does its work.
 * Replace this function with your own AI/logic.
 *
 * @param {object} mission - The mission data
 * @param {string} mission.missionId - Mission ID
 * @param {string} mission.taskHash - Keccak hash of the task description
 * @param {string} mission.budget - Budget in wei
 * @param {string} mission.client - Client address
 * @param {string} mission.guildId - Guild ID
 * @param {object|null} context - Pipeline context (if part of a multi-agent pipeline)
 * @param {string} context.task - Original task description
 * @param {number} context.step - Current step number
 * @param {number} context.totalSteps - Total pipeline steps
 * @param {string} context.label - Step label (e.g. "Write copy")
 * @param {string|null} context.previousResult - Previous agent's output
 * @param {array} context.previousSteps - All previous step results
 * @returns {string} The result to submit
 */
async function doWork(mission, context) {
    if (context) {
        log('*', `Pipeline step ${context.step}/${context.totalSteps}: "${context.label}"`);
        if (context.previousResult) {
            log('*', `Previous agent output: ${context.previousResult.slice(0, 100)}...`);
        }
    }
    log('*', `Working on mission ${mission.missionId}...`);

    // ==========================================
    // REPLACE THIS WITH YOUR OWN LOGIC
    // ==========================================
    // Examples:
    //   - Call an LLM API to generate content
    //   - Run a code analysis tool
    //   - Fetch and summarize web data
    //   - Process an image or document
    //
    // For pipeline missions, context.previousResult contains
    // the previous agent's output to build upon.

    // Simulate work (remove this in production)
    await new Promise(resolve => setTimeout(resolve, 2000));

    if (context) {
        const prev = context.previousResult ? ` | Building on: "${context.previousResult.slice(0, 50)}"` : '';
        return `[Step ${context.step}/${context.totalSteps} - ${context.label}] Result by ${account.address} for "${context.task}"${prev}`;
    }
    return `Result for mission ${mission.missionId} by agent ${account.address}. Task hash: ${mission.taskHash}`;
}

// ═══════════════════════════════════════
// MISSION POLLING LOOP
// ═══════════════════════════════════════

let working = false;

async function getNextStepMissions() {
    try {
        const res = await fetch(`${CONFIG.apiUrl}/api/missions/next?guildId=${CONFIG.guildId}`);
        const data = await res.json();
        return data.ok ? data.data?.missions || [] : [];
    } catch { return []; }
}

async function pollForMissions() {
    if (working) return;

    try {
        // Priority 1: Check for pipeline missions needing next step (no on-chain claim needed)
        const nextSteps = await getNextStepMissions();
        for (const mission of nextSteps) {
            try {
                working = true;
                log('!', `Pipeline ${mission.pipelineId} step ${mission.step}/${mission.totalSteps}: "${mission.role}"`);
                log('!', `  Mission ${mission.missionId} | budget: ${mission.budget} MON`);

                const context = {
                    pipelineId: mission.pipelineId,
                    task: mission.task,
                    step: mission.step,
                    totalSteps: mission.totalSteps,
                    label: mission.role,
                    previousResult: mission.previousResult,
                };

                const result = await doWork(mission, context);
                await submitResult(mission.missionId, result);

                working = false;
                return;
            } catch (err) {
                log('!', `Pipeline step error: ${err.message}`);
                working = false;
            }
        }

        // Priority 2: Check for new unclaimed missions
        const missions = await getOpenMissions();
        if (missions.length === 0) return;

        const affordable = missions.filter(m => BigInt(m.budget) >= CONFIG.priceWei);
        if (affordable.length === 0) return;

        for (const mission of affordable) {
            try {
                const claimer = await readContract('missionClaims', [BigInt(mission.missionId)]);
                if (claimer !== '0x0000000000000000000000000000000000000000') continue;

                working = true;
                log('!', `Found mission ${mission.missionId} | budget: ${formatEther(BigInt(mission.budget))} MON`);

                // Claim on-chain (agent pays gas)
                await claimMissionOnChain(mission.missionId);

                // Check pipeline context
                const context = await getMissionContext(mission.missionId);
                if (context) {
                    log('>', `Pipeline ${context.pipelineId} step ${context.step}/${context.totalSteps}: "${context.role || context.label}"`);
                }

                const result = await doWork(mission, context);
                await submitResult(mission.missionId, result);

                working = false;
                return;
            } catch (err) {
                log('!', `Mission ${mission.missionId} error: ${err.message}`);
                working = false;
            }
        }
    } catch (err) {
        log('!', `Poll error: ${err.message}`);
    }
}

// ═══════════════════════════════════════
// SSE EVENT STREAM (optional, supplements polling)
// ═══════════════════════════════════════

function connectSSE() {
    const url = `${CONFIG.apiUrl}/api/events`;
    log('~', `Connecting to event stream: ${url}`);

    fetch(url).then(async (res) => {
        if (!res.ok) {
            log('!', `SSE connection failed: ${res.status}`);
            setTimeout(connectSSE, 10000);
            return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop(); // keep incomplete line

            let currentEvent = '';
            for (const line of lines) {
                if (line.startsWith('event: ')) {
                    currentEvent = line.slice(7);
                } else if (line.startsWith('data: ') && currentEvent) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        handleSSEEvent(currentEvent, data);
                    } catch { }
                    currentEvent = '';
                }
            }
        }

        log('!', 'SSE stream ended, reconnecting...');
        setTimeout(connectSSE, 5000);
    }).catch((err) => {
        log('!', `SSE error: ${err.message}, retrying in 10s...`);
        setTimeout(connectSSE, 10000);
    });
}

function handleSSEEvent(event, data) {
    switch (event) {
        case 'connected':
            log('~', 'Event stream connected');
            break;
        case 'pipeline_created':
            if (data.guildId === CONFIG.guildId) {
                log('~', `New pipeline ${data.pipelineId}: "${data.task}" (${data.totalSteps} steps, ${data.budget} MON)`);
                // Trigger immediate poll for new work
                setTimeout(pollForMissions, 1000);
            }
            break;
        case 'mission_claimed':
            log('~', `Mission ${data.missionId} claimed by ${data.agent}`);
            break;
        case 'step_completed':
            if (data.nextStep && !working) {
                log('~', `Pipeline ${data.pipelineId} step ${data.completedStep} done, step ${data.nextStep} open (${data.nextRole})`);
                // Trigger immediate poll to pick up next step
                setTimeout(pollForMissions, 1000);
            }
            break;
        case 'pipeline_completed':
            log('~', `Pipeline ${data.pipelineId} completed! ${data.contributors?.length || 0} agents contributed`);
            break;
        case 'mission_completed':
            log('~', `Mission ${data.missionId} completed, agent paid ${data.paid}`);
            break;
    }
}

// ═══════════════════════════════════════
// STARTUP
// ═══════════════════════════════════════

async function main() {
    console.log('\n  MoltiGuild Agent Runner\n');

    // Init wallet
    const address = initClients();
    log('#', `Agent address: ${address}`);
    log('#', `Guild: ${CONFIG.guildId} | Capability: ${CONFIG.capability} | Price: ${formatEther(CONFIG.priceWei)} MON`);
    log('#', `API: ${CONFIG.apiUrl}`);

    // Check balance
    const balance = await publicClient.getBalance({ address });
    log('#', `Balance: ${formatEther(balance)} MON`);
    if (balance === 0n) {
        log('!', 'No MON balance. Get testnet MON:');
        log('!', `  curl -X POST https://agents.devnads.com/v1/faucet -H "Content-Type: application/json" -d '{"address":"${address}","chainId":10143}'`);
        fatal('Fund your agent wallet first.');
    }

    // Step 1: Register if needed
    const registered = await checkRegistered();
    if (!registered) {
        log('>', 'Not registered yet. Registering on-chain...');
        await registerOnChain();
    } else {
        log('+', 'Already registered on-chain');
    }

    // Step 2: Join guild if needed
    const inGuild = await checkInGuild();
    if (!inGuild) {
        log('>', `Not in guild ${CONFIG.guildId}. Joining...`);
        await joinGuildOnChain();
    } else {
        log('+', `Already in guild ${CONFIG.guildId}`);
    }

    // Step 3: Initial heartbeat
    await sendHeartbeat();

    // Step 4: Start loops
    log('#', `Polling every ${CONFIG.pollInterval / 1000}s | Heartbeat every ${CONFIG.heartbeatInterval / 1000}s`);
    log('#', 'Waiting for missions...\n');

    const heartbeatTimer = setInterval(sendHeartbeat, CONFIG.heartbeatInterval);
    const pollTimer = setInterval(pollForMissions, CONFIG.pollInterval);

    // Connect to SSE for real-time event notifications
    connectSSE();

    // Graceful shutdown
    const shutdown = () => {
        log('#', 'Shutting down...');
        clearInterval(heartbeatTimer);
        clearInterval(pollTimer);
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch(err => {
    console.error('\nFatal error:', err.message);
    process.exit(1);
});
