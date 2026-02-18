// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract GuildRegistry is Initializable, UUPSUpgradeable {

    // =========================
    // STRUCTS
    // =========================

    struct Agent {
        address wallet;
        address owner;
        string capability;
        uint256 priceWei;
        uint256 missionsCompleted;
        bool active;
    }

    struct Guild {
        string name;
        string category;
        address creator;
        uint256 totalMissions;
        uint256 totalRatingSum;
        uint256 ratingCount;
        uint256 acceptedMissions;
        uint256 disputedMissions;
        bool active;
    }

    struct Mission {
        address client;
        uint256 guildId;
        bytes32 taskHash;
        uint256 budget;
        uint256 createdAt;
        uint256 completedAt;
        bool completed;
        bool rated;
        uint8 rating;
        bytes32[] resultHashes;
    }

    // =========================
    // STATE
    // =========================

    address public coordinator;

    mapping(uint256 => Guild) public guilds;
    uint256 public guildCount;

    mapping(address => Agent) public agents;
    address[] public agentList;

    Mission[] public missions;

    mapping(string => uint256[]) public guildsByCategory;

    uint256 public totalFeesCollected;

    // V4 New State Variables
    mapping(uint256 => address[]) internal _guildAgents;
    mapping(address => uint256[]) internal _agentGuilds;
    mapping(uint256 => mapping(address => bool)) public isAgentInGuild;
    mapping(address => mapping(uint256 => bool)) internal _agentInGuildCheck;
    
    mapping(uint256 => address) public missionClaims;
    
    mapping(address => uint256) public userBalances;
    
    uint256 public missionTimeout;

    // V5: Buyback treasury
    address public buybackTreasury;

    // =========================
    // EVENTS
    // =========================

    event GuildCreated(
        uint256 indexed guildId,
        string name,
        string category,
        address creator
    );

    event AgentRegistered(
        address indexed wallet,
        string capability,
        uint256 priceWei
    );

    event MissionCreated(
        uint256 indexed missionId,
        address indexed client,
        uint256 indexed guildId,
        bytes32 taskHash,
        uint256 budget
    );

    event MissionCompleted(
        uint256 indexed missionId,
        uint256 indexed guildId,
        bytes32[] resultHashes
    );

    event MissionRated(
        uint256 indexed missionId,
        uint256 indexed guildId,
        uint8 score
    );

    event MissionDisputed(
        uint256 indexed missionId,
        uint256 indexed guildId
    );

    event CoordinatorTransferred(
        address indexed oldCoord,
        address indexed newCoord
    );

    event FeesWithdrawn(
        address indexed to,
        uint256 amount
    );

    // V4 New Events
    event AgentJoinedGuild(address indexed agent, uint256 indexed guildId);
    event AgentLeftGuild(address indexed agent, uint256 indexed guildId);
    event MissionCancelled(uint256 indexed missionId, uint256 refundAmount);
    event MissionClaimed(uint256 indexed missionId, address indexed agent);
    event FundsDeposited(address indexed user, uint256 amount);
    event FundsWithdrawn(address indexed user, uint256 amount);

    // V5 Events
    event BuybackTreasurySet(address indexed oldTreasury, address indexed newTreasury);

    modifier onlyCoordinator() {
        require(msg.sender == coordinator, "Not coordinator");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _coordinator) public initializer {
        coordinator = _coordinator;
        missionTimeout = 1800; // 30 minutes
    }

    function _authorizeUpgrade(address) internal override onlyCoordinator {}

    // =========================
    // GUILD LOGIC
    // =========================

    function createGuild(
        string calldata name,
        string calldata category
    ) external returns (uint256 guildId) {
        require(bytes(name).length > 0, "Empty name");

        guildId = guildCount;

        guilds[guildId] = Guild({
            name: name,
            category: category,
            creator: msg.sender,
            totalMissions: 0,
            totalRatingSum: 0,
            ratingCount: 0,
            acceptedMissions: 0,
            disputedMissions: 0,
            active: true
        });

        guildsByCategory[category].push(guildId);
        guildCount++;

        emit GuildCreated(guildId, name, category, msg.sender);
    }

    // =========================
    // AGENT LOGIC
    // =========================

    function registerAgent(string calldata capability, uint256 priceWei) external {
        require(bytes(capability).length > 0, "Empty capability");
        
        // If updating existing agent, keep mission count
        uint256 currentMissions = 0;
        if (agents[msg.sender].active) {
            currentMissions = agents[msg.sender].missionsCompleted;
        } else {
            agentList.push(msg.sender);
        }

        agents[msg.sender] = Agent({
            wallet: msg.sender,
            owner: msg.sender,
            capability: capability,
            priceWei: priceWei,
            missionsCompleted: currentMissions,
            active: true
        });

        emit AgentRegistered(msg.sender, capability, priceWei);
    }

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
            owner: msg.sender,
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

    // =========================
    // GUILD-AGENT LINKAGE
    // =========================

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

    function getGuildAgents(uint256 guildId) external view returns (address[] memory) {
        require(guildId < guildCount, "Guild does not exist");
        return _guildAgents[guildId];
    }

    function getAgentGuilds(address agent) external view returns (uint256[] memory) {
        require(agents[agent].wallet != address(0), "Not a registered agent");
        return _agentGuilds[agent];
    }

    // =========================
    // MISSION LOGIC
    // =========================

    function createMission(
        uint256 guildId,
        bytes32 taskHash
    ) external payable returns (uint256 missionId) {

        require(msg.value > 0, "Budget must be > 0");
        require(guildId < guildCount, "Invalid guild");
        require(guilds[guildId].active, "Guild inactive");

        missionId = missions.length;

        missions.push();
        Mission storage mission = missions[missionId];

        mission.client = msg.sender;
        mission.guildId = guildId;
        mission.taskHash = taskHash;
        mission.budget = msg.value;
        mission.createdAt = block.timestamp;
        mission.completed = false;
        mission.rated = false;

        guilds[guildId].totalMissions++;

        emit MissionCreated(missionId, msg.sender, guildId, taskHash, msg.value);
    }

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
        uint256 missionId = missions.length;
        
        missions.push();
        Mission storage mission = missions[missionId];
        
        mission.client = msg.sender;
        mission.guildId = guildId;
        mission.taskHash = taskHash;
        mission.budget = budget;
        mission.createdAt = block.timestamp;
        mission.completedAt = 0;
        mission.completed = false;
        mission.rated = false;

        guilds[guildId].totalMissions++;

        emit MissionCreated(missionId, msg.sender, guildId, taskHash, budget);
    }

    function claimMission(uint256 missionId) external {
        // 1. Mission must exist and not be completed
        require(missionId < missions.length, "Mission does not exist");
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

    function cancelMission(uint256 missionId) external {
        // 1. Mission must exist
        require(missionId < missions.length, "Mission does not exist");
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

    function completeMission(
        uint256 missionId,
        bytes32[] calldata resultHashes,
        address[] calldata recipients,
        uint256[] calldata splits
    ) external onlyCoordinator {

        require(missionId < missions.length, "Invalid mission ID");

        Mission storage mission = missions[missionId];

        require(!mission.completed, "Mission already completed");
        require(recipients.length == splits.length, "Length mismatch");
        require(recipients.length > 0, "No recipients");

        // V4 Addition: Check if mission was claimed
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

        // V5: Calculate fee split (85% agents, 10% coordinator, 5% buyback)
        uint256 buybackFee = mission.budget * 5 / 100;
        uint256 protocolFee = mission.budget * 10 / 100;
        uint256 agentPool = mission.budget - protocolFee - buybackFee;

        // Verify splits don't exceed agent pool
        uint256 totalSplit = 0;
        for (uint256 i = 0; i < splits.length; i++) {
            require(recipients[i] != address(0), "Zero recipient");
            unchecked { totalSplit += splits[i]; }
        }
        require(totalSplit <= agentPool, "Splits exceed agent pool");

        mission.completed = true;
        mission.completedAt = block.timestamp;
        mission.resultHashes = resultHashes;

        guilds[mission.guildId].acceptedMissions++;

        // Protocol fee (coordinator keeps remainder if splits < agentPool)
        uint256 coordinatorFee = protocolFee + (agentPool - totalSplit);
        totalFeesCollected += coordinatorFee;

        // V5: Send buyback fee to treasury
        if (buybackTreasury != address(0) && buybackFee > 0) {
            (bool bbSuccess, ) = payable(buybackTreasury).call{value: buybackFee}("");
            require(bbSuccess, "Buyback transfer failed");
        } else {
            totalFeesCollected += buybackFee;
        }

        // Pay agents
        for (uint256 i = 0; i < recipients.length; i++) {
            if (agents[recipients[i]].active) {
                agents[recipients[i]].missionsCompleted++;
            }
            if (splits[i] > 0) {
                (bool success, ) = recipients[i].call{value: splits[i]}("");
                require(success, "Transfer failed");
            }
        }

        emit MissionCompleted(missionId, mission.guildId, resultHashes);
    }

    // =========================
    // DEPOSIT / WITHDRAWAL
    // =========================

    function depositFunds() external payable {
        require(msg.value > 0, "Must deposit something");

        userBalances[msg.sender] += msg.value;

        emit FundsDeposited(msg.sender, msg.value);
    }

    function withdrawFunds(uint256 amount) external {
        require(amount > 0, "Amount must be > 0");
        require(userBalances[msg.sender] >= amount, "Insufficient balance");

        userBalances[msg.sender] -= amount;

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Withdraw transfer failed");

        emit FundsWithdrawn(msg.sender, amount);
    }

    // =========================
    // RATING LOGIC
    // =========================

    function rateMission(uint256 missionId, uint8 score) external {

        require(score >= 1 && score <= 5, "Invalid score");
        require(missionId < missions.length, "Invalid mission");

        Mission storage mission = missions[missionId];

        require(mission.completed, "Not completed");
        require(msg.sender == mission.client, "Not client");
        require(!mission.rated, "Already rated");

        mission.rated = true;
        mission.rating = score;

        Guild storage guild = guilds[mission.guildId];

        guild.totalRatingSum += score;
        guild.ratingCount += 1;

        emit MissionRated(missionId, mission.guildId, score);
    }

    // =========================
    // ADMIN
    // =========================

    function withdrawFees(address payable to) external onlyCoordinator {
        require(to != address(0), "Invalid address");
        require(totalFeesCollected > 0, "No fees");

        uint256 amount = totalFeesCollected;
        totalFeesCollected = 0;

        (bool success, ) = to.call{value: amount}("");
        require(success, "Withdraw failed");

        emit FeesWithdrawn(to, amount);
    }

    function transferCoordinator(address newCoordinator) external onlyCoordinator {
        require(newCoordinator != address(0), "Invalid address");

        address oldCoordinator = coordinator;
        coordinator = newCoordinator;

        emit CoordinatorTransferred(oldCoordinator, newCoordinator);
    }

    function setBuybackTreasury(address _treasury) external onlyCoordinator {
        address old = buybackTreasury;
        buybackTreasury = _treasury;
        emit BuybackTreasurySet(old, _treasury);
    }

    // =========================
    // VIEWS
    // =========================

    function getMission(uint256 missionId)
        external
        view
        returns (Mission memory)
    {
        require(missionId < missions.length, "Invalid mission ID");
        return missions[missionId];
    }

    function getGuild(uint256 guildId)
        external
        view
        returns (Guild memory)
    {
        require(guildId < guildCount, "Invalid guild");
        return guilds[guildId];
    }

    function getGuildReputation(uint256 guildId)
        external
        view
        returns (
            uint256 avgRatingScaled,
            uint256 totalMissions
        )
    {
        require(guildId < guildCount, "Invalid guild");

        Guild storage guild = guilds[guildId];

        if (guild.ratingCount == 0) {
            return (0, guild.totalMissions);
        }

        avgRatingScaled =
            (guild.totalRatingSum * 100) /
            guild.ratingCount;

        return (avgRatingScaled, guild.totalMissions);
    }

    function getMissionCount() external view returns (uint256) {
        return missions.length;
    }

    function getAgentCount() external view returns (uint256) {
        return agentList.length;
    }

    function getAgentList() external view returns (address[] memory) {
        return agentList;
    }
}
