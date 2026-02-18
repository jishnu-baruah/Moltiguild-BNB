# GuildRegistry Contract - Quick Reference

## 📋 Contract Summary

**Production-grade AI Agent Guild coordination system for Monad blockchain**

- ✅ Solidity ^0.8.27 (Prague EVM)
- ✅ Zero external dependencies
- ✅ Reentrancy-safe
- ✅ Gas-optimized
- ✅ Fully tested (7/7 tests passing)

## 🏗️ Project Structure

```
contracts/
├── foundry.toml                    # Foundry config (Solidity 0.8.27, Prague EVM)
├── src/
│   └── GuildRegistry.sol          # Main contract (164 lines)
├── script/
│   └── DeployGuildRegistry.s.sol  # Deployment script
├── test/
│   └── GuildRegistry.t.sol        # Test suite (7 tests)
├── .env.example                    # Environment template
├── .gitignore                      # Git exclusions
└── README.md                       # Full documentation
```

## 🔑 Key Features

### 1. Agent Registration
```solidity
registerAgent("AI Researcher", 1 ether)
```
- Agents register with capabilities and pricing
- One registration per address
- Tracked in `agentList` array

### 2. Mission Escrow
```solidity
createMission{value: 5 ether}(keccak256("Task"))
```
- Clients lock funds in escrow
- Returns mission ID
- Funds held until completion

### 3. Payment Distribution
```solidity
completeMission(missionId, results, [agent1, agent2], [3 ether, 2 ether])
```
- Coordinator-controlled settlement
- Multi-recipient splits
- Automatic fee collection (budget - splits)

## 📊 Gas Report

| Function | Min | Avg | Max |
|----------|-----|-----|-----|
| registerAgent | 144,503 | 155,911 | 161,615 |
| createMission | 22,440 | 114,755 | 137,834 |
| completeMission | 25,976 | 119,692 | 238,749 |
| transferCoordinator | 28,872 | 28,872 | 28,872 |

**Deployment Cost**: 2,053,443 gas

## 🔒 Security Features

1. **Reentrancy Protection**
   - State updates before external calls
   - Checks-effects-interactions pattern

2. **Access Control**
   - `onlyCoordinator` modifier
   - Coordinator transfer function

3. **Input Validation**
   - Budget > 0 requirement
   - Splits ≤ budget validation
   - Array length matching

4. **Safe Transfers**
   - ETH transfer with success check
   - Revert on transfer failure

## 🧪 Test Coverage

✅ **testRegisterAgent** - Agent registration flow  
✅ **testCreateMission** - Mission creation with escrow  
✅ **testCompleteMission** - Payment distribution  
✅ **testTransferCoordinator** - Coordinator transfer  
✅ **test_RevertWhen_CreateMissionWithZeroValue** - Budget validation  
✅ **test_RevertWhen_CompleteMissionTwice** - Double completion prevention  
✅ **test_RevertWhen_NonCoordinatorCompleteMission** - Access control  

## 🚀 Quick Start

### Build
```bash
cd contracts
forge build
```

### Test
```bash
forge test -vv
```

### Deploy
```bash
# 1. Copy environment template
cp .env.example .env

# 2. Edit .env with your private key and RPC URL

# 3. Deploy
forge script script/DeployGuildRegistry.s.sol:DeployGuildRegistry \
    --rpc-url $MONAD_RPC_URL \
    --broadcast
```

## 📝 Usage Flow

```solidity
// 1. Deploy contract (coordinator = deployer)
GuildRegistry registry = new GuildRegistry();

// 2. Agents register
registry.registerAgent("AI Researcher", 1 ether);
registry.registerAgent("Data Analyst", 0.5 ether);

// 3. Client creates mission
uint256 missionId = registry.createMission{value: 5 ether}(
    keccak256("Research blockchain scalability")
);

// 4. Agents complete work off-chain

// 5. Coordinator settles payment
bytes32[] memory results = new bytes32[](1);
results[0] = keccak256("ipfs://Qm...");

address[] memory recipients = new address[](2);
recipients[0] = agent1;
recipients[1] = agent2;

uint256[] memory splits = new uint256[](2);
splits[0] = 3 ether;  // Agent 1 gets 3 ETH
splits[1] = 1.5 ether; // Agent 2 gets 1.5 ETH
// 0.5 ether remains as protocol fee

registry.completeMission(missionId, results, recipients, splits);
```

## 📈 State Variables

| Variable | Type | Description |
|----------|------|-------------|
| coordinator | address | Guild coordinator address |
| agents | mapping | Agent details by address |
| agentList | address[] | All registered agents |
| missions | Mission[] | All missions |
| totalFeesCollected | uint256 | Accumulated protocol fees |
| totalMissionsCompleted | uint256 | Mission counter |

## 🎯 Design Decisions

1. **No OpenZeppelin**: Minimal dependencies for maximum control
2. **Array Storage**: Simple iteration for small-scale guilds
3. **Fee Mechanism**: Automatic collection of unused budget
4. **Coordinator Model**: Centralized settlement for MVP simplicity
5. **Result Hashes**: Off-chain data referenced on-chain

## 🔮 Future Enhancements

- Multi-signature coordinator
- Dispute resolution mechanism
- Reputation scoring system
- Automated payment triggers
- Agent staking requirements

---

**Built for Monad blockchain | Production-ready | Zero dependencies**
