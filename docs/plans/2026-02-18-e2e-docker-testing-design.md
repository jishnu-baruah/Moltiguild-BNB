# E2E Docker Deployment Testing Design

**Date:** 2026-02-18
**Scope:** Full stack local + DigitalOcean deployment with Cloudflare Tunnel

## Architecture Under Test

```
Internet -> Cloudflare Tunnel -> Docker Network
                                  +-- web (Next.js :3000)
                                  +-- api (Express :3001)
                                  +-- openclaw (Gateway :18789)
                                  +-- tg-bot (Grammy)
                                  +-- agent-fleet (agents)
                                  +-- cloudflared (tunnel)
```

Chain: BSC Testnet (chain ID 97)
Contract: GuildRegistry v5 (UUPS Proxy)
Coordinator: 0xf7D8E04f82d343B68a7545FF632e282B502800Fd

## Phase 1: Fix Blockers

### 1a. Broken Dockerfiles
- `deploy/agent-fleet/Dockerfile` references `scripts/package-lock.json` (doesn't exist, only yarn.lock)
- `deploy/agent/Dockerfile` references non-existent `agent-worker.js` (dead file)

### 1b. .env Configuration
Current .env has Monad testnet values. Fix all blockchain vars for BSC testnet:
- MONAD_RPC -> BSC testnet RPC
- CHAIN_ID -> 97
- GUILD_REGISTRY_ADDRESS -> TBD (after deploy)
- GOLDSKY_ENDPOINT -> empty (RPC fallback)
- All NEXT_PUBLIC_* vars -> BSC values

### 1c. Docker Compose Healthcheck
Change API healthcheck from `/api/status` (calls chain) to `/health` (lightweight)

## Phase 2: Fund + Deploy Contract

1. Fund coordinator wallet with tBNB via BSC faucet
2. Deploy GuildRegistry via `forge script contracts/script/DeployGuildRegistry.s.sol`
3. Update .env with proxy address

## Phase 3: Docker Build + Local Test

1. `docker compose -f infra/docker-compose.yml build`
2. `docker compose up` (default: api + web + cloudflared)
3. Verify: `curl localhost:3001/api/status` -> chain_id 97
4. Verify: `curl localhost:3000` -> HTML
5. `--profile full` -> add openclaw + tg-bot
6. `--profile agents` -> add agent-fleet

## Phase 4: Seed On-Chain Data

1. Generate seeder mnemonic
2. Fund agent wallets with tBNB
3. `node scripts/seeder.js` -> 50 guilds, ~95 agents, ~200 missions
4. `node scripts/seeder.js --join` -> agents join guilds

## Phase 5: Full Stack Validation

- API: /api/guilds, /api/agents/online, /api/missions/open, /api/status
- Mission lifecycle: smart-create -> claim -> complete -> rate
- Frontend loads and proxies API calls
- OpenClaw gateway responds on :18789

## Phase 6: DigitalOcean Deployment

1. Push to GitHub
2. Provision droplet, run `infra/digitalocean-setup.sh`
3. Copy .env, `docker compose --profile full --profile agents up -d`
4. Configure Cloudflare Tunnel routes
5. Verify public URLs

## Success Criteria

- All 5 Docker images build without errors
- API returns status with chain_id 97 and valid contract address
- Web serves frontend and proxies /api/* to the API container
- OpenClaw gateway starts and connects to API on Docker internal network
- Agent-fleet connects and shows online agents
- Seeded data visible via API endpoints
- DigitalOcean droplet runs full stack behind Cloudflare Tunnel
