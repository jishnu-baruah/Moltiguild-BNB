// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Test.sol";
import "../src/GuildRegistry.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract GuildRegistryTest is Test {
    GuildRegistry public registry;
    address public coordinator = makeAddr("coordinator");
    address public agent1 = makeAddr("agent1");
    address public agent2 = makeAddr("agent2");
    address public client = makeAddr("client");
    address public randomUser = makeAddr("randomUser");

    uint256 public constant AGENT_PRICE = 0.05 ether;
    uint256 public constant INITIAL_BALANCE = 100 ether;

    function setUp() public {
        vm.startPrank(coordinator);
        GuildRegistry impl = new GuildRegistry();
        bytes memory initData = abi.encodeCall(GuildRegistry.initialize, (coordinator));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        registry = GuildRegistry(address(proxy));
        vm.stopPrank();

        vm.deal(agent1, INITIAL_BALANCE);
        vm.deal(agent2, INITIAL_BALANCE);
        vm.deal(client, INITIAL_BALANCE);
        vm.deal(randomUser, INITIAL_BALANCE);
    }

    // =========================
    // GUILD-AGENT LINKAGE TESTS
    // =========================

    function test_JoinGuild_Success() public {
        // Register Agent
        vm.prank(agent1);
        registry.registerAgent("AI Researcher", AGENT_PRICE);

        // Create Guild
        vm.prank(randomUser);
        uint256 guildId = registry.createGuild("AI Guild", "Research");

        // Join Guild
        vm.prank(agent1);
        registry.joinGuild(guildId);

        // Verify state
        assertTrue(registry.isAgentInGuild(guildId, agent1));
        
        address[] memory members = registry.getGuildAgents(guildId);
        assertEq(members.length, 1);
        assertEq(members[0], agent1);

        uint256[] memory myGuilds = registry.getAgentGuilds(agent1);
        assertEq(myGuilds.length, 1);
        assertEq(myGuilds[0], guildId);
    }

    function test_JoinGuild_Revert_NotRegistered() public {
        vm.prank(randomUser);
        registry.createGuild("AI Guild", "Research");

        vm.prank(agent1);
        vm.expectRevert("Not a registered agent");
        registry.joinGuild(0);
    }

    function test_LeaveGuild_Success() public {
        // Setup: Agent joins guild
        vm.prank(agent1);
        registry.registerAgent("AI Researcher", AGENT_PRICE);
        
        vm.prank(randomUser);
        registry.createGuild("AI Guild", "Research");
        
        vm.prank(agent1);
        registry.joinGuild(0);

        // Leave Guild
        vm.prank(agent1);
        registry.leaveGuild(0);

        // Verify state
        assertFalse(registry.isAgentInGuild(0, agent1));
        
        address[] memory members = registry.getGuildAgents(0);
        assertEq(members.length, 0);

        uint256[] memory myGuilds = registry.getAgentGuilds(agent1);
        assertEq(myGuilds.length, 0);
    }

    // =========================
    // MISSION CLAIMING TESTS
    // =========================

    function test_ClaimMission_Success() public {
        // Setup: Agent joins guild
        vm.prank(agent1);
        registry.registerAgent("AI Researcher", AGENT_PRICE);
        
        vm.prank(randomUser);
        registry.createGuild("AI Guild", "Research"); // Guild 0
        
        vm.prank(agent1);
        registry.joinGuild(0);

        // Create Mission with sufficient budget
        vm.prank(client);
        uint256 missionId = registry.createMission{value: 0.1 ether}(0, bytes32("task1"));

        // Claim Mission
        vm.prank(agent1);
        registry.claimMission(missionId);

        // Verify claim
        assertEq(registry.missionClaims(missionId), agent1);
    }

    function test_ClaimMission_Revert_BudgetTooLow() public {
        // Agent price is 0.05 ether
        vm.prank(agent1);
        registry.registerAgent("Expensive Agent", 0.05 ether);
        
        vm.prank(randomUser);
        registry.createGuild("AI Guild", "Research");
        
        vm.prank(agent1);
        registry.joinGuild(0);

        // Mission budget 0.01 ether (too low)
        vm.prank(client);
        uint256 missionId = registry.createMission{value: 0.01 ether}(0, bytes32("task1"));

        vm.prank(agent1);
        vm.expectRevert("Budget below agent price");
        registry.claimMission(missionId);
    }

    function test_ClaimMission_Revert_AlreadyClaimed() public {
        // Setup two agents in guild
        vm.startPrank(agent1);
        registry.registerAgent("Agent 1", AGENT_PRICE);
        vm.stopPrank();

        vm.startPrank(agent2);
        registry.registerAgent("Agent 2", AGENT_PRICE);
        vm.stopPrank();

        vm.prank(randomUser);
        registry.createGuild("Guild", "Tech"); // Guild 0

        vm.prank(agent1);
        registry.joinGuild(0);
        vm.prank(agent2);
        registry.joinGuild(0);

        // Create Mission
        vm.prank(client);
        uint256 missionId = registry.createMission{value: 0.1 ether}(0, bytes32("task1"));

        // Agent 1 claims first
        vm.prank(agent1);
        registry.claimMission(missionId);

        // Agent 2 tries to claim
        vm.prank(agent2);
        vm.expectRevert("Mission already claimed");
        registry.claimMission(missionId);
    }

    // =========================
    // MISSION CANCELLATION TESTS
    // =========================

    function test_CancelMission_ByClient_Success() public {
        vm.prank(randomUser);
        registry.createGuild("Guild", "Tech");

        vm.prank(client);
        uint256 missionId = registry.createMission{value: 1 ether}(0, bytes32("task1"));
        
        uint256 balanceBefore = client.balance;

        vm.prank(client);
        registry.cancelMission(missionId);

        // Verify refund
        assertEq(client.balance, balanceBefore + 1 ether);
        
        // Verify mission status
        GuildRegistry.Mission memory m = registry.getMission(missionId);
        assertTrue(m.completed);
    }

    function test_CancelMission_ByClient_Revert_ClaimedUnderTimeout() public {
        // Setup Agent & Guild
        vm.prank(agent1);
        registry.registerAgent("Agent", AGENT_PRICE);
        vm.prank(randomUser);
        registry.createGuild("Guild", "Tech");
        vm.prank(agent1);
        registry.joinGuild(0);

        // Create & Claim Mission
        vm.prank(client);
        uint256 missionId = registry.createMission{value: 1 ether}(0, bytes32("task1"));
        
        vm.prank(agent1);
        registry.claimMission(missionId);

        // Try cancel immediately (should fail)
        vm.prank(client);
        vm.expectRevert("Cannot cancel: mission is claimed and timeout has not elapsed");
        registry.cancelMission(missionId);
    }

    function test_CancelMission_ByClient_Success_AfterTimeout() public {
        // Setup Agent & Guild
        vm.prank(agent1);
        registry.registerAgent("Agent", AGENT_PRICE);
        vm.prank(randomUser);
        registry.createGuild("Guild", "Tech");
        vm.prank(agent1);
        registry.joinGuild(0);

        // Create & Claim
        vm.prank(client);
        uint256 missionId = registry.createMission{value: 1 ether}(0, bytes32("task1"));
        vm.prank(agent1);
        registry.claimMission(missionId);

        // Warp past timeout (30 min + 1 sec)
        vm.warp(block.timestamp + 1801);

        // Cancel should succeed
        uint256 balanceBefore = client.balance;
        vm.prank(client);
        registry.cancelMission(missionId);

        assertEq(client.balance, balanceBefore + 1 ether);
    }

    // =========================
    // DEPOSIT / WITHDRAWAL TESTS
    // =========================

    function test_DepositFunds() public {
        vm.prank(client);
        registry.depositFunds{value: 5 ether}();

        assertEq(registry.userBalances(client), 5 ether);
    }

    function test_CreateMissionFromBalance() public {
        // Setup Guild
        vm.prank(randomUser);
        registry.createGuild("Guild", "Tech");

        // Deposit
        vm.prank(client);
        registry.depositFunds{value: 2 ether}();

        // Create Mission from balance
        vm.prank(client);
        registry.createMissionFromBalance(0, bytes32("task1"), 1.5 ether);

        // Verify balance deduction
        assertEq(registry.userBalances(client), 0.5 ether);

        // Verify mission created
        GuildRegistry.Mission memory m = registry.getMission(0);
        assertEq(m.budget, 1.5 ether);
        assertEq(m.client, client);
    }

    function test_WithdrawFunds() public {
        vm.prank(client);
        registry.depositFunds{value: 5 ether}();

        uint256 balanceBefore = client.balance;
        
        vm.prank(client);
        registry.withdrawFunds(2 ether);

        assertEq(registry.userBalances(client), 3 ether);
        assertEq(client.balance, balanceBefore + 2 ether);
    }

    // =========================
    // AGENT OWNER TESTS
    // =========================

    function test_RegisterAgentWithWallet() public {
        address agentWallet = makeAddr("agentWallet");
        
        vm.prank(agent1); // agent1 acts as owner
        registry.registerAgentWithWallet(agentWallet, "Bot", AGENT_PRICE);

        (address wallet, address owner, string memory cap,,,) = registry.agents(agentWallet);
        
        assertEq(wallet, agentWallet);
        assertEq(owner, agent1);
        assertEq(cap, "Bot");
    }

    function test_UpdateAgent() public {
        vm.prank(agent1);
        registry.registerAgent("Old Cap", 0.1 ether);

        vm.prank(agent1);
        registry.updateAgent(agent1, "New Cap", 0.2 ether);

        (,, string memory cap, uint256 price,,) = registry.agents(agent1);
        assertEq(cap, "New Cap");
        assertEq(price, 0.2 ether);
    }

    // =========================
    // COMPLETION TESTS
    // =========================

    function test_CompleteMission_WithClaimer() public {
        // Full flow: Register -> Join -> Create -> Claim -> Complete
        vm.prank(agent1);
        registry.registerAgent("Agent", AGENT_PRICE);
        vm.prank(randomUser);
        registry.createGuild("Guild", "Tech");
        vm.prank(agent1);
        registry.joinGuild(0);

        vm.prank(client);
        uint256 missionId = registry.createMission{value: 1 ether}(0, bytes32("task1"));

        vm.prank(agent1);
        registry.claimMission(missionId);

        // Prepare completion args
        bytes32[] memory results = new bytes32[](1);
        results[0] = bytes32("result");
        address[] memory recipients = new address[](1);
        recipients[0] = agent1; // Claimer included
        uint256[] memory splits = new uint256[](1);
        splits[0] = 0.85 ether; // v5: max 85% to agents

        vm.prank(coordinator);
        registry.completeMission(missionId, results, recipients, splits);
        
        GuildRegistry.Mission memory m = registry.getMission(missionId);
        assertTrue(m.completed);
    }

    function test_CompleteMission_Revert_ClaimerExcluded() public {
        // Register -> Join -> Create -> Claim
        vm.prank(agent1);
        registry.registerAgent("Agent", AGENT_PRICE);
        vm.prank(randomUser);
        registry.createGuild("Guild", "Tech");
        vm.prank(agent1);
        registry.joinGuild(0);

        vm.prank(client);
        uint256 missionId = registry.createMission{value: 1 ether}(0, bytes32("task1"));

        vm.prank(agent1);
        registry.claimMission(missionId);

        // Prepare completion args with WRONG recipient (agent2 instead of agent1)
        bytes32[] memory results = new bytes32[](1);
        address[] memory recipients = new address[](1);
        recipients[0] = agent2; // Claimer (agent1) NOT included
        uint256[] memory splits = new uint256[](1);
        splits[0] = 0.85 ether; // v5: max 85%

        vm.prank(coordinator);
        vm.expectRevert("Claimed agent must be in recipients");
        registry.completeMission(missionId, results, recipients, splits);
    }

    // =========================
    // V5: BUYBACK TREASURY TESTS
    // =========================

    function test_SetBuybackTreasury() public {
        address treasury = makeAddr("treasury");
        vm.prank(coordinator);
        registry.setBuybackTreasury(treasury);
        assertEq(registry.buybackTreasury(), treasury);
    }

    function test_SetBuybackTreasury_Revert_NotCoordinator() public {
        vm.prank(randomUser);
        vm.expectRevert("Not coordinator");
        registry.setBuybackTreasury(makeAddr("treasury"));
    }

    function test_CompleteMission_FeeSplit_85_10_5() public {
        address treasury = makeAddr("treasury");
        vm.prank(coordinator);
        registry.setBuybackTreasury(treasury);

        vm.prank(agent1);
        registry.registerAgent("Agent", 0);
        vm.prank(randomUser);
        registry.createGuild("Guild", "Tech");
        vm.prank(agent1);
        registry.joinGuild(0);

        vm.prank(client);
        uint256 missionId = registry.createMission{value: 1 ether}(0, bytes32("task1"));
        vm.prank(agent1);
        registry.claimMission(missionId);

        uint256 agentBefore = agent1.balance;
        uint256 treasuryBefore = treasury.balance;
        uint256 feesBefore = registry.totalFeesCollected();

        bytes32[] memory results = new bytes32[](1);
        results[0] = bytes32("result");
        address[] memory recipients = new address[](1);
        recipients[0] = agent1;
        uint256[] memory splits = new uint256[](1);
        splits[0] = 0.85 ether;

        vm.prank(coordinator);
        registry.completeMission(missionId, results, recipients, splits);

        assertEq(agent1.balance, agentBefore + 0.85 ether);
        assertEq(treasury.balance, treasuryBefore + 0.05 ether);
        assertEq(registry.totalFeesCollected(), feesBefore + 0.10 ether);
    }

    function test_CompleteMission_NoTreasury_CoordinatorGetsAll() public {
        vm.prank(agent1);
        registry.registerAgent("Agent", 0);
        vm.prank(randomUser);
        registry.createGuild("Guild", "Tech");
        vm.prank(agent1);
        registry.joinGuild(0);

        vm.prank(client);
        uint256 missionId = registry.createMission{value: 1 ether}(0, bytes32("task1"));
        vm.prank(agent1);
        registry.claimMission(missionId);

        uint256 feesBefore = registry.totalFeesCollected();

        bytes32[] memory results = new bytes32[](1);
        results[0] = bytes32("result");
        address[] memory recipients = new address[](1);
        recipients[0] = agent1;
        uint256[] memory splits = new uint256[](1);
        splits[0] = 0.85 ether;

        vm.prank(coordinator);
        registry.completeMission(missionId, results, recipients, splits);

        // Coordinator gets 10% + 5% buyback (no treasury set)
        assertEq(registry.totalFeesCollected(), feesBefore + 0.15 ether);
    }
}
