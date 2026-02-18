#!/usr/bin/env node

/**
 * MoltiGuild Unit Tests
 *
 * Tests Goldsky reads and RPC reads against Monad testnet.
 * No private key needed — read-only tests.
 *
 * Usage: node test-monad.js
 */

const monad = require('./monad');

let passed = 0;
let failed = 0;

async function test(name, fn) {
    try {
        await fn();
        console.log(`  ✓ ${name}`);
        passed++;
    } catch (err) {
        console.log(`  ✗ ${name}`);
        console.log(`    Error: ${err.message}`);
        failed++;
    }
}

function assert(condition, message) {
    if (!condition) throw new Error(message || 'Assertion failed');
}

async function main() {
    console.log('\n═══ MoltiGuild Unit Tests ═══\n');

    // ─── Goldsky Reads ───
    console.log('Goldsky Subgraph:');

    await test('queryGoldsky connects', async () => {
        const data = await monad.queryGoldsky('{ _meta { block { number } } }');
        assert(data._meta, 'Should return _meta');
        assert(data._meta.block.number, 'Should have block number');
        console.log(`    Block: ${data._meta.block.number}`);
    });

    await test('getStatus returns counts', async () => {
        const status = await monad.getStatus();
        assert(typeof status.guilds === 'number', 'guilds should be number');
        assert(typeof status.missionsCreated === 'number', 'missions should be number');
        assert(typeof status.agents === 'number', 'agents should be number');
        console.log(`    Guilds: ${status.guilds}, Missions: ${status.missionsCreated}, Agents: ${status.agents}`);
    });

    await test('getAgents returns array', async () => {
        const agents = await monad.getAgents();
        assert(Array.isArray(agents), 'Should return array');
        console.log(`    Found ${agents.length} agents`);
    });

    await test('getRecentActivity returns data', async () => {
        const activity = await monad.getRecentActivity();
        assert(activity.guildCreateds, 'Should have guildCreateds');
        assert(activity.missionCreateds, 'Should have missionCreateds');
    });

    await test('getGuildLeaderboard returns guilds', async () => {
        const guilds = await monad.getGuildLeaderboard();
        assert(Array.isArray(guilds), 'Should return array');
        console.log(`    Leaderboard: ${guilds.length} guilds`);
        if (guilds.length > 0) {
            console.log(`    Top: ${guilds[0].name} (${guilds[0].avgRating})`);
        }
    });

    // ─── Direct RPC Reads ───
    console.log('\nDirect RPC:');

    await test('getCoordinatorAddress', async () => {
        const addr = await monad.getCoordinatorAddress();
        assert(addr, 'Should return address');
        assert(addr.startsWith('0x'), 'Should be hex address');
        console.log(`    Coordinator: ${addr}`);
    });

    await test('getOnChainStatus', async () => {
        const status = await monad.getOnChainStatus();
        assert(typeof status.missionCount === 'number', 'missionCount should be number');
        assert(typeof status.agentCount === 'number', 'agentCount should be number');
        assert(typeof status.guildCount === 'number', 'guildCount should be number');
        console.log(`    Guilds: ${status.guildCount}, Missions: ${status.missionCount}, Agents: ${status.agentCount}`);
        console.log(`    Fees: ${status.totalFeesCollected} MON, Completed: ${status.totalMissionsCompleted}`);
    });

    // ─── Helpers ───
    console.log('\nHelpers:');

    await test('hashTask produces consistent hash', async () => {
        const h1 = monad.hashTask('test task');
        const h2 = monad.hashTask('test task');
        assert(h1 === h2, 'Same input should produce same hash');
        assert(h1.startsWith('0x'), 'Should be hex');
        assert(h1.length === 66, 'Should be 32 bytes');
    });

    await test('hashResult produces hash', async () => {
        const h = monad.hashResult({ text: 'meme copy', visual: 'gigachad' });
        assert(h.startsWith('0x'), 'Should be hex');
        assert(h.length === 66, 'Should be 32 bytes');
    });

    // ─── Cross-check ───
    console.log('\nCross-check (Goldsky vs RPC):');

    await test('guild count matches', async () => {
        const goldsky = await monad.getStatus();
        const rpc = await monad.getOnChainStatus();
        // Goldsky might lag slightly, so allow small difference
        const diff = Math.abs(goldsky.guilds - rpc.guildCount);
        assert(diff <= 2, `Guild count mismatch: Goldsky=${goldsky.guilds}, RPC=${rpc.guildCount}`);
        console.log(`    Goldsky: ${goldsky.guilds}, RPC: ${rpc.guildCount} (diff: ${diff})`);
    });

    // ─── Summary ───
    console.log(`\n═══ Results: ${passed} passed, ${failed} failed ═══\n`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('Test runner error:', err.message);
    process.exit(1);
});
