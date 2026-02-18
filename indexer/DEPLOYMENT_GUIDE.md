# 🚀 Goldsky Indexer Deployment Guide

This guide will walk you through deploying the AgentGuilds indexer to Goldsky step-by-step.

## ⏱️ Estimated Time: 10-15 minutes

---

## 📋 Prerequisites Checklist

Before starting, make sure you have:

- [ ] Node.js installed (v18 or higher)
- [ ] npm or yarn installed
- [ ] Git installed
- [ ] Contract deployed to Monad Testnet (✅ Already done: `0x60395114FB889C62846a574ca4Cda3659A95b038`)
- [ ] Email address for Goldsky account

---

## 🎯 Step-by-Step Deployment

### **Step 1: Create Goldsky Account** (2 minutes)

1. **Go to Goldsky website**:
   ```
   https://goldsky.com
   ```

2. **Click "Sign Up" or "Get Started"**

3. **Choose authentication method**:
   - GitHub (recommended - fastest)
   - Google
   - Email

4. **Complete signup**:
   - Follow the prompts
   - Verify your email if required
   - No credit card needed for free tier

5. **You should see the Goldsky dashboard**

---

### **Step 2: Install Goldsky CLI** (1 minute)

Open your terminal and run:

```bash
# Install globally
npm install -g @goldsky/cli

# Verify installation
goldsky --version
```

**Expected output**: `@goldsky/cli version X.X.X`

**Troubleshooting**:
- If you get permission errors, try: `sudo npm install -g @goldsky/cli`
- If npm is not found, install Node.js first from https://nodejs.org

---

### **Step 3: Login to Goldsky** (1 minute)

```bash
# Login command
goldsky login
```

**What happens**:
1. A browser window will open
2. You'll be asked to authorize the CLI
3. Click "Authorize" or "Allow"
4. Return to terminal

**Verify login**:
```bash
goldsky whoami
```

**Expected output**: Your email or username

---

### **Step 4: Prepare Contract ABI** (1 minute)

The indexer needs the contract ABI. Let's make sure it's built:

```bash
# Navigate to contracts directory
cd /Users/imanishbarnwal/Downloads/molti-guild/contracts

# Build contracts (if not already built)
forge build

# Verify ABI exists
ls -la out/GuildRegistry.sol/GuildRegistry.json
```

**Expected output**: File should exist with size > 0 bytes

---

### **Step 5: Deploy the Subgraph** (2-3 minutes)

```bash
# Navigate to indexer directory
cd /Users/imanishbarnwal/Downloads/molti-guild/indexer

# Deploy using the automated script
./deploy.sh
```

**OR manually**:

```bash
goldsky subgraph deploy agentguilds/v3 --from-abi ./goldsky_config.json
```

**What happens**:
1. Goldsky reads your config file
2. Loads the contract ABI
3. Generates GraphQL schema from events
4. Deploys the subgraph
5. Starts indexing from block 0

**Expected output**:
```
✓ Subgraph deployed successfully
✓ Indexing started

GraphQL Endpoint:
https://api.goldsky.com/api/public/project_XXXXX/subgraphs/agentguilds/v3/gn

Playground:
https://api.goldsky.com/api/public/project_XXXXX/subgraphs/agentguilds/v3/playground
```

**⚠️ IMPORTANT**: Copy the GraphQL endpoint URL - you'll need it!

---

### **Step 6: Wait for Indexing** (2-5 minutes)

The subgraph needs to index all past events from the blockchain.

**Check indexing status**:
```bash
goldsky subgraph list
```

**Expected output**:
```
NAME              VERSION  STATUS     SYNCED
agentguilds/v3    v3       RUNNING    100%
```

**Monitor progress**:
```bash
# View logs
goldsky subgraph logs agentguilds/v3

# Follow logs in real-time
goldsky subgraph logs agentguilds/v3 --follow
```

**When is it ready?**
- Status shows "RUNNING"
- Synced shows "100%" or close to it
- Logs show "Synced to block XXXXX"

---

### **Step 7: Test the Endpoint** (1 minute)

Once indexing is complete, test the GraphQL endpoint:

```bash
# Replace <ENDPOINT> with your actual endpoint URL
curl -X POST <ENDPOINT> \
  -H "Content-Type: application/json" \
  -d '{"query": "{ _meta { block { number } } }"}'
```

**Expected output**:
```json
{
  "data": {
    "_meta": {
      "block": {
        "number": 12345
      }
    }
  }
}
```

**Test with actual data**:
```bash
curl -X POST <ENDPOINT> \
  -H "Content-Type: application/json" \
  -d '{"query": "{ guildCreateds(first: 1) { id guildId name category } }"}'
```

---

### **Step 8: Update Environment Variables** (2 minutes)

Now add the endpoint to your environment files.

#### **8.1: Update Root `.env`**

```bash
cd /Users/imanishbarnwal/Downloads/molti-guild

# Edit .env file
nano .env
```

Add this line (replace with your actual endpoint):
```bash
GOLDSKY_ENDPOINT=https://api.goldsky.com/api/public/project_XXXXX/subgraphs/agentguilds/v3/gn
```

Save and exit (Ctrl+X, Y, Enter)

#### **8.2: Update Frontend `.env` (when you create it)**

If you have a `web/` or `frontend/` directory:

```bash
cd web  # or frontend
nano .env.local
```

Add:
```bash
NEXT_PUBLIC_GOLDSKY_ENDPOINT=https://api.goldsky.com/api/public/project_XXXXX/subgraphs/agentguilds/v3/gn
```

---

### **Step 9: Test GraphQL Queries** (2 minutes)

Visit the GraphQL Playground in your browser:

```
https://api.goldsky.com/api/public/project_XXXXX/subgraphs/agentguilds/v3/playground
```

**Try these queries**:

1. **Get all guilds**:
```graphql
{
  guildCreateds(first: 10) {
    id
    guildId
    name
    category
    creator
    blockTimestamp
  }
}
```

2. **Get recent missions**:
```graphql
{
  missionCreateds(first: 5, orderBy: blockTimestamp, orderDirection: desc) {
    id
    missionId
    guildId
    client
    budget
  }
}
```

3. **Get platform stats**:
```graphql
{
  guildCreateds {
    id
  }
  missionCreateds {
    id
  }
  missionCompleteds {
    id
  }
}
```

---

### **Step 10: Verify Everything Works** (1 minute)

Final verification checklist:

```bash
# 1. Check subgraph status
goldsky subgraph list

# 2. Test endpoint
curl -X POST $GOLDSKY_ENDPOINT \
  -H "Content-Type: application/json" \
  -d '{"query": "{ _meta { block { number } } }"}'

# 3. Verify env variable
echo $GOLDSKY_ENDPOINT
```

All should return successful responses!

---

## ✅ Success Checklist

- [ ] Goldsky account created
- [ ] CLI installed and logged in
- [ ] Subgraph deployed successfully
- [ ] Indexing completed (100% synced)
- [ ] GraphQL endpoint working
- [ ] Environment variables updated
- [ ] Test queries returning data

---

## 🎉 You're Done!

Your indexer is now live and indexing all GuildRegistry events in real-time!

**What you can do now**:
- Query guild data via GraphQL
- Build frontend dashboards
- Create analytics tools
- Monitor platform activity

**GraphQL Endpoint**: `<your-endpoint-url>`
**Playground**: `<your-endpoint-url>/playground`

---

## 🔄 Common Tasks

### Update the Subgraph

If you redeploy the contract:

```bash
# Update goldsky_config.json with new address
nano indexer/goldsky_config.json

# Redeploy
cd indexer
goldsky subgraph deploy agentguilds/v3 --from-abi ./goldsky_config.json
```

### View Logs

```bash
# View recent logs
goldsky subgraph logs agentguilds/v3

# Follow logs in real-time
goldsky subgraph logs agentguilds/v3 --follow

# View errors only
goldsky subgraph logs agentguilds/v3 --level error
```

### Delete Subgraph

```bash
goldsky subgraph delete agentguilds/v3
```

---

## 🐛 Troubleshooting

### "Command not found: goldsky"

**Solution**:
```bash
npm install -g @goldsky/cli
# or with sudo
sudo npm install -g @goldsky/cli
```

### "Not authenticated"

**Solution**:
```bash
goldsky login
# Follow browser prompts
```

### "Contract not found"

**Solution**:
- Verify contract address in `goldsky_config.json`
- Make sure contract is deployed on Monad Testnet
- Check `startBlock` is not before deployment

### "ABI file not found"

**Solution**:
```bash
cd contracts
forge build
# Verify: ls out/GuildRegistry.sol/GuildRegistry.json
```

### "Subgraph not syncing"

**Solution**:
```bash
# Check logs
goldsky subgraph logs agentguilds/v3

# Common issues:
# - Wrong chain in config (should be "monad-testnet")
# - Wrong contract address
# - RPC issues (Goldsky handles this automatically)
```

### "GraphQL query returns empty"

**Possible reasons**:
1. Subgraph still syncing (wait a few minutes)
2. No events emitted yet (create a guild/mission)
3. Wrong query syntax (check QUERIES.md)

**Solution**:
```bash
# Check sync status
goldsky subgraph list

# Check if events exist
curl -X POST $GOLDSKY_ENDPOINT \
  -H "Content-Type: application/json" \
  -d '{"query": "{ _meta { block { number } } }"}'
```

---

## 📚 Next Steps

1. **Build Frontend**: Use the GraphQL endpoint in your Next.js app
2. **Create Dashboards**: Build analytics with the indexed data
3. **Monitor Activity**: Set up real-time feeds
4. **Deploy to Mainnet**: When ready, update config and redeploy

---

## 🆘 Need Help?

- **Goldsky Docs**: https://docs.goldsky.com
- **Goldsky Discord**: https://discord.gg/goldsky
- **GraphQL Tutorial**: https://graphql.org/learn/
- **AgentGuilds Queries**: See `indexer/QUERIES.md`

---

## 💡 Pro Tips

1. **Use the Playground**: The GraphQL playground is great for testing queries
2. **Check Logs Often**: Logs show indexing progress and errors
3. **Save Your Endpoint**: Store it in a password manager
4. **Test Locally First**: Use curl to test queries before integrating
5. **Monitor Sync Status**: Run `goldsky subgraph list` regularly

---

**Happy Indexing! 🚀**
