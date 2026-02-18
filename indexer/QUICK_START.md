# 🚀 Goldsky Quick Start - TL;DR

## 3-Step Deployment

```bash
# 1. Install & Login
npm install -g @goldsky/cli
goldsky login

# 2. Deploy
cd indexer
./deploy.sh

# 3. Copy endpoint & add to .env
GOLDSKY_ENDPOINT=<your-endpoint-url>
```

## Contract Info
- **Address**: `0x90f3608bfFae5D80F74F7070C670C6C3E3370098`
- **Network**: Monad Testnet (Chain ID: 10143)
- **Version**: v3 (Guild System)

## Useful Commands

```bash
# Check status
goldsky subgraph list

# View logs
goldsky subgraph logs agentguilds/v3

# Test endpoint
curl -X POST $GOLDSKY_ENDPOINT \
  -H "Content-Type: application/json" \
  -d '{"query": "{ _meta { block { number } } }"}'
```

## Quick Test Query

```graphql
{
  guildCreateds(first: 5) {
    id
    guildId
    name
    category
  }
}
```

## Links
- **Full Guide**: See `DEPLOYMENT_GUIDE.md`
- **Queries**: See `QUERIES.md`
- **Goldsky**: https://goldsky.com
- **Docs**: https://docs.goldsky.com

## Troubleshooting

| Problem | Solution |
|---------|----------|
| CLI not found | `npm install -g @goldsky/cli` |
| Not logged in | `goldsky login` |
| ABI not found | `cd contracts && forge build` |
| Empty results | Wait for sync or create test data |

---

**Need detailed help?** → Read `DEPLOYMENT_GUIDE.md`
