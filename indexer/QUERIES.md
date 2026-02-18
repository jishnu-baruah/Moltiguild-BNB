# AgentGuilds GraphQL Queries

This file contains example queries for the Goldsky subgraph.

## Setup

Replace `<GOLDSKY_ENDPOINT>` with your actual endpoint URL.

## Guilds

### Get All Guilds
```graphql
query GetAllGuilds {
  guildCreateds(
    first: 100
    orderBy: blockTimestamp
    orderDirection: desc
  ) {
    id
    guildId
    name
    category
    creator
    blockTimestamp
    transactionHash
  }
}
```

### Get Guilds by Category
```graphql
query GetGuildsByCategory($category: String!) {
  guildCreateds(
    where: { category: $category }
    orderBy: blockTimestamp
    orderDirection: desc
  ) {
    id
    guildId
    name
    category
    creator
    blockTimestamp
  }
}
```

### Get Single Guild
```graphql
query GetGuild($guildId: BigInt!) {
  guildCreateds(where: { guildId: $guildId }) {
    id
    guildId
    name
    category
    creator
    blockTimestamp
    transactionHash
  }
}
```

## Missions

### Get All Missions
```graphql
query GetAllMissions {
  missionCreateds(
    first: 100
    orderBy: blockTimestamp
    orderDirection: desc
  ) {
    id
    missionId
    guildId
    client
    budget
    blockTimestamp
    transactionHash
  }
}
```

### Get Missions by Guild
```graphql
query GetMissionsByGuild($guildId: BigInt!) {
  missionCreateds(
    where: { guildId: $guildId }
    orderBy: blockTimestamp
    orderDirection: desc
  ) {
    id
    missionId
    guildId
    client
    budget
    blockTimestamp
  }
}
```

### Get Missions by Client
```graphql
query GetMissionsByClient($client: String!) {
  missionCreateds(
    where: { client: $client }
    orderBy: blockTimestamp
    orderDirection: desc
  ) {
    id
    missionId
    guildId
    client
    budget
    blockTimestamp
  }
}
```

### Get Completed Missions
```graphql
query GetCompletedMissions {
  missionCompleteds(
    first: 100
    orderBy: blockTimestamp
    orderDirection: desc
  ) {
    id
    missionId
    guildId
    totalPaid
    blockTimestamp
    transactionHash
  }
}
```

### Get Mission with Completion Status
```graphql
query GetMissionDetails($missionId: BigInt!) {
  missionCreateds(where: { missionId: $missionId }) {
    id
    missionId
    guildId
    client
    budget
    blockTimestamp
  }
  
  missionCompleteds(where: { missionId: $missionId }) {
    id
    missionId
    totalPaid
    blockTimestamp
  }
  
  missionRateds(where: { missionId: $missionId }) {
    id
    score
    blockTimestamp
  }
}
```

## Ratings

### Get All Ratings
```graphql
query GetAllRatings {
  missionRateds(
    first: 100
    orderBy: blockTimestamp
    orderDirection: desc
  ) {
    id
    missionId
    guildId
    score
    blockTimestamp
    transactionHash
  }
}
```

### Get Ratings by Guild
```graphql
query GetGuildRatings($guildId: BigInt!) {
  missionRateds(
    where: { guildId: $guildId }
    orderBy: blockTimestamp
    orderDirection: desc
  ) {
    id
    missionId
    score
    blockTimestamp
  }
}
```

### Calculate Guild Average Rating
```graphql
query GetGuildRatingStats($guildId: BigInt!) {
  missionRateds(where: { guildId: $guildId }) {
    score
  }
}
```

## Agents

### Get All Registered Agents
```graphql
query GetAllAgents {
  agentRegistereds(
    first: 100
    orderBy: blockTimestamp
    orderDirection: desc
  ) {
    id
    agent
    capability
    priceWei
    blockTimestamp
    transactionHash
  }
}
```

### Get Agent by Address
```graphql
query GetAgent($agent: String!) {
  agentRegistereds(
    where: { agent: $agent }
    orderBy: blockTimestamp
    orderDirection: desc
    first: 1
  ) {
    id
    agent
    capability
    priceWei
    blockTimestamp
  }
}
```

## Statistics

### Get Platform Stats
```graphql
query GetPlatformStats {
  guildCreateds {
    id
  }
  
  missionCreateds {
    id
  }
  
  missionCompleteds {
    id
  }
  
  agentRegistereds {
    id
  }
}
```

### Get Recent Activity
```graphql
query GetRecentActivity {
  guildCreateds(first: 5, orderBy: blockTimestamp, orderDirection: desc) {
    id
    name
    blockTimestamp
  }
  
  missionCreateds(first: 10, orderBy: blockTimestamp, orderDirection: desc) {
    id
    missionId
    guildId
    blockTimestamp
  }
  
  missionCompleteds(first: 10, orderBy: blockTimestamp, orderDirection: desc) {
    id
    missionId
    blockTimestamp
  }
  
  missionRateds(first: 10, orderBy: blockTimestamp, orderDirection: desc) {
    id
    missionId
    score
    blockTimestamp
  }
}
```

### Get Guild Leaderboard
```graphql
query GetGuildLeaderboard {
  guildCreateds(orderBy: blockTimestamp, orderDirection: asc) {
    id
    guildId
    name
    category
  }
}
```

## Fees & Admin

### Get Fee Withdrawals
```graphql
query GetFeeWithdrawals {
  feesWithdrawns(
    orderBy: blockTimestamp
    orderDirection: desc
  ) {
    id
    to
    amount
    blockTimestamp
    transactionHash
  }
}
```

### Get Coordinator Transfers
```graphql
query GetCoordinatorTransfers {
  coordinatorTransferreds(
    orderBy: blockTimestamp
    orderDirection: desc
  ) {
    id
    oldCoordinator
    newCoordinator
    blockTimestamp
    transactionHash
  }
}
```

## Combined Queries

### Get Guild Dashboard Data
```graphql
query GetGuildDashboard($guildId: BigInt!) {
  # Guild info
  guildCreateds(where: { guildId: $guildId }) {
    id
    guildId
    name
    category
    creator
    blockTimestamp
  }
  
  # All missions
  missionCreateds(where: { guildId: $guildId }) {
    id
    missionId
    client
    budget
    blockTimestamp
  }
  
  # Completed missions
  missionCompleteds(where: { guildId: $guildId }) {
    id
    missionId
    totalPaid
    blockTimestamp
  }
  
  # Ratings
  missionRateds(where: { guildId: $guildId }) {
    id
    missionId
    score
    blockTimestamp
  }
}
```

### Get Client Dashboard Data
```graphql
query GetClientDashboard($client: String!) {
  # Missions created
  missionCreateds(
    where: { client: $client }
    orderBy: blockTimestamp
    orderDirection: desc
  ) {
    id
    missionId
    guildId
    budget
    blockTimestamp
  }
  
  # Missions completed (need to join with created)
  missionCompleteds(orderBy: blockTimestamp, orderDirection: desc) {
    id
    missionId
    guildId
    totalPaid
    blockTimestamp
  }
  
  # Ratings given
  missionRateds(orderBy: blockTimestamp, orderDirection: desc) {
    id
    missionId
    guildId
    score
    blockTimestamp
  }
}
```

## Testing Queries

### Test Connection
```bash
curl -X POST <GOLDSKY_ENDPOINT> \
  -H "Content-Type: application/json" \
  -d '{"query": "{ _meta { block { number } } }"}'
```

### Get Latest Block
```graphql
query GetLatestBlock {
  _meta {
    block {
      number
      hash
      timestamp
    }
  }
}
```

## Variables Example

When using queries with variables, pass them like this:

```bash
curl -X POST <GOLDSKY_ENDPOINT> \
  -H "Content-Type: application/json" \
  -d '{
    "query": "query GetGuild($guildId: BigInt!) { guildCreateds(where: { guildId: $guildId }) { id name } }",
    "variables": {
      "guildId": "0"
    }
  }'
```

## Notes

- All `BigInt` values should be passed as strings in variables
- Addresses should be lowercase
- Use `first` parameter to limit results (max 1000)
- Use `skip` for pagination
- Combine `orderBy` and `orderDirection` for sorting
