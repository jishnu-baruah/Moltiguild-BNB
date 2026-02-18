#!/usr/bin/env node

/**
 * MoltiGuild Blockchain Library
 *
 * Two layers:
 * - READS: Goldsky GraphQL subgraph (fast, no RPC load)
 * - WRITES: viem + Monad testnet RPC
 */

const { createPublicClient, createWalletClient, http, parseEther, formatEther, keccak256, toHex, encodePacked } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

// ═══════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════

const MONAD_RPC = process.env.MONAD_RPC || 'https://testnet-rpc.monad.xyz';
const CHAIN_ID = parseInt(process.env.CHAIN_ID || '10143');
const GUILD_REGISTRY_ADDRESS = process.env.GUILD_REGISTRY_ADDRESS || '0x60395114FB889C62846a574ca4Cda3659A95b038';
const COORDINATOR_PRIVATE_KEY = process.env.COORDINATOR_PRIVATE_KEY;
const GOLDSKY_ENDPOINT = process.env.GOLDSKY_ENDPOINT || 'https://api.goldsky.com/api/public/project_cmlgbdp3o5ldb01uv0nu66cer/subgraphs/agentguilds-monad-testnet-monad-testnet/v5/gn';
const EXPLORER_URL = process.env.EXPLORER_URL || 'https://testnet.socialscan.io/tx/';
const FAUCET_URL = process.env.FAUCET_URL || 'https://agents.devnads.com/v1/faucet';
const IS_MAINNET = CHAIN_ID !== 10143;

// Chain definition (dynamic based on env)
const monadChain = {
    id: CHAIN_ID,
    name: IS_MAINNET ? 'Monad' : 'Monad Testnet',
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: {
        default: { http: [MONAD_RPC] },
    },
    blockExplorers: {
        default: { name: 'Explorer', url: EXPLORER_URL.replace(/\/tx\/$/, '') },
    },
};

// ═══════════════════════════════════════
// CONTRACT ABI (from GuildRegistry.sol v3)
// ═══════════════════════════════════════

const GUILD_REGISTRY_ABI = [
    // Views
    { name: 'coordinator', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
    { name: 'guildCount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
    { name: 'totalFeesCollected', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
    { name: 'buybackTreasury', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
    { name: 'setBuybackTreasury', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: '_treasury', type: 'address' }], outputs: [] },
    { name: 'getMissionCount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
    { name: 'getAgentCount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
    { name: 'getAgentList', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address[]' }] },
    { name: 'missionTimeout', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
    { name: 'missionClaims', type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }], outputs: [{ type: 'address' }] },
    { name: 'userBalances', type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'uint256' }] },
    { name: 'isAgentInGuild', type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }, { name: '', type: 'address' }], outputs: [{ type: 'bool' }] },
    {
        name: 'getMission', type: 'function', stateMutability: 'view',
        inputs: [{ name: 'missionId', type: 'uint256' }],
        outputs: [{
            name: '', type: 'tuple',
            components: [
                { name: 'client', type: 'address' },
                { name: 'guildId', type: 'uint256' },
                { name: 'taskHash', type: 'bytes32' },
                { name: 'budget', type: 'uint256' },
                { name: 'createdAt', type: 'uint256' },
                { name: 'completedAt', type: 'uint256' },
                { name: 'completed', type: 'bool' },
                { name: 'rated', type: 'bool' },
                { name: 'rating', type: 'uint8' },
                { name: 'resultHashes', type: 'bytes32[]' },
            ],
        }],
    },
    {
        name: 'getGuild', type: 'function', stateMutability: 'view',
        inputs: [{ name: 'guildId', type: 'uint256' }],
        outputs: [{
            name: '', type: 'tuple',
            components: [
                { name: 'name', type: 'string' },
                { name: 'category', type: 'string' },
                { name: 'creator', type: 'address' },
                { name: 'totalMissions', type: 'uint256' },
                { name: 'totalRatingSum', type: 'uint256' },
                { name: 'ratingCount', type: 'uint256' },
                { name: 'acceptedMissions', type: 'uint256' },
                { name: 'disputedMissions', type: 'uint256' },
                { name: 'active', type: 'bool' },
            ],
        }],
    },
    {
        name: 'getGuildReputation', type: 'function', stateMutability: 'view',
        inputs: [{ name: 'guildId', type: 'uint256' }],
        outputs: [
            { name: 'avgRatingScaled', type: 'uint256' },
            { name: 'totalMissions', type: 'uint256' },
        ],
    },
    {
        name: 'agents', type: 'function', stateMutability: 'view',
        inputs: [{ name: '', type: 'address' }],
        outputs: [
            { name: 'wallet', type: 'address' },
            { name: 'owner', type: 'address' },
            { name: 'capability', type: 'string' },
            { name: 'priceWei', type: 'uint256' },
            { name: 'missionsCompleted', type: 'uint256' },
            { name: 'active', type: 'bool' },
        ],
    },
    {
        name: 'getGuildAgents', type: 'function', stateMutability: 'view',
        inputs: [{ name: 'guildId', type: 'uint256' }],
        outputs: [{ type: 'address[]' }],
    },
    {
        name: 'getAgentGuilds', type: 'function', stateMutability: 'view',
        inputs: [{ name: 'agent', type: 'address' }],
        outputs: [{ type: 'uint256[]' }],
    },
    // Writes
    {
        name: 'createGuild', type: 'function', stateMutability: 'nonpayable',
        inputs: [{ name: 'name', type: 'string' }, { name: 'category', type: 'string' }],
        outputs: [{ name: 'guildId', type: 'uint256' }],
    },
    {
        name: 'registerAgent', type: 'function', stateMutability: 'nonpayable',
        inputs: [{ name: 'capability', type: 'string' }, { name: 'priceWei', type: 'uint256' }],
        outputs: [],
    },
    {
        name: 'registerAgentWithWallet', type: 'function', stateMutability: 'nonpayable',
        inputs: [{ name: 'agentWallet', type: 'address' }, { name: 'capability', type: 'string' }, { name: 'priceWei', type: 'uint256' }],
        outputs: [],
    },
    {
        name: 'updateAgent', type: 'function', stateMutability: 'nonpayable',
        inputs: [{ name: 'agentWallet', type: 'address' }, { name: 'capability', type: 'string' }, { name: 'priceWei', type: 'uint256' }],
        outputs: [],
    },
    {
        name: 'joinGuild', type: 'function', stateMutability: 'nonpayable',
        inputs: [{ name: 'guildId', type: 'uint256' }],
        outputs: [],
    },
    {
        name: 'leaveGuild', type: 'function', stateMutability: 'nonpayable',
        inputs: [{ name: 'guildId', type: 'uint256' }],
        outputs: [],
    },
    {
        name: 'createMission', type: 'function', stateMutability: 'payable',
        inputs: [{ name: 'guildId', type: 'uint256' }, { name: 'taskHash', type: 'bytes32' }],
        outputs: [{ name: 'missionId', type: 'uint256' }],
    },
    {
        name: 'createMissionFromBalance', type: 'function', stateMutability: 'nonpayable',
        inputs: [{ name: 'guildId', type: 'uint256' }, { name: 'taskHash', type: 'bytes32' }, { name: 'budget', type: 'uint256' }],
        outputs: [],
    },
    {
        name: 'claimMission', type: 'function', stateMutability: 'nonpayable',
        inputs: [{ name: 'missionId', type: 'uint256' }],
        outputs: [],
    },
    {
        name: 'cancelMission', type: 'function', stateMutability: 'nonpayable',
        inputs: [{ name: 'missionId', type: 'uint256' }],
        outputs: [],
    },
    {
        name: 'completeMission', type: 'function', stateMutability: 'nonpayable',
        inputs: [
            { name: 'missionId', type: 'uint256' },
            { name: 'resultHashes', type: 'bytes32[]' },
            { name: 'recipients', type: 'address[]' },
            { name: 'splits', type: 'uint256[]' },
        ],
        outputs: [],
    },
    {
        name: 'rateMission', type: 'function', stateMutability: 'nonpayable',
        inputs: [{ name: 'missionId', type: 'uint256' }, { name: 'score', type: 'uint8' }],
        outputs: [],
    },
    {
        name: 'depositFunds', type: 'function', stateMutability: 'payable',
        inputs: [],
        outputs: [],
    },
    {
        name: 'withdrawFunds', type: 'function', stateMutability: 'nonpayable',
        inputs: [{ name: 'amount', type: 'uint256' }],
        outputs: [],
    },
    {
        name: 'withdrawFees', type: 'function', stateMutability: 'nonpayable',
        inputs: [{ name: 'to', type: 'address' }],
        outputs: [],
    },
    {
        name: 'transferCoordinator', type: 'function', stateMutability: 'nonpayable',
        inputs: [{ name: 'newCoordinator', type: 'address' }],
        outputs: [],
    },
    // Events
    { name: 'GuildCreated', type: 'event', inputs: [{ name: 'guildId', type: 'uint256', indexed: true }, { name: 'name', type: 'string' }, { name: 'category', type: 'string' }, { name: 'creator', type: 'address' }] },
    { name: 'AgentRegistered', type: 'event', inputs: [{ name: 'wallet', type: 'address', indexed: true }, { name: 'capability', type: 'string' }, { name: 'priceWei', type: 'uint256' }] },
    { name: 'MissionCreated', type: 'event', inputs: [{ name: 'missionId', type: 'uint256', indexed: true }, { name: 'client', type: 'address', indexed: true }, { name: 'guildId', type: 'uint256', indexed: true }, { name: 'taskHash', type: 'bytes32' }, { name: 'budget', type: 'uint256' }] },
    { name: 'MissionCompleted', type: 'event', inputs: [{ name: 'missionId', type: 'uint256', indexed: true }, { name: 'guildId', type: 'uint256', indexed: true }, { name: 'resultHashes', type: 'bytes32[]' }] },
    { name: 'MissionRated', type: 'event', inputs: [{ name: 'missionId', type: 'uint256', indexed: true }, { name: 'guildId', type: 'uint256', indexed: true }, { name: 'score', type: 'uint8' }] },
    { name: 'MissionDisputed', type: 'event', inputs: [{ name: 'missionId', type: 'uint256', indexed: true }, { name: 'guildId', type: 'uint256', indexed: true }] },
    { name: 'AgentJoinedGuild', type: 'event', inputs: [{ name: 'agent', type: 'address', indexed: true }, { name: 'guildId', type: 'uint256', indexed: true }] },
    { name: 'AgentLeftGuild', type: 'event', inputs: [{ name: 'agent', type: 'address', indexed: true }, { name: 'guildId', type: 'uint256', indexed: true }] },
    { name: 'MissionCancelled', type: 'event', inputs: [{ name: 'missionId', type: 'uint256', indexed: true }, { name: 'refundAmount', type: 'uint256' }] },
    { name: 'MissionClaimed', type: 'event', inputs: [{ name: 'missionId', type: 'uint256', indexed: true }, { name: 'agent', type: 'address', indexed: true }] },
    { name: 'FundsDeposited', type: 'event', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'amount', type: 'uint256' }] },
    { name: 'FundsWithdrawn', type: 'event', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'amount', type: 'uint256' }] },
    { name: 'CoordinatorTransferred', type: 'event', inputs: [{ name: 'oldCoord', type: 'address', indexed: true }, { name: 'newCoord', type: 'address', indexed: true }] },
    { name: 'FeesWithdrawn', type: 'event', inputs: [{ name: 'to', type: 'address', indexed: true }, { name: 'amount', type: 'uint256' }] },
];

// ═══════════════════════════════════════
// CLIENTS
// ═══════════════════════════════════════

let _publicClient = null;
let _walletClient = null;

function getPublicClient() {
    if (!_publicClient) {
        _publicClient = createPublicClient({
            chain: monadChain,
            transport: http(MONAD_RPC),
        });
    }
    return _publicClient;
}

function getWalletClient() {
    if (!_walletClient) {
        if (!COORDINATOR_PRIVATE_KEY) {
            throw new Error('COORDINATOR_PRIVATE_KEY not set in .env');
        }
        const key = COORDINATOR_PRIVATE_KEY.startsWith('0x') ? COORDINATOR_PRIVATE_KEY : `0x${COORDINATOR_PRIVATE_KEY}`;
        const account = privateKeyToAccount(key);
        _walletClient = createWalletClient({
            account,
            chain: monadChain,
            transport: http(MONAD_RPC),
        });
    }
    return _walletClient;
}

function getContractConfig() {
    return {
        address: GUILD_REGISTRY_ADDRESS,
        abi: GUILD_REGISTRY_ABI,
    };
}

// ═══════════════════════════════════════
// GOLDSKY READS
// ═══════════════════════════════════════

async function queryGoldsky(query, variables = {}) {
    const res = await fetch(GOLDSKY_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
        throw new Error(`Goldsky query failed: ${res.status} ${res.statusText}`);
    }

    const json = await res.json();
    if (json.errors) {
        throw new Error(`Goldsky error: ${JSON.stringify(json.errors)}`);
    }

    return json.data;
}

async function getStatus() {
    try {
        const data = await queryGoldsky(`{
            guildCreateds(first: 1000) { id }
            missionCreateds(first: 1000) { id }
            missionCompleteds(first: 1000) { id }
            agentRegistereds(first: 1000) { id }
        }`);

        return {
            guilds: data.guildCreateds.length,
            missionsCreated: data.missionCreateds.length,
            missionsCompleted: data.missionCompleteds.length,
            agents: data.agentRegistereds.length,
            source: 'goldsky',
        };
    } catch (e) {
        // Fallback to RPC
        const rpc = await getOnChainStatus();
        return {
            guilds: rpc.guildCount,
            missionsCreated: rpc.missionCount,
            missionsCompleted: rpc.totalMissionsCompleted,
            agents: rpc.agentCount,
            totalFeesCollected: rpc.totalFeesCollected,
            source: 'rpc',
        };
    }
}

async function getGuildInfo(guildId) {
    try {
        const data = await queryGoldsky(`
            query GetGuildDashboard($guildId: BigInt!) {
                guildCreateds(where: { guildId: $guildId }, first: 1) {
                    id guildId name category creator timestamp_ transactionHash_
                }
                missionCreateds(where: { guildId: $guildId }, first: 1000) {
                    id missionId client guildId taskHash budget timestamp_
                }
                missionCompleteds(where: { guildId: $guildId }, first: 1000) {
                    id missionId resultHashes timestamp_
                }
                missionRateds(where: { guildId: $guildId }, first: 1000) {
                    id missionId score timestamp_
                }
            }
        `, { guildId: String(guildId) });

        const guild = data.guildCreateds[0];
        if (!guild) return null;

        const ratings = data.missionRateds.map(r => parseInt(r.score));
        const avgRating = ratings.length > 0
            ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
            : 'N/A';

        return {
            ...guild,
            totalMissions: data.missionCreateds.length,
            completedMissions: data.missionCompleteds.length,
            totalRatings: ratings.length,
            avgRating,
            missions: data.missionCreateds,
            completions: data.missionCompleteds,
            ratings: data.missionRateds,
            source: 'goldsky',
        };
    } catch (e) {
        // Fallback to RPC - getGuild returns a struct
        const guild = await readContract('getGuild', [BigInt(guildId)]);
        const [avgRatingScaled] = await readContract('getGuildReputation', [BigInt(guildId)]);

        return {
            guildId: String(guildId),
            name: guild.name,
            category: guild.category,
            creator: guild.creator,
            active: guild.active,
            totalMissions: Number(guild.totalMissions),
            acceptedMissions: Number(guild.acceptedMissions),
            completedMissions: Number(guild.acceptedMissions),
            totalRatings: Number(guild.ratingCount),
            avgRating: guild.ratingCount > 0 ? (Number(avgRatingScaled) / 100).toFixed(1) : 'N/A',
            missions: [],
            completions: [],
            ratings: [],
            source: 'rpc',
        };
    }
}

async function getGuildsByCategory(category) {
    // Try Goldsky first, fall back to iterating RPC guilds
    try {
        const data = await queryGoldsky(`
            query GetGuildsByCategory($category: String!) {
                guildCreateds(where: { category: $category }, orderBy: timestamp_, orderDirection: desc, first: 1000) {
                    id guildId name category creator timestamp_
                }
            }
        `, { category });

        const enriched = [];
        for (const guild of data.guildCreateds) {
            const info = await getGuildInfo(guild.guildId);
            enriched.push(info);
        }
        return enriched;
    } catch (e) {
        // Fallback: iterate all guilds via RPC, filter by category
        const guildCount = Number(await readContract('guildCount'));
        const results = [];
        for (let i = 0; i < guildCount; i++) {
            const info = await getGuildInfo(i);
            if (info && info.category === category) results.push(info);
        }
        return results;
    }
}

async function getGuildLeaderboard() {
    let enriched = [];

    try {
        const data = await queryGoldsky(`{
            guildCreateds(orderBy: timestamp_, orderDirection: asc, first: 1000) {
                id guildId name category creator timestamp_
            }
        }`);

        // Parallel RPC calls instead of sequential (10x faster with 50+ guilds)
        const BATCH_SIZE = 10;
        for (let i = 0; i < data.guildCreateds.length; i += BATCH_SIZE) {
            const batch = data.guildCreateds.slice(i, i + BATCH_SIZE);
            const results = await Promise.all(batch.map(g => getGuildInfo(g.guildId).catch(() => null)));
            enriched.push(...results.filter(Boolean));
        }
    } catch (e) {
        // Fallback: iterate all guilds via RPC (batched)
        const guildCount = Number(await readContract('guildCount'));
        const BATCH_SIZE = 10;
        for (let i = 0; i < guildCount; i += BATCH_SIZE) {
            const batch = Array.from({ length: Math.min(BATCH_SIZE, guildCount - i) }, (_, j) => i + j);
            const results = await Promise.all(batch.map(id => getGuildInfo(id).catch(() => null)));
            enriched.push(...results.filter(Boolean));
        }
    }

    // Sort by avg rating (descending), then by total missions
    enriched.sort((a, b) => {
        const aRating = a.avgRating === 'N/A' ? 0 : parseFloat(a.avgRating);
        const bRating = b.avgRating === 'N/A' ? 0 : parseFloat(b.avgRating);
        if (bRating !== aRating) return bRating - aRating;
        return b.totalMissions - a.totalMissions;
    });

    return enriched;
}

async function getMissionDetails(missionId) {
    try {
        const data = await queryGoldsky(`
            query GetMissionDetails($missionId: BigInt!) {
                missionCreateds(where: { missionId: $missionId }) {
                    id missionId guildId client taskHash timestamp_ transactionHash_
                }
                missionCompleteds(where: { missionId: $missionId }) {
                    id missionId resultHashes timestamp_ transactionHash_
                }
                missionRateds(where: { missionId: $missionId }) {
                    id score timestamp_ transactionHash_
                }
            }
        `, { missionId: String(missionId) });

        const created = data.missionCreateds[0];
        if (!created) return null;

        return {
            ...created,
            completed: data.missionCompleteds[0] || null,
            rated: data.missionRateds[0] || null,
            source: 'goldsky',
        };
    } catch (e) {
        // Fallback to RPC - getMission returns a struct
        const mission = await readContract('getMission', [BigInt(missionId)]);

        return {
            missionId: String(missionId),
            guildId: mission.guildId.toString(),
            client: mission.client,
            budget: mission.budget.toString(),
            taskHash: mission.taskHash,
            completed: mission.completed,
            completedAt: Number(mission.completedAt),
            createdAt: Number(mission.createdAt),
            resultHashes: mission.resultHashes,
            rated: mission.rated ? { score: Number(mission.rating) } : null,
            source: 'rpc',
        };
    }
}

async function getMissionsByGuild(guildId) {
    try {
        const data = await queryGoldsky(`
            query GetMissionsByGuild($guildId: BigInt!) {
                missionCreateds(where: { guildId: $guildId }, orderBy: timestamp_, orderDirection: desc, first: 1000) {
                    id missionId guildId client taskHash timestamp_ transactionHash_
                }
            }
        `, { guildId: String(guildId) });

        return data.missionCreateds;
    } catch (e) {
        // Fallback: iterate missions via RPC (limited)
        const missionCount = Number(await readContract('getMissionCount'));
        const missions = [];
        for (let i = 0; i < missionCount; i++) {
            const m = await readContract('getMission', [BigInt(i)]);
            if (Number(m.guildId) === Number(guildId)) {
                missions.push({ missionId: String(i), guildId: m.guildId.toString(), client: m.client, source: 'rpc' });
            }
        }
        return missions;
    }
}

async function getRecentActivity() {
    try {
        const data = await queryGoldsky(`{
            guildCreateds(first: 5, orderBy: timestamp_, orderDirection: desc) {
                id guildId name category timestamp_
            }
            missionCreateds(first: 10, orderBy: timestamp_, orderDirection: desc) {
                id missionId guildId client taskHash timestamp_
            }
            missionCompleteds(first: 10, orderBy: timestamp_, orderDirection: desc) {
                id missionId guildId resultHashes timestamp_
            }
            missionRateds(first: 10, orderBy: timestamp_, orderDirection: desc) {
                id missionId guildId score timestamp_
            }
        }`);

        return data;
    } catch (e) {
        // Fallback: return basic RPC data
        const status = await getOnChainStatus();
        return {
            guildCreateds: [],
            missionCreateds: [],
            missionCompleteds: [],
            missionRateds: [],
            summary: status,
            source: 'rpc',
        };
    }
}

async function getAgents() {
    try {
        const data = await queryGoldsky(`{
            agentRegistereds(first: 1000, orderBy: timestamp_, orderDirection: desc) {
                id wallet capability priceWei timestamp_ transactionHash_
            }
        }`);

        return data.agentRegistereds;
    } catch (e) {
        // Fallback to RPC
        const agentList = await readContract('getAgentList');
        const agents = [];
        for (const addr of agentList) {
            const [wallet, owner, capability, priceWei, missionsCompleted, active] =
                await readContract('agents', [addr]);
            if (active) {
                agents.push({ agent: addr, owner, capability, priceWei: priceWei.toString(), missionsCompleted: Number(missionsCompleted), source: 'rpc' });
            }
        }
        return agents;
    }
}

async function getAgentByAddress(address) {
    try {
        const data = await queryGoldsky(`
            query GetAgent($wallet: String!) {
                agentRegistereds(where: { wallet: $wallet }, orderBy: timestamp_, orderDirection: desc, first: 1) {
                    id wallet capability priceWei timestamp_ transactionHash_
                }
            }
        `, { wallet: address.toLowerCase() });

        return data.agentRegistereds[0] || null;
    } catch (e) {
        // Fallback to RPC
        const [wallet, owner, capability, priceWei, missionsCompleted, active] =
            await readContract('agents', [address]);
        if (!active) return null;
        return { agent: address, owner, capability, priceWei: priceWei.toString(), missionsCompleted: Number(missionsCompleted), source: 'rpc' };
    }
}

// ═══════════════════════════════════════
// VIEM WRITES
// ═══════════════════════════════════════

async function writeContract(functionName, args, value) {
    const client = getWalletClient();
    const publicClient = getPublicClient();
    const config = getContractConfig();

    const hash = await client.writeContract({
        ...config,
        functionName,
        args,
        ...(value ? { value } : {}),
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return {
        txHash: hash,
        explorer: `${EXPLORER_URL}${hash}`,
        status: receipt.status === 'success' ? 'confirmed' : 'failed',
        blockNumber: Number(receipt.blockNumber),
    };
}

async function createGuild(name, category) {
    return writeContract('createGuild', [name, category]);
}

async function createMission(guildId, taskHash, budgetWei) {
    return writeContract('createMission', [BigInt(guildId), taskHash], budgetWei);
}

async function completeMission(missionId, resultHashes, recipients, splits) {
    return writeContract('completeMission', [
        BigInt(missionId),
        resultHashes,
        recipients,
        splits.map(s => BigInt(s)),
    ]);
}

async function rateMission(missionId, score) {
    return writeContract('rateMission', [BigInt(missionId), score]);
}

async function registerAgent(capability, priceWei) {
    return writeContract('registerAgent', [capability, BigInt(priceWei)]);
}

// V4 write functions
async function registerAgentWithWallet(agentWallet, capability, priceWei) {
    return writeContract('registerAgentWithWallet', [agentWallet, capability, BigInt(priceWei)]);
}

async function updateAgent(agentWallet, capability, priceWei) {
    return writeContract('updateAgent', [agentWallet, capability, BigInt(priceWei)]);
}

async function joinGuild(guildId) {
    return writeContract('joinGuild', [BigInt(guildId)]);
}

async function leaveGuild(guildId) {
    return writeContract('leaveGuild', [BigInt(guildId)]);
}

async function claimMission(missionId) {
    return writeContract('claimMission', [BigInt(missionId)]);
}

async function cancelMission(missionId) {
    return writeContract('cancelMission', [BigInt(missionId)]);
}

async function createMissionFromBalance(guildId, taskHash, budget) {
    return writeContract('createMissionFromBalance', [BigInt(guildId), taskHash, BigInt(budget)]);
}

async function depositFunds(amountWei) {
    return writeContract('depositFunds', [], amountWei);
}

async function withdrawUserFunds(amountWei) {
    return writeContract('withdrawFunds', [BigInt(amountWei)]);
}

// ═══════════════════════════════════════
// DIRECT RPC READS (fallback if Goldsky is slow)
// ═══════════════════════════════════════

async function readContract(functionName, args = []) {
    const client = getPublicClient();
    const config = getContractConfig();

    return client.readContract({
        ...config,
        functionName,
        args,
    });
}

async function getCoordinatorAddress() {
    return readContract('coordinator');
}

async function getGuildAgents(guildId) {
    return readContract('getGuildAgents', [BigInt(guildId)]);
}

async function getAgentGuildsRPC(agent) {
    return readContract('getAgentGuilds', [agent]);
}

async function getMissionClaim(missionId) {
    return readContract('missionClaims', [BigInt(missionId)]);
}

async function getUserBalance(address) {
    const balance = await readContract('userBalances', [address]);
    return formatEther(balance);
}

async function isAgentInGuildRPC(guildId, agent) {
    return readContract('isAgentInGuild', [BigInt(guildId), agent]);
}

async function getOnChainStatus() {
    const safeRead = async (fn) => { try { return await readContract(fn); } catch { return BigInt(0); } };

    const [missionCount, agentCount, guildCount, fees, timeout] = await Promise.all([
        safeRead('getMissionCount'),
        safeRead('getAgentCount'),
        safeRead('guildCount'),
        safeRead('totalFeesCollected'),
        safeRead('missionTimeout'),
    ]);

    return {
        missionCount: Number(missionCount),
        agentCount: Number(agentCount),
        guildCount: Number(guildCount),
        totalFeesCollected: formatEther(fees),
        missionTimeoutSeconds: Number(timeout),
    };
}

// ═══════════════════════════════════════
// FAUCET
// ═══════════════════════════════════════

async function requestFaucet(address) {
    const res = await fetch(FAUCET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, chainId: CHAIN_ID }),
    });

    const data = await res.json();

    if (!res.ok) {
        throw new Error(`Faucet request failed: ${JSON.stringify(data)}`);
    }

    return data;
}

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════

function hashTask(taskDescription) {
    return keccak256(toHex(taskDescription));
}

function hashResult(resultData) {
    return keccak256(toHex(typeof resultData === 'string' ? resultData : JSON.stringify(resultData)));
}

// ═══════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════

module.exports = {
    // Config
    GUILD_REGISTRY_ADDRESS,
    GOLDSKY_ENDPOINT,
    EXPLORER_URL,
    GUILD_REGISTRY_ABI,
    FAUCET_URL,
    CHAIN_ID,
    MONAD_RPC,
    IS_MAINNET,
    monadChain,
    monadTestnet: monadChain, // backwards compat

    // Clients
    getPublicClient,
    getWalletClient,
    getContractConfig,

    // Goldsky reads (with RPC fallbacks)
    queryGoldsky,
    getStatus,
    getGuildInfo,
    getGuildsByCategory,
    getGuildLeaderboard,
    getMissionDetails,
    getMissionsByGuild,
    getRecentActivity,
    getAgents,
    getAgentByAddress,

    // Direct RPC reads
    readContract,
    getCoordinatorAddress,
    getOnChainStatus,
    getGuildAgents,
    getAgentGuildsRPC,
    getMissionClaim,
    getUserBalance,
    isAgentInGuildRPC,

    // Writes (v3)
    createGuild,
    createMission,
    completeMission,
    rateMission,
    registerAgent,

    // Writes (v4)
    registerAgentWithWallet,
    updateAgent,
    joinGuild,
    leaveGuild,
    claimMission,
    cancelMission,
    createMissionFromBalance,
    depositFunds,
    withdrawUserFunds,

    // Faucet
    requestFaucet,

    // Helpers
    hashTask,
    hashResult,
    parseEther,
    formatEther,
};
