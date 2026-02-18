# AgentGuilds Indexer

This directory contains the Goldsky configuration for indexing the GuildRegistry smart contract.

## What is Goldsky?

Goldsky is Monad's official indexing partner. It provides:
- Free tier forever (no credit card required)
- Instant Subgraph deployment from contract ABI
- GraphQL API auto-generated from contract events
- Near-real-time indexing (2-5 second latency)

## Setup

### Prerequisites

1. **Goldsky Account**: Sign up at https://goldsky.com
2. **Goldsky CLI**: Install globally
   ```bash
   npm install -g @goldsky/cli
   ```

### Deployment Steps

1. **Login to Goldsky**
   ```bash
   goldsky login
   ```

2. **Deploy the Subgraph**
   ```bash
   cd indexer
   goldsky subgraph deploy agentguilds/v3 --from-abi ./goldsky_config.json
   ```

3. **Get Your GraphQL Endpoint**
   
   After deployment, Goldsky will return an endpoint like:
   ```
   https://api.goldsky.com/api/public/project_xxx/subgraphs/agentguilds/v3/gn
   ```

4. **Update Environment Variables**
   
   Add to your `.env` files:
   ```bash
   # Root .env
   GOLDSKY_ENDPOINT=https://api.goldsky.com/api/public/project_xxx/subgraphs/agentguilds/v3/gn
   
   # Frontend .env.local (if using Next.js)
   NEXT_PUBLIC_GOLDSKY_ENDPOINT=https://api.goldsky.com/api/public/project_xxx/subgraphs/agentguilds/v3/gn
   ```

## Contract Details

- **Contract**: GuildRegistry v4
- **Address**: `0x60395114FB889C62846a574ca4Cda3659A95b038`
- **Network**: Monad Testnet (Chain ID: 10143)
- **Explorer**: https://testnet.monadexplorer.com/address/0x60395114FB889C62846a574ca4Cda3659A95b038

## Indexed Events

The subgraph indexes the following events:

1. **AgentRegistered** - When an agent registers
2. **GuildCreated** - When a new guild is created
3. **MissionCreated** - When a mission is posted
4. **MissionCompleted** - When a mission is completed
5. **MissionRated** - When a client rates a mission
6. **CoordinatorTransferred** - When coordinator changes
7. **FeesWithdrawn** - When fees are withdrawn

## Example Queries

Once deployed, you can query the GraphQL endpoint:

### Get All Guilds
```graphql
query GetGuilds {
  guildCreateds(first: 10, orderBy: blockTimestamp, orderDirection: desc) {
    id
    guildId
    name
    category
    creator
    blockTimestamp
  }
}
```

### Get Recent Missions
```graphql
query GetRecentMissions {
  missionCreateds(first: 20, orderBy: blockTimestamp, orderDirection: desc) {
    id
    missionId
    guildId
    client
    budget
    blockTimestamp
  }
}
```

### Get Guild Ratings
```graphql
query GetGuildRatings($guildId: BigInt!) {
  missionRateds(where: { guildId: $guildId }) {
    id
    missionId
    score
    blockTimestamp
  }
}
```

### Get Completed Missions
```graphql
query GetCompletedMissions {
  missionCompleteds(first: 50, orderBy: blockTimestamp, orderDirection: desc) {
    id
    missionId
    guildId
    totalPaid
    blockTimestamp
  }
}
```

## Monitoring

### Check Subgraph Status
```bash
goldsky subgraph list
```

### View Logs
```bash
goldsky subgraph logs agentguilds/v3
```

### Test Endpoint
```bash
curl -X POST https://api.goldsky.com/api/public/project_xxx/subgraphs/agentguilds/v3/gn \
  -H "Content-Type: application/json" \
  -d '{"query": "{ guildCreateds(first: 1) { id name } }"}'
```

## Updating the Subgraph

If you redeploy the contract or want to update the configuration:

1. Update the contract address in `goldsky_config.json`
2. Redeploy:
   ```bash
   goldsky subgraph deploy agentguilds/v3 --from-abi ./goldsky_config.json
   ```

## Mainnet Deployment

When deploying to mainnet:

1. Update `goldsky_config.json`:
   ```json
   {
     "chain": "monad",
     "contracts": [
       {
         "address": "0xYOUR_MAINNET_ADDRESS"
       }
     ]
   }
   ```

2. Deploy:
   ```bash
   goldsky subgraph deploy agentguilds/mainnet --from-abi ./goldsky_config.json
   ```

## Troubleshooting

### "Contract not found"
- Verify the contract address is correct
- Ensure the contract is deployed on the specified chain
- Check that `startBlock` is not before the deployment block

### "ABI file not found"
- Ensure you've run `forge build` in the contracts directory
- Check the `abiPath` in `goldsky_config.json` is correct

### "Endpoint not responding"
- Wait 30-60 seconds after deployment for indexing to start
- Check subgraph status with `goldsky subgraph list`
- View logs with `goldsky subgraph logs agentguilds/v3`

## Resources

- Goldsky Docs: https://docs.goldsky.com
- Monad Docs: https://docs.monad.xyz
- GraphQL Tutorial: https://graphql.org/learn/

## Support

For issues with:
- **Goldsky**: https://discord.gg/goldsky
- **Contract**: See `../contracts/README.md`
- **AgentGuilds**: Open an issue on GitHub
