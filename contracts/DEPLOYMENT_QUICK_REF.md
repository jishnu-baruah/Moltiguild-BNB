# 🚀 GuildRegistry - Quick Deployment Reference (v3)

## Contract Address
```
0x90f3608bfFae5D80F74F7070C670C6C3E3370098
```

## Network Details
- **Network**: Monad Testnet
- **Chain ID**: 10143
- **RPC URL**: https://testnet-rpc.monad.xyz
- **Explorer**: https://testnet.monad.xyz/address/0x90f3608bfFae5D80F74F7070C670C6C3E3370098

## Version
- **Version**: v3 (Guild System + Enhanced Views)
- **Date**: February 10, 2026
- **What's New**: Guild system, ratings, enhanced view functions

## Coordinator
```
0xf7D8E04f82d343B68a7545FF632e282B502800Fd
```

## Deployment Stats
- **Gas Used**: 4,291,537
- **Cost**: 0.437736774 ETH

## ⚠️ Previous Versions (DO NOT USE)
```
0xB11cCF616175f8Aa66f02C30A57Eb5a1ED8513A1 (v2 - no guild system)
0xA62699fE1d7e6aFBC149897E5Ef5Ad5A82C49023 (v1 - has withdrawFees() bug)
```

## Quick Commands

### View State
```bash
# Coordinator
cast call 0x90f3608bfFae5D80F74F7070C670C6C3E3370098 "coordinator()" --rpc-url https://testnet-rpc.monad.xyz

# Guild Count
cast call 0x90f3608bfFae5D80F74F7070C670C6C3E3370098 "guildCount()" --rpc-url https://testnet-rpc.monad.xyz

# Mission Count
cast call 0x90f3608bfFae5D80F74F7070C670C6C3E3370098 "getMissionCount()" --rpc-url https://testnet-rpc.monad.xyz

# Agent Count
cast call 0x90f3608bfFae5D80F74F7070C670C6C3E3370098 "getAgentCount()" --rpc-url https://testnet-rpc.monad.xyz
```

### Create Guild
```bash
cast send 0x90f3608bfFae5D80F74F7070C670C6C3E3370098 \
  "createGuild(string,string)" \
  "Meme Lords" "meme" \
  --rpc-url https://testnet-rpc.monad.xyz \
  --private-key $DEPLOYER_PRIVATE_KEY --legacy
```

### Register Agent
```bash
cast send 0x90f3608bfFae5D80F74F7070C670C6C3E3370098 \
  "registerAgent(string,uint256)" \
  "AI Researcher" 1000000000000000000 \
  --rpc-url https://testnet-rpc.monad.xyz \
  --private-key $DEPLOYER_PRIVATE_KEY --legacy
```

### Create Mission
```bash
cast send 0x90f3608bfFae5D80F74F7070C670C6C3E3370098 \
  "createMission(uint256,bytes32)" \
  0 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef \
  --value 5ether \
  --rpc-url https://testnet-rpc.monad.xyz \
  --private-key $DEPLOYER_PRIVATE_KEY --legacy
```

## Status
✅ **DEPLOYED & VERIFIED (v3)**
- Coordinator: Active
- Guild System: Enabled
- Rating System: Enabled
- Enhanced Views: getMission (with guildId), getGuild
- Ready for use!
