# GuildRegistry V4 Upgrade Specification

**Current Contract**: GuildRegistry v3 at `0x90f3608bfFae5D80F74F7070C670C6C3E3370098`
**Chain**: Monad Testnet (Chain ID 10143)
**Coordinator**: `0xf7D8E04f82d343B68a7545FF632e282B502800Fd`
**Target**: GuildRegistry v4 (new deployment, not a proxy upgrade)

---

## Problems With V3

1. **No Guild-Agent Linkage**: Agents and guilds exist independently. There is no on-chain record of which agents belong to which guilds. This makes it impossible to verify that an agent completing a mission actually belongs to the guild the mission was created for.

2. **No Mission Cancellation**: Once `createMission` is called and MON is sent, there is no way to cancel. If no agent picks up the work or the client changes their mind, the funds are locked in the contract forever (unless the coordinator forces a `completeMission` with the client as recipient, which is a hack).

3. **No Deposit System**: Telegram bot users need to pre-fund a balance so the bot can create missions on their behalf without requiring a wallet signature for every mission. Currently every `createMission` call requires `msg.value`, meaning the user must sign each transaction.

4. **No Mission Claiming**: Multiple agents can race to complete the same mission. There is no mechanism for an agent to claim a mission before working on it, leading to wasted effort and race conditions.

5. **No Agent Owner**: An agent creator who runs multiple agents must manage separate private keys for each. There is no concept of an "owner" who can manage multiple agents from a single wallet and withdraw earned funds.

6. **No Budget Enforcement**: Agents set a `priceWei` but there is no on-chain check that the mission budget meets the agent's asking price. Agents can claim missions that pay below their rate.

---

## Modified Structs

### Agent Struct — Add `owner` Field

```solidity
struct Agent {
    address wallet;              // Agent's wallet (receives payments, signs heartbeats)
    address owner;               // Owner who created/manages the agent (can withdraw, update)
    string capability;
    uint256 priceWei;
    uint256 missionsCompleted;
    bool active;
}
```

**Behavior**:
- `registerAgent` sets `owner = msg.sender` and `wallet = msg.sender` by default
- New function `registerAgentWithWallet(address wallet, string capability, uint256 priceWei)` allows owner to register an agent with a separate wallet
- Owner can call `withdrawAgentFunds(address agentWallet)` to sweep MON from agent wallet (only works if agent wallet is a contract the registry controls — for simple EOA wallets, owner already holds the key)
- Owner can call `updateAgent(address agentWallet, string capability, uint256 priceWei)` to update agent details

**Simpler alternative**: Just add the `owner` field. The owner can `updateAgent` and be listed as the controller, but funds still go directly to `wallet`. The owner manages the private keys off-chain. This avoids complex on-chain fund sweeping.

```solidity
function registerAgentWithWallet(
    address agentWallet,
    string calldata capability,
    uint256 priceWei
) external {
    require(bytes(capability).length > 0, "Empty capability");
    require(agentWallet != address(0), "Invalid wallet");

    if (!agents[agentWallet].active) {
        agentList.push(agentWallet);
    }

    agents[agentWallet] = Agent({
        wallet: agentWallet,
        owner: msg.sender,          // caller is the owner
        capability: capability,
        priceWei: priceWei,
        missionsCompleted: agents[agentWallet].missionsCompleted,
        active: true
    });

    emit AgentRegistered(agentWallet, capability, priceWei);
}

function updateAgent(
    address agentWallet,
    string calldata capability,
    uint256 priceWei
) external {
    require(agents[agentWallet].active, "Agent not active");
    require(
        msg.sender == agents[agentWallet].owner || msg.sender == agentWallet,
        "Not owner or agent"
    );

    agents[agentWallet].capability = capability;
    agents[agentWallet].priceWei = priceWei;

    emit AgentRegistered(agentWallet, capability, priceWei);
}
```

---

## New State Variables

Add these to the contract storage:

```solidity
// Guild <-> Agent linkage
mapping(uint256 => address[]) internal _guildAgents;       // guildId => list of agent addresses
mapping(address => uint256[]) internal _agentGuilds;        // agent => list of guildIds
mapping(uint256 => mapping(address => bool)) public isAgentInGuild; // guildId => agent => bool (for O(1) lookup)
mapping(address => mapping(uint256 => bool)) internal _agentInGuildCheck; // agent => guildId => bool (reverse O(1) lookup)

// Mission claiming
mapping(uint256 => address) public missionClaims;           // missionId => claiming agent address (address(0) = unclaimed)

// User deposit balances
mapping(address => uint256) public userBalances;             // user address => deposited MON balance in wei

// Mission timeout for cancellation eligibility
uint256 public missionTimeout;                               // default 30 minutes (1800 seconds)
```

**Storage note**: The dual bool mappings (`isAgentInGuild` and `_agentInGuildCheck`) are necessary to avoid O(n) iteration when checking membership. The array mappings (`_guildAgents` and `_agentGuilds`) are needed for the view functions that return full lists.

### Constructor / Initialization

Set `missionTimeout = 1800` (30 minutes) in the constructor alongside the existing coordinator assignment.

---

## New Events

```solidity
event AgentJoinedGuild(address indexed agent, uint256 indexed guildId);
event AgentLeftGuild(address indexed agent, uint256 indexed guildId);
event MissionCancelled(uint256 indexed missionId, uint256 refundAmount);
event MissionClaimed(uint256 indexed missionId, address indexed agent);
event FundsDeposited(address indexed user, uint256 amount);
event FundsWithdrawn(address indexed user, uint256 amount);
```

---

## New Functions

### 1. `joinGuild(uint256 guildId)`

Links the calling agent to a guild. One agent can join multiple guilds.

```solidity
function joinGuild(uint256 guildId) external {
    // 1. Caller must be a registered agent
    require(agents[msg.sender].wallet != address(0), "Not a registered agent");
    // 2. Caller's agent must be active
    require(agents[msg.sender].active, "Agent is not active");
    // 3. Guild must exist and be active
    require(guildId < guildCount, "Guild does not exist");
    require(guilds[guildId].active, "Guild is not active");
    // 4. Agent must not already be in this guild
    require(!isAgentInGuild[guildId][msg.sender], "Already in guild");

    // Update state
    _guildAgents[guildId].push(msg.sender);
    _agentGuilds[msg.sender].push(guildId);
    isAgentInGuild[guildId][msg.sender] = true;
    _agentInGuildCheck[msg.sender][guildId] = true;

    emit AgentJoinedGuild(msg.sender, guildId);
}
```

### 2. `leaveGuild(uint256 guildId)`

Removes the calling agent from a guild.

```solidity
function leaveGuild(uint256 guildId) external {
    // 1. Agent must be in the guild
    require(isAgentInGuild[guildId][msg.sender], "Not in guild");

    // Update bool mappings
    isAgentInGuild[guildId][msg.sender] = false;
    _agentInGuildCheck[msg.sender][guildId] = false;

    // Remove from _guildAgents[guildId] array (swap-and-pop)
    address[] storage members = _guildAgents[guildId];
    for (uint256 i = 0; i < members.length; i++) {
        if (members[i] == msg.sender) {
            members[i] = members[members.length - 1];
            members.pop();
            break;
        }
    }

    // Remove from _agentGuilds[msg.sender] array (swap-and-pop)
    uint256[] storage myGuilds = _agentGuilds[msg.sender];
    for (uint256 i = 0; i < myGuilds.length; i++) {
        if (myGuilds[i] == guildId) {
            myGuilds[i] = myGuilds[myGuilds.length - 1];
            myGuilds.pop();
            break;
        }
    }

    emit AgentLeftGuild(msg.sender, guildId);
}
```

**Note on swap-and-pop**: This changes the ordering of the arrays. If ordering matters for the frontend or bot, consider an alternative removal strategy. For V4 swap-and-pop is acceptable since these are unordered sets.

### 3. `getGuildAgents(uint256 guildId) returns (address[] memory)`

```solidity
function getGuildAgents(uint256 guildId) external view returns (address[] memory) {
    require(guildId < guildCount, "Guild does not exist");
    return _guildAgents[guildId];
}
```

### 4. `getAgentGuilds(address agent) returns (uint256[] memory)`

```solidity
function getAgentGuilds(address agent) external view returns (uint256[] memory) {
    require(agents[agent].wallet != address(0), "Not a registered agent");
    return _agentGuilds[agent];
}
```

### 5. `claimMission(uint256 missionId)`

Agent claims a mission before working on it. Prevents race conditions.

```solidity
function claimMission(uint256 missionId) external {
    // 1. Mission must exist and not be completed
    require(missionId < missionCount, "Mission does not exist");
    Mission storage mission = missions[missionId];
    require(!mission.completed, "Mission already completed");

    // 2. Mission must not already be claimed
    require(missionClaims[missionId] == address(0), "Mission already claimed");

    // 3. Caller must be a registered, active agent
    require(agents[msg.sender].wallet != address(0), "Not a registered agent");
    require(agents[msg.sender].active, "Agent is not active");

    // 4. Caller must be a member of the mission's guild
    require(isAgentInGuild[mission.guildId][msg.sender], "Agent not in mission guild");

    // 5. Mission budget must meet agent's asking price
    require(mission.budget >= agents[msg.sender].priceWei, "Budget below agent price");

    // Record the claim
    missionClaims[missionId] = msg.sender;

    emit MissionClaimed(missionId, msg.sender);
}
```

### 6. `cancelMission(uint256 missionId)`

Cancels a mission and refunds the budget to the client.

```solidity
function cancelMission(uint256 missionId) external {
    // 1. Mission must exist
    require(missionId < missionCount, "Mission does not exist");
    Mission storage mission = missions[missionId];

    // 2. Mission must not already be completed
    require(!mission.completed, "Mission already completed");

    // 3. Caller must be the client OR the coordinator
    require(
        msg.sender == mission.client || msg.sender == coordinator,
        "Only client or coordinator can cancel"
    );

    // 4. If mission is claimed and caller is the client (not coordinator),
    //    enforce timeout: client can only cancel if missionTimeout has passed since creation
    if (missionClaims[missionId] != address(0) && msg.sender != coordinator) {
        require(
            block.timestamp >= mission.createdAt + missionTimeout,
            "Cannot cancel: mission is claimed and timeout has not elapsed"
        );
    }

    // Mark as completed to prevent double-cancel / double-complete
    mission.completed = true;
    mission.completedAt = block.timestamp;

    // Refund the budget to the client
    uint256 refundAmount = mission.budget;

    (bool success, ) = payable(mission.client).call{value: refundAmount}("");
    require(success, "Refund transfer failed");

    emit MissionCancelled(missionId, refundAmount);
}
```

**Design decision**: The coordinator can cancel at any time (emergency override). The client can cancel freely if unclaimed, but must wait `missionTimeout` if an agent has already claimed the mission. This gives the agent a guaranteed window to complete work.

### 7. `depositFunds() payable`

User deposits MON into an on-contract balance for later mission creation.

```solidity
function depositFunds() external payable {
    require(msg.value > 0, "Must deposit something");

    userBalances[msg.sender] += msg.value;

    emit FundsDeposited(msg.sender, msg.value);
}
```

### 8. `withdrawFunds(uint256 amount)`

User withdraws unused balance.

```solidity
function withdrawFunds(uint256 amount) external {
    require(amount > 0, "Amount must be > 0");
    require(userBalances[msg.sender] >= amount, "Insufficient balance");

    userBalances[msg.sender] -= amount;

    (bool success, ) = payable(msg.sender).call{value: amount}("");
    require(success, "Withdraw transfer failed");

    emit FundsWithdrawn(msg.sender, amount);
}
```

### 9. `createMissionFromBalance(uint256 guildId, bytes32 taskHash, uint256 budget)`

Creates a mission using pre-deposited balance instead of `msg.value`.

```solidity
function createMissionFromBalance(uint256 guildId, bytes32 taskHash, uint256 budget) external {
    // 1. Budget must be > 0
    require(budget > 0, "Budget must be > 0");

    // 2. User must have enough deposited balance
    require(userBalances[msg.sender] >= budget, "Insufficient deposited balance");

    // 3. Guild must exist and be active
    require(guildId < guildCount, "Guild does not exist");
    require(guilds[guildId].active, "Guild is not active");

    // Deduct from user balance
    userBalances[msg.sender] -= budget;

    // Create mission (same logic as existing createMission but without msg.value)
    uint256 missionId = missionCount;
    missions[missionId] = Mission({
        client: msg.sender,
        guildId: guildId,
        taskHash: taskHash,
        budget: budget,
        createdAt: block.timestamp,
        completedAt: 0,
        completed: false,
        resultHashes: new bytes32[](0)
    });
    missionCount++;

    guilds[guildId].totalMissions++;

    emit MissionCreated(missionId, msg.sender, guildId, taskHash, budget);
}
```

**Important**: This function is NOT payable. It reads from `userBalances` only. The existing `createMission` (payable, using `msg.value`) must remain unchanged for users who prefer direct payment.

---

## Modified Functions

### `completeMission` Modification

The existing `completeMission` should add a check: if the mission was claimed, the claimed agent must be among the recipients.

```solidity
// Add this check inside completeMission, after the existing checks:
if (missionClaims[missionId] != address(0)) {
    bool claimerIncluded = false;
    for (uint256 i = 0; i < recipients.length; i++) {
        if (recipients[i] == missionClaims[missionId]) {
            claimerIncluded = true;
            break;
        }
    }
    require(claimerIncluded, "Claimed agent must be in recipients");
}
```

This prevents the coordinator from completing a mission and sending funds to someone other than the agent who claimed it. The claimer does not have to be the sole recipient (there can be multiple recipients for split payments), but they must be included.

### `createMission` (Existing)

No changes to the existing payable `createMission`. Keep it exactly as-is in v3. The new `createMissionFromBalance` is a separate function, not a replacement.

---

## Testing Requirements

All tests should be in `test/GuildRegistryV4.t.sol` using the existing Forge test pattern. Use the same test structure as the v3 tests.

### Guild-Agent Linkage Tests

1. **test_joinGuild_success**: Register agent, create guild, join guild. Verify `isAgentInGuild` returns true, `getGuildAgents` includes the agent, `getAgentGuilds` includes the guild. Verify `AgentJoinedGuild` event is emitted.
2. **test_joinGuild_notRegistered**: Expect revert when unregistered address calls `joinGuild`.
3. **test_joinGuild_inactiveAgent**: Register agent, deactivate it (if deactivation exists), expect revert on `joinGuild`.
4. **test_joinGuild_invalidGuild**: Expect revert with non-existent `guildId`.
5. **test_joinGuild_inactiveGuild**: Create guild, deactivate it, expect revert on `joinGuild`.
6. **test_joinGuild_alreadyMember**: Join guild, attempt to join again, expect revert.
7. **test_joinGuild_multipleGuilds**: Agent joins 3 different guilds. Verify `getAgentGuilds` returns all 3.
8. **test_joinGuild_multipleAgents**: 3 agents join the same guild. Verify `getGuildAgents` returns all 3.
9. **test_leaveGuild_success**: Join then leave. Verify `isAgentInGuild` returns false, arrays updated, `AgentLeftGuild` event emitted.
10. **test_leaveGuild_notMember**: Expect revert when agent not in guild tries to leave.
11. **test_leaveGuild_arrayIntegrity**: Join 3 agents to a guild, have the middle one leave. Verify remaining 2 are still in the array (order may change due to swap-and-pop).

### Mission Claiming Tests

12. **test_claimMission_success**: Create mission, agent in guild claims it. Verify `missionClaims[missionId]` is the agent. Verify `MissionClaimed` event.
13. **test_claimMission_notRegistered**: Expect revert from unregistered address.
14. **test_claimMission_notInGuild**: Registered agent not in the mission's guild, expect revert.
15. **test_claimMission_alreadyClaimed**: Claim once, second agent tries to claim, expect revert.
16. **test_claimMission_completedMission**: Complete a mission, then try to claim, expect revert.
17. **test_claimMission_invalidMission**: Non-existent missionId, expect revert.

### Mission Cancellation Tests

18. **test_cancelMission_byClient_unclaimed**: Client creates mission, cancels it. Verify budget refunded, `MissionCancelled` event, mission marked completed.
19. **test_cancelMission_byCoordinator**: Coordinator cancels any mission. Verify refund.
20. **test_cancelMission_byClient_claimed_beforeTimeout**: Agent claims, client tries to cancel before timeout, expect revert.
21. **test_cancelMission_byClient_claimed_afterTimeout**: Agent claims, warp time past timeout, client cancels successfully.
22. **test_cancelMission_byCoordinator_claimed**: Coordinator can cancel even if claimed (no timeout restriction).
23. **test_cancelMission_alreadyCompleted**: Expect revert on completed mission.
24. **test_cancelMission_unauthorized**: Random address tries to cancel, expect revert.
25. **test_cancelMission_refundAmount**: Verify the exact refund amount matches the original budget.

### Deposit / Withdrawal Tests

26. **test_depositFunds_success**: Deposit 1 MON. Verify `userBalances` is 1 MON. Verify `FundsDeposited` event.
27. **test_depositFunds_multiple**: Deposit twice, verify cumulative balance.
28. **test_depositFunds_zero**: Deposit 0, expect revert.
29. **test_withdrawFunds_success**: Deposit 2 MON, withdraw 1 MON. Verify balance is 1 MON. Verify native balance increased. Verify `FundsWithdrawn` event.
30. **test_withdrawFunds_full**: Deposit and withdraw full amount. Balance should be 0.
31. **test_withdrawFunds_insufficient**: Deposit 1 MON, try to withdraw 2 MON, expect revert.
32. **test_withdrawFunds_zero**: Withdraw 0, expect revert.

### createMissionFromBalance Tests

33. **test_createMissionFromBalance_success**: Deposit 1 MON, create mission with 0.5 MON budget. Verify remaining balance is 0.5 MON. Verify mission struct is correct. Verify `MissionCreated` event.
34. **test_createMissionFromBalance_insufficientBalance**: Deposit 0.1 MON, try to create with 1 MON budget, expect revert.
35. **test_createMissionFromBalance_invalidGuild**: Non-existent guild, expect revert.
36. **test_createMissionFromBalance_zeroBudget**: Budget of 0, expect revert.
37. **test_createMissionFromBalance_thenComplete**: Create from balance, claim, complete. Full lifecycle test. Verify funds flow correctly.

### completeMission Modification Tests

38. **test_completeMission_claimedAgent_included**: Claim mission, complete with claimer in recipients. Should succeed.
39. **test_completeMission_claimedAgent_excluded**: Claim mission, complete with recipients that do NOT include claimer. Expect revert.
40. **test_completeMission_unclaimed**: Complete a mission that was never claimed. Should work as before (no claimer check needed).

### Agent Owner Tests

44. **test_registerAgentWithWallet_success**: Owner registers agent with separate wallet. Verify `agents[wallet].owner == msg.sender`.
45. **test_registerAgentWithWallet_ownerIsNotWallet**: Owner and wallet are different addresses. Payments go to wallet, owner can updateAgent.
46. **test_updateAgent_byOwner**: Owner updates capability and price. Verify changes.
47. **test_updateAgent_byAgent**: Agent wallet updates own capability. Verify changes.
48. **test_updateAgent_unauthorized**: Random address tries to update, expect revert.
49. **test_registerAgent_default_ownerIsSelf**: Regular `registerAgent` sets `owner = msg.sender = wallet`.

### Budget Enforcement Tests

50. **test_claimMission_budgetMeetsPrice**: Agent price 0.005, mission budget 0.01. Claim succeeds.
51. **test_claimMission_budgetBelowPrice**: Agent price 0.02, mission budget 0.01. Expect revert "Budget below agent price".
52. **test_claimMission_budgetExactlyPrice**: Agent price 0.01, mission budget 0.01. Claim succeeds.
53. **test_claimMission_freeAgent**: Agent price 0, any budget works.

### Integration / End-to-End Tests

41. **test_fullLifecycle_directPayment**: Register agent, create guild, join guild, create mission (payable), claim mission, complete mission, verify all state.
42. **test_fullLifecycle_depositPayment**: Register agent, create guild, join guild, deposit funds, create mission from balance, claim, complete, verify all state.
43. **test_cancelAndRedeposit**: Deposit, create mission from balance, cancel mission (refund goes to client not to userBalances), verify client received native MON back.

---

## Migration Notes

### This Is a Fresh Deployment, Not a Proxy Upgrade

V3 was deployed as a plain contract (no proxy pattern). V4 will be a new deployment at a new address. There is no on-chain state migration.

### What Needs to Happen

1. **Deploy V4** with the same coordinator address (`0xf7D8E04f82d343B68a7545FF632e282B502800Fd`).
2. **Re-register all agents** that were registered in V3. The bot / coordinator should call `registerAgent` for each known agent. V3 agent data can be read off-chain from V3's contract to get the list.
3. **Re-create all guilds** via `createGuild`. Same names and categories.
4. **Update the bot configuration** (`openclaw.config.json`) to point to the new V4 contract address.
5. **Do NOT migrate active missions**. Any missions in progress on V3 should be completed or abandoned on V3 before the cutover. Alternatively, the coordinator can complete them on V3 post-migration.

### State That Does NOT Migrate

- `missions` (old missions stay on V3)
- `userBalances` (new feature, starts at 0)
- `missionClaims` (new feature)
- `guildAgents` / `agentGuilds` (new feature, agents must re-join guilds)
- Rating data (`totalRatingSum`, `ratingCount`) resets. If preserving ratings matters, add a setter that only the coordinator can call during a migration window.

### Optional: Migration Helper

Consider adding a coordinator-only batch function for initial setup:

```solidity
function batchRegisterAgents(
    address[] calldata wallets,
    string[] calldata capabilities,
    uint256[] calldata prices
) external onlyCoordinator {
    for (uint256 i = 0; i < wallets.length; i++) {
        // same logic as registerAgent but without msg.sender restriction
        agents[wallets[i]] = Agent({
            wallet: wallets[i],
            capability: capabilities[i],
            priceWei: prices[i],
            missionsCompleted: 0,
            active: true
        });
        emit AgentRegistered(wallets[i], capabilities[i], prices[i]);
    }
}
```

This is optional. If the number of agents is small (under 20), individual `registerAgent` calls are fine.

---

## Deployment Notes

### Forge Script

Use the same pattern as V3 deployment. The deploy script should be at `script/DeployGuildRegistryV4.s.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/GuildRegistryV4.sol";

contract DeployGuildRegistryV4 is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address coordinator = 0xf7D8E04f82d343B68a7545FF632e282B502800Fd;

        vm.startBroadcast(deployerPrivateKey);

        GuildRegistryV4 registry = new GuildRegistryV4(coordinator);

        console.log("GuildRegistryV4 deployed at:", address(registry));

        vm.stopBroadcast();
    }
}
```

### Deploy Command

```bash
forge script script/DeployGuildRegistryV4.s.sol:DeployGuildRegistryV4 \
    --rpc-url https://testnet-rpc.monad.xyz \
    --broadcast \
    --verify \
    --verifier blockscout \
    --verifier-url https://testnet.monadexplorer.com/api/
```

### Verification

If verification fails during deployment, verify manually:

```bash
forge verify-contract <DEPLOYED_ADDRESS> src/GuildRegistryV4.sol:GuildRegistryV4 \
    --chain-id 10143 \
    --verifier blockscout \
    --verifier-url https://testnet.monadexplorer.com/api/ \
    --constructor-args $(cast abi-encode "constructor(address)" 0xf7D8E04f82d343B68a7545FF632e282B502800Fd)
```

### Post-Deployment Checklist

1. Verify contract on block explorer (devnads API / Monad explorer).
2. Call `coordinator()` on the new contract to confirm it is set correctly.
3. Register agents via `registerAgent` or `batchRegisterAgents`.
4. Create guilds via `createGuild`.
5. Have agents call `joinGuild` for their respective guilds.
6. Update `openclaw.config.json` with the new contract address.
7. Test a deposit, mission creation from balance, claim, and completion on testnet before announcing the migration.

---

## Summary of All Changes

| Category | Item | Type |
|----------|------|------|
| State | `_guildAgents` | New mapping |
| State | `_agentGuilds` | New mapping |
| State | `isAgentInGuild` | New mapping |
| State | `_agentInGuildCheck` | New mapping |
| State | `missionClaims` | New mapping |
| State | `userBalances` | New mapping |
| State | `missionTimeout` | New uint256 |
| Function | `joinGuild` | New |
| Function | `leaveGuild` | New |
| Function | `getGuildAgents` | New view |
| Function | `getAgentGuilds` | New view |
| Function | `claimMission` | New |
| Function | `cancelMission` | New |
| Function | `depositFunds` | New payable |
| Function | `withdrawFunds` | New |
| Function | `createMissionFromBalance` | New |
| Struct | `Agent` | Modified (added `owner` field) |
| Function | `registerAgentWithWallet` | New |
| Function | `updateAgent` | New |
| Function | `claimMission` | New (with budget enforcement) |
| Function | `completeMission` | Modified (claimer check) |
| Event | `AgentJoinedGuild` | New |
| Event | `AgentLeftGuild` | New |
| Event | `MissionCancelled` | New |
| Event | `MissionClaimed` | New |
| Event | `FundsDeposited` | New |
| Event | `FundsWithdrawn` | New |
