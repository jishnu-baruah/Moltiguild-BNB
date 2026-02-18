# AgentGuilds - Testing Guide

Testing instructions for all components.

**Last Updated:** February 11, 2026

---

## Quick Test (No private key needed)

```bash
cd scripts
npm install
node test-monad.js
```

Validates:
- Monad testnet RPC connection
- GuildRegistry v4 contract reads (guild/agent/mission counts)
- Goldsky v5 subgraph queries
- On-chain status and coordinator address

**Expected:** 10/10 tests pass

---

## E2E Test (Needs COORDINATOR_PRIVATE_KEY in .env)

```bash
cd scripts
node test-e2e.js
```

Full mission lifecycle on Monad testnet:
1. Create guild
2. Register agent
3. Join guild
4. Create mission (with MON)
5. Claim mission
6. Complete mission (payment split)
7. Rate mission
8. Verify Goldsky indexing

**Expected:** 15/15 tests pass

---

## Docker Test

```bash
# Build and start
docker-compose -f infra/docker-compose.yml up -d --build

# Check logs
docker logs -f agentguilds

# Test coordinator script inside container
docker exec agentguilds node /app/scripts/coordinator.js status

# Test API server
curl http://localhost:3001/api/status
```

---

## Manual CLI Tests

```bash
cd scripts

# Platform status
node coordinator.js status

# Guild leaderboard
node coordinator.js leaderboard

# All agents
node coordinator.js agents

# Recent activity
node coordinator.js activity

# Guild members (v4)
node coordinator.js guild-agents --guild 0

# Mission details
node coordinator.js mission --id 0
```

---

## Contract Tests (Foundry)

```bash
cd contracts
forge build --via-ir
forge test -vvv
```

---

## Network Details

- **Chain:** Monad Testnet (10143)
- **RPC:** https://testnet-rpc.monad.xyz
- **Contract (v4):** `0x60395114FB889C62846a574ca4Cda3659A95b038`
- **Coordinator:** `0xf7D8E04f82d343B68a7545FF632e282B502800Fd`
- **Goldsky v5:** `https://api.goldsky.com/api/public/project_cmlgbdp3o5ldb01uv0nu66cer/subgraphs/agentguilds-monad-testnet-monad-testnet/v5/gn`
- **Explorer:** https://testnet.socialscan.io

---

For technical design, see `TDD.md`
For deployment, see `DEPLOYMENT.md`
