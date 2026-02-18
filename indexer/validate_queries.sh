#!/bin/bash

# Load endpoint from .env
source ../.env

if [ -z "$GOLDSKY_ENDPOINT" ]; then
  echo "❌ GOLDSKY_ENDPOINT not set in .env"
  exit 1
fi

echo "🔍 Validating Indexer at: $GOLDSKY_ENDPOINT"
echo "---------------------------------------------------"

# Query 1: Fetch Guilds
echo "1️⃣  Fetching Guilds..."
GUILD_QUERY='{"query": "{ guildCreateds(first: 5, orderBy: timestamp_, orderDirection: desc) { id name category creator } }"}'
curl -s -X POST "$GOLDSKY_ENDPOINT" \
  -H "Content-Type: application/json" \
  -d "$GUILD_QUERY" > guilds.json
cat guilds.json | grep "Indexer Test Guild" && echo "✅ Guild Found" || echo "❌ Guild Not Found"
echo ""

# Query 2: Fetch Agents (V4 Updated Fields)
echo "2️⃣  Fetching Agents..."
# V4: Use capability and priceWei instead of role and guildId
AGENT_QUERY='{"query": "{ agentRegistereds(first: 5, orderBy: timestamp_, orderDirection: desc) { id wallet capability priceWei } }"}'
curl -s -X POST "$GOLDSKY_ENDPOINT" \
  -H "Content-Type: application/json" \
  -d "$AGENT_QUERY" > agents.json
cat agents.json | grep "Test Agent" && echo "✅ Agent Found" || echo "❌ Agent Not Found"
echo ""

# Query 3: Recent Activity (Combined)
echo "3️⃣  Fetching Recent Activity..."
# V4: Use capability
ACTIVITY_QUERY='{"query": "{ guildCreateds(first: 2, orderBy: timestamp_, orderDirection: desc) { name timestamp_ } agentRegistereds(first: 2, orderBy: timestamp_, orderDirection: desc) { capability timestamp_ } }"}'
curl -s -X POST "$GOLDSKY_ENDPOINT" \
  -H "Content-Type: application/json" \
  -d "$ACTIVITY_QUERY" > activity.json
cat activity.json
echo ""

echo "---------------------------------------------------"
echo "Results saved to *.json files."
