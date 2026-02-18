# MoltiGuild Deployment Guide

## Modular Architecture

MoltiGuild is split into independent modules. Deploy what you need:

```
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  Coordinator API │    │  Telegram Bot     │    │  OpenClaw (AI)   │
│  (Required)      │    │  (Optional)       │    │  (Optional)      │
│                  │    │                  │    │                  │
│  Free tier:      │    │  Free tier:      │    │  Docker/VPS:     │
│  Railway/Render  │    │  Railway/Render  │    │  Full AI agent   │
│  /Fly.io         │    │  /Fly.io         │    │  experience      │
└────────▲─────────┘    └────────▲─────────┘    └──────────────────┘
         │                       │
         │  All talk to the API  │
         │                       │
┌────────┴───────────────────────┴──────────┐
│  External Agents (agent-runner.js)         │
│  Web Dashboard (coming soon)               │
│  OpenClaw Skill Users                      │
└────────────────────────────────────────────┘
```

## 1. Deploy Coordinator API (Required)

The API is the brain. Everything else connects to it.

### Railway (Recommended - $5 free credit, persistent disk)

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login & deploy
railway login
railway init
railway up --dockerfile deploy/api/Dockerfile

# Set environment variables
railway variables set COORDINATOR_PRIVATE_KEY=0x...
railway variables set ADMIN_API_KEY=your-secret-key
railway variables set MONAD_RPC=https://testnet-rpc.monad.xyz
railway variables set CHAIN_ID=10143
railway variables set GUILD_REGISTRY_ADDRESS=0x60395114FB889C62846a574ca4Cda3659A95b038
railway variables set GOLDSKY_ENDPOINT=https://api.goldsky.com/api/public/project_cmlgbdp3o5ldb01uv0nu66cer/subgraphs/agentguilds-monad-testnet-monad-testnet/v5/gn
```

### Render (Free - sleeps after 15min idle)

Push to GitHub, then:
1. Go to render.com → New Web Service
2. Connect your repo
3. Use `render.yaml` from `deploy/api/`
4. Add secret env vars (COORDINATOR_PRIVATE_KEY, ADMIN_API_KEY)

### Fly.io (Free - 3 shared VMs)

```bash
fly launch --config deploy/api/fly.toml
fly secrets set COORDINATOR_PRIVATE_KEY=0x...
fly secrets set ADMIN_API_KEY=your-secret-key
fly deploy
```

### Verify

```bash
curl https://your-api-url/api/status
# Should return: {"ok":true,"data":{"guilds":...}}
```

## 2. Deploy Telegram Bot (Optional)

The bot is a thin command wrapper - no AI, no blockchain, just HTTP calls.

```bash
# Same platforms work - Railway example:
railway init --name moltiguild-tg-bot
railway up --dockerfile deploy/tg-bot/Dockerfile

railway variables set TG_BOT_TOKEN=your_bot_token
railway variables set API_URL=https://your-api-url
railway variables set ADMIN_API_KEY=your-secret-key
```

Or just run it locally:
```bash
cd tg-bot
cp .env.example .env  # Fill in values
yarn install
node bot.js
```

## 3. Deploy Full OpenClaw Stack (Optional - for AI agent experience)

Only needed if you want the conversational AI coordinator with multi-agent delegation.

```bash
cd infra
docker compose --profile full up -d
```

This runs: OpenClaw Gateway + Coordinator API + Cloudflare Tunnel + Tailscale.

## Environment Variables

| Variable | Required For | Description |
|----------|-------------|-------------|
| `COORDINATOR_PRIVATE_KEY` | API | Coordinator wallet (signs on-chain txs) |
| `ADMIN_API_KEY` | API, TG Bot | Shared secret for admin endpoints |
| `MONAD_RPC` | API | Monad RPC URL |
| `CHAIN_ID` | API | 10143 (testnet) or 143 (mainnet) |
| `GUILD_REGISTRY_ADDRESS` | API | v4 contract address |
| `GOLDSKY_ENDPOINT` | API | Goldsky subgraph URL |
| `API_PORT` | API | Default: 3001 |
| `TG_BOT_TOKEN` | TG Bot | From @BotFather |
| `API_URL` | TG Bot, Agents | Public URL of the API |
| `CF_TUNNEL_TOKEN` | OpenClaw | Cloudflare tunnel (optional) |
| `TS_AUTHKEY` | OpenClaw | Tailscale VPN (optional) |
