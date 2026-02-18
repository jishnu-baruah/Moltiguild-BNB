#!/usr/bin/env node

/**
 * MoltiGuild E2E Test (v4)
 *
 * Full mission lifecycle on Monad testnet:
 * createGuild → registerAgent → joinGuild → createMission → claimMission → completeMission → rateMission
 *
 * REQUIRES: COORDINATOR_PRIVATE_KEY in .env
 *
 * Usage: node test-e2e.js
 */

const monad = require('./monad');

let passed = 0;
let failed = 0;

async function test(name, fn) {
    try {
        const result = await fn();
        console.log(`  ✓ ${name}`);
        passed++;
        return result;
    } catch (err) {
        console.log(`  ✗ ${name}`);
        console.log(`    Error: ${err.message.split('\n')[0]}`);
        failed++;
        return null;
    }
}

function assert(condition, message) {
    if (!condition) throw new Error(message || 'Assertion failed');
}

async function main() {
    console.log('\n═══ MoltiGuild E2E Test (v4) ═══\n');

    if (!process.env.COORDINATOR_PRIVATE_KEY) {
        console.log('ERROR: COORDINATOR_PRIVATE_KEY not set in .env');
        process.exit(1);
    }

    const wallet = monad.getWalletClient();
    const coordAddr = wallet.account.address;
    console.log(`Coordinator: ${coordAddr}\n`);

    // ─── Step 1: Create Guild ───
    console.log('Step 1: Create Guild');

    const guildResult = await test('createGuild("E2E Test Guild", "test")', async () => {
        const result = await monad.createGuild('E2E Test Guild', 'test');
        assert(result.status === 'confirmed', `Tx failed: ${result.status}`);
        console.log(`    TX: ${result.explorer}`);
        return result;
    });

    if (!guildResult) { console.log('\nCannot continue. Exiting.'); process.exit(1); }

    const guildCount = await monad.readContract('guildCount');
    const guildId = Number(guildCount) - 1;
    console.log(`    Guild ID: ${guildId}\n`);

    // Verify guild on-chain
    await test('getGuild returns correct data', async () => {
        const guild = await monad.readContract('getGuild', [BigInt(guildId)]);
        assert(guild.name === 'E2E Test Guild', `Name mismatch: ${guild.name}`);
        assert(guild.category === 'test', `Category mismatch: ${guild.category}`);
        assert(guild.active === true, 'Guild should be active');
        console.log(`    Name: ${guild.name}, Category: ${guild.category}`);
    });

    // ─── Step 2: Register Agent ───
    console.log('\nStep 2: Register Agent');

    await test('registerAgent("e2e-tester", 0.0005 MON)', async () => {
        const result = await monad.registerAgent('e2e-tester', monad.parseEther('0.0005'));
        assert(result.status === 'confirmed', 'Tx failed');
        console.log(`    TX: ${result.explorer}`);
    });

    await test('agent is registered on-chain', async () => {
        const [wallet, owner, capability, priceWei, missionsCompleted, active] =
            await monad.readContract('agents', [coordAddr]);
        assert(active === true, 'Agent should be active');
        assert(capability === 'e2e-tester', `Capability mismatch: ${capability}`);
        console.log(`    Wallet: ${wallet}, Owner: ${owner}, Price: ${monad.formatEther(priceWei)} MON`);
    });

    // ─── Step 3: Join Guild ───
    console.log('\nStep 3: Join Guild');

    await test(`joinGuild(${guildId})`, async () => {
        const result = await monad.joinGuild(guildId);
        assert(result.status === 'confirmed', 'Tx failed');
        console.log(`    TX: ${result.explorer}`);
    });

    await test('agent is in guild on-chain', async () => {
        const inGuild = await monad.isAgentInGuildRPC(guildId, coordAddr);
        assert(inGuild === true, 'Agent should be in guild');
        const agents = await monad.getGuildAgents(guildId);
        assert(agents.length === 1, `Expected 1 agent, got ${agents.length}`);
        console.log(`    Guild agents: ${agents.join(', ')}`);
    });

    // ─── Step 4: Create Mission ───
    console.log('\nStep 4: Create Mission');

    const taskHash = monad.hashTask('E2E test: create a meme about Monad');
    const budget = monad.parseEther('0.001');

    const missionResult = await test('createMission with 0.001 MON', async () => {
        const result = await monad.createMission(guildId, taskHash, budget);
        assert(result.status === 'confirmed', 'Tx failed');
        console.log(`    TX: ${result.explorer}`);
        return result;
    });

    if (!missionResult) { console.log('\nCannot continue. Exiting.'); process.exit(1); }

    const missionCount = await monad.readContract('getMissionCount');
    const missionId = Number(missionCount) - 1;
    console.log(`    Mission ID: ${missionId}\n`);

    // ─── Step 5: Claim Mission ───
    console.log('Step 5: Claim Mission');

    await test(`claimMission(${missionId})`, async () => {
        const result = await monad.claimMission(missionId);
        assert(result.status === 'confirmed', 'Tx failed');
        console.log(`    TX: ${result.explorer}`);
    });

    await test('mission claim recorded on-chain', async () => {
        const claimer = await monad.getMissionClaim(missionId);
        assert(claimer.toLowerCase() === coordAddr.toLowerCase(), `Claimer mismatch: ${claimer}`);
        console.log(`    Claimed by: ${claimer}`);
    });

    // ─── Step 6: Complete Mission ───
    console.log('\nStep 6: Complete Mission');

    const resultHash = monad.hashResult('E2E result: meme created successfully');
    const agentSplit = monad.parseEther('0.0009'); // 90% to agent, 10% fee

    await test('completeMission with payment split', async () => {
        const result = await monad.completeMission(
            missionId,
            [resultHash],
            [coordAddr],
            [agentSplit],
        );
        assert(result.status === 'confirmed', 'Tx failed');
        console.log(`    TX: ${result.explorer}`);
        console.log(`    Agent paid: 0.0009 MON, Fee: 0.0001 MON`);
    });

    await test('mission is completed on-chain', async () => {
        const mission = await monad.readContract('getMission', [BigInt(missionId)]);
        assert(mission.completed === true, 'Mission should be completed');
        console.log(`    Completed at: ${Number(mission.completedAt)}`);
    });

    // ─── Step 7: Rate Mission ───
    console.log('\nStep 7: Rate Mission');

    await test('rateMission(5 stars)', async () => {
        const result = await monad.rateMission(missionId, 5);
        assert(result.status === 'confirmed', 'Tx failed');
        console.log(`    TX: ${result.explorer}`);
    });

    await test('rating recorded on-chain', async () => {
        const mission = await monad.readContract('getMission', [BigInt(missionId)]);
        assert(mission.rated === true, 'Mission should be rated');
        assert(Number(mission.rating) === 5, `Expected rating 5, got ${mission.rating}`);
        console.log(`    Rating: ${mission.rating}/5`);
    });

    await test('guild reputation updated', async () => {
        const [avgScaled, totalMissions] = await monad.readContract('getGuildReputation', [BigInt(guildId)]);
        console.log(`    Avg rating: ${(Number(avgScaled) / 100).toFixed(1)}/5, Total missions: ${Number(totalMissions)}`);
    });

    // ─── Step 8: Verify Goldsky Indexing ───
    console.log('\nStep 8: Verify Goldsky (waiting 5s for indexing...)');
    await new Promise(r => setTimeout(r, 5000));

    await test('guild appears in Goldsky', async () => {
        const status = await monad.getStatus();
        assert(status.guilds > 0, `Expected guilds > 0, got ${status.guilds}`);
        console.log(`    Goldsky: ${status.guilds} guilds, ${status.missionsCreated} missions, ${status.agents} agents (source: ${status.source})`);
    });

    // ─── Summary ───
    console.log(`\n═══ E2E Results: ${passed} passed, ${failed} failed ═══`);
    console.log(`Guild ID: ${guildId}, Mission ID: ${missionId}`);
    console.log(`Contract: ${monad.GUILD_REGISTRY_ADDRESS}`);
    console.log(`Explorer: https://testnet.monadexplorer.com/address/${monad.GUILD_REGISTRY_ADDRESS}\n`);

    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('E2E test error:', err.message);
    process.exit(1);
});
