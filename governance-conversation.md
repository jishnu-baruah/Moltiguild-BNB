# World Governance — Coordinator Conversation

_2026-02-14T19:25:03.878Z_

---
## Round 1 — SKILL.md Draft

**Me:**
Great, let's actually design this. Draft a SKILL.md for the world-governance skill. It should define:
- The skill's purpose and when it triggers
- What tools/endpoints it needs access to
- The data models (Plot, PlotAssignment, TradeOffer)
- Decision flow: how you'd evaluate a plot assignment request
- Input/output schemas for each action (assign, release, move, trade)

Keep it practical — this will be the actual spec we build from. Use the constraints we discussed: 56x56 grid, 6 districts, road adjacency, tier-based limits, 80% district cap.

**Coordinator:**
Done. I've drafted the complete SKILL.md spec at `/root/.openclaw/workspace-coordinator/world-governance/SKILL.md`.

**What's covered:**

1. **Purpose & Triggers** — Frontmatter defines when the skill activates (plot assignment, trades, world queries, etc.)

2. **Data Models** — Full TypeScript-style schemas for `Plot`, `PlotAssignment`, `TradeOffer`, and `WorldState`

3. **Decision Flow** — 6-step validation pipeline for plot assignments with clear error branching

4. **Tool Spec** — 16 endpoints covering plots, districts, assignments, trades, and queries

5. **Action Schemas** — Complete I/O for all 6 actions:
   - `assign` (with force-bypass for 80% cap)
   - `release` (ownership verification)
   - `move` (district-to-district with re-validation)
   - `create_trade` (multi-plot offers, optional reciprocation)
   - `respond_trade` (accept/reject/cancel with auth checks)
   - `query` (owner status, district stats, plot info, pending trades)

6. **Road Adjacency Logic** — Cardinal neighbor check (N/S/E/W)

7. **Error Codes** — 17 specific codes for precise failure modes

The spec is ready to build from. Want me to add anything—maybe batch operations, auction mechanics, or district migration rules?

---
## Round 2 — API Endpoint Specs

**Me:**
Good draft. Now let's get specific about the API side. The existing api.js already has:
- GET /api/guilds (all guilds with stats)
- GET /api/guilds/:id/agents (guild members)
- SSE at GET /api/events (broadcasts mission_created, mission_completed, guild_created, agent_registered)
- POST /api/smart-create (coordinator creates missions)

For the world-governance endpoints, I need you to specify:
1. Exact route paths, HTTP methods, request/response bodies
2. What validation each endpoint does before calling you
3. How plot changes get broadcast via SSE (what event type, what payload)
4. How the initial plot state gets populated on server start (migration from random → assigned)
5. Where does plot data persist? (in-memory Map? SQLite? JSON file?)

Be concrete — write the actual endpoint specs like an API doc.

**Coordinator:**
Done. I wrote the full API spec at `/root/.openclaw/workspace-coordinator/world-governance/API_SPEC.md`.

**Quick summary of what's specified:**

### 1. Endpoints (19 total)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/world/plots` | List/filter plots |
| GET | `/api/world/plots/:plotId` | Plot details + neighbors |
| POST | `/api/world/plots/:plotId/assign` | Assign plot |
| POST | `/api/world/plots/:plotId/release` | Release plot |
| POST | `/api/world/plots/:plotId/move` | Move to new district |
| GET | `/api/world/districts` | All district stats |
| GET | `/api/world/districts/:id` | District details |
| GET | `/api/world/districts/:id/available` | Available plots in district |
| GET | `/api/world/owners/:address` | Owner's plots + tier breakdown |
| GET | `/api/world/owners/:address/eligibility` | Can they assign more? |
| POST | `/api/world/trades` | Create trade |
| GET | `/api/world/trades/:id` | Trade details |
| GET | `/api/world/owners/:address/trades` | List trades |
| POST | `/api/world/trades/:id/accept` | Accept trade |
| POST | `/api/world/trades/:id/reject` | Reject trade |
| POST | `/api/world/trades/:id/cancel` | Cancel trade |

### 2. Validation Pipeline

Each endpoint has explicit pre-validation:
- **Assign**: Address format, road adjacency, tier limit, district 80% cap
- **Release**: Ownership verification
- **Move**: Ownership + target district capacity
- **Trades**: Both parties own their plots, no overlap, not self-trading

### 3. SSE Events

New event types integrate with existing `/api/events` stream:
- `plot_assigned` / `plot_released` / `plot_moved`
- `trade_created` / `trade_accepted` / `trade_rejected` / `trade_cancelled` / `trade_expired`

All include timestamps, plot coordinates, district capacity changes, and transfer details.

### 4. Initial State Population

**Road generation**: Grid every 7 plots + district boundaries = ~15% road coverage
**District boundaries**: 6 districts with quadrant-based geometry
**Migration path**: If rebooting with new layout, `migrateWorld()` handles forced releases for plots that became roads or lost road access.

### 5. Persistence Strategy

**Recommended**: SQLite with in-memory Map cache
- Tables: `plots`, `plot_assignments`, `trades`
- Indexes on district, owner, trade status
- JSON backup every 5 minutes
- Alternative: Pure JSON file for simple deployments

**Next step:** Need me to generate the actual SQL schema + Express route handlers?

---
## Round 3 — Client-Side Phaser Integration

**Me:**
Now let's think about how this connects to the Phaser client. Currently:
- WorldScene.ts creates GuildHallManager which reads guilds from the WorldState store
- GuildHallManager.findDeterministicSpot() picks a random tile in the guild's district using seeded RNG
- TilemapManager tracks occupied tiles but only in-browser memory
- The client fetches guilds from GET /api/guilds and renders them

With server-authoritative plots:
1. How should the client fetch plot assignments? New endpoint? Included in /api/guilds response?
2. When a plot changes (assigned/traded), SSE pushes an event — how should the Phaser scene react? (remove old sprite, place new one, animate the transition?)
3. What about the FIRST load — should we render guild halls immediately from plot data, or still do the cinematic intro first?
4. If a guild has no assigned plot yet (new guild), should we show it in a "pending" state, or not render it until assigned?
5. What data does GuildHallManager need from the plot assignment to render correctly? (just col,row? or more?)

Think about the user experience — smooth transitions, no flickering.

**Coordinator:**
Done. Full client integration spec is at `/root/.openclaw/workspace-coordinator/world-governance/CLIENT_INTEGRATION.md`.

**Quick answers to your questions:**

### 1. Data Fetching: Extend `/api/guilds`
Add `assignedPlot: { plotId, x, y, tier, assignedAt }` to each guild. Single request, backward compatible, no new endpoint needed.

### 2. SSE Event Reactions
Each event has a specific animation:
- **plot_assigned** → 3-phase spawn: scale from 0 + back ease, particle burst
- **plot_released** → Float up + fade out
- **plot_moved** → Lift → fly → land (800ms move, 300ms each for lift/land)
- **trade_accepted** → Yellow flash + floating token animation

All animations use `pendingAnimations` Set to prevent double-triggering.

### 3. First Load Strategy
Keep the cinematic intro, then **staggered reveal**:
```typescript
assignedGuilds.sort((a, b) => a.assignedAt - b.assignedAt); // oldest first
// Spawn each with 100ms delay for "world filling up" effect
```

Add `localStorage` flag for returning users to skip intro and render immediately.

### 4. Unassigned Guilds: Ghost Markers
Show as 30% opacity sprites in district center with "PENDING" label + gentle float animation. Click opens assignment modal. Disappear once assigned.

### 5. GuildHallManager Needs
```typescript
interface GuildHallData {
  guildId, guildName, color,
  plotId, col, row,  // col=x, row=y
  tier               // for badge rendering
}
```

**Key files to modify:**
1. `GuildHallManager.ts` - Remove `findDeterministicSpot()`, add `placeGuildHall()`, `animateMove()`, `animateDeparture()`
2. `WorldScene.ts` - Add SSE listeners, sync recovery (30s poll), toast notifications
3. Server `api.js` - Add `assignedPlot` to `/api/guilds` response

**State sync strategy:** Pessimistic (wait for SSE), with 30-second polling fallback for drift recovery.

Want me to generate the actual TypeScript code for any of these components?

---
## Round 4 — Trading System Design

**Me:**
Let's talk about the trading system design. When we add tile trading:
1. How should pricing work? Free market (guilds set any price)? Or some floor/ceiling based on tile attributes?
2. Should trades go through you (coordinator approves/rejects) or be direct guild-to-guild?
3. What prevents price manipulation (guild A sells to guild B at 0.0001 MON to launder a premium tile)?
4. Should there be an auction mechanism for high-value tiles, or just fixed-price listings?
5. How does a trade interact with the on-chain GuildRegistry contract? New function needed, or off-chain only?
6. What about "eminent domain" — can the coordinator reclaim abandoned guild plots (guild dissolved, inactive 30+ days)?

Also: what events would the activity feed show for trading? What would make this fun to watch in the world view?

**Coordinator:**
Done. Full trading system design is at `/root/.openclaw/workspace-coordinator/world-governance/TRADING_DESIGN.md`.

**Quick answers to your questions:**

### 1. Pricing: Hybrid Floor + Free Market
- **Floor price**: Tier base × district scarcity × road bonus × age bonus
  - T1: 0.08-1.0 MON, T2: 0.4-5.0 MON, T3: 1.6-20.0 MON
- **Hard floor**: Can't list below 10% of calculated floor (prevents 0.0001 MON scams)
- **Gift threshold**: Below 50% of floor = coordinator approval required

### 2. Trade Approval: Dual Path
| Scenario | Path |
|----------|------|
| Price ≥ 90% floor | **Auto-approve** (peer-to-peer, executes immediately) |
| Price < 50% floor | **Requires coordinator approval** (4-24h review) |
| Same parties trading | **Flagged for review** (wash trade detection) |
| New guild (< 7 days) | **Restricted** (can't sell, can buy) |

### 3. Anti-Manipulation
- **24-hour cooldown** between trades between same parties
- **Max 5 trades/week** per guild
- **Linked guild detection** (same owner = instant flag)
- **Velocity limits** (max 50 MON/week trading volume)
- **Round-trip detection** (A→B→A within 7 days = high risk score)

### 4. Sales Mechanisms
| Mechanism | Use Case |
|-----------|----------|
| **Fixed-price** | Default for T1-T2 |
| **Auction** | Required for T3, optional for T2 |
| **Dutch auction** | Eminent domain liquidations (price decays 48h) |
| **Buy-it-now** | Optional on auctions (instant purchase at premium) |

### 5. On-Chain Integration
**New GuildRegistry functions:**
```solidity
function listPlot(uint256 plotId, uint256 price)
function buyPlot(uint256 plotId) external payable
function approveGiftTrade(...)  // Coordinator only
function reclaimPlot(...)         // Eminent domain
```

**Events:**
```solidity
PlotListed, PlotSold, PlotReclaimed
```

**Coordinator Oracle** signs off on suspicious trades off-chain, provides signature for on-chain execution.

### 6. Eminent Domain
```
Day 0:  Guild inactive
Day 25: Warning posted (red pulsing ghost marker)
Day 29: Final notice (24h countdown)
Day 30: Reclaimed → 50% floor price compensation → Dutch auction
```

Coordinator can grant extensions or mark active if legitimate reason.

### 7. Activity Feed Events
- `🏷️ PLOT_LISTED` - Normal priority
- `💰 PLOT_SOLD` - **High priority, highlighted**
- `🔨 AUCTION_STARTED` - With CTA button
- `⬆️ AUCTION_BID` - Batched (1 min debounce)
- `🏆 AUCTION_ENDED` - **High priority, fireworks**
- `⚠️ ABANDONMENT_WARNING` - Guild-only visibility
- `📊 PRICE_RECORD` - District-wide celebration

### 8. Visual Fun
| Effect | Trigger |
|--------|---------|
| Floating "For Sale" sign | Plot listed |
| Gold coin particle bridge | Trade executes |
| Fireworks | Price record broken |
| Red pulse + ⚠️ icon | Abandonment warning |
| Orange glow (intensifying) | Auction < 5 min left |
| Pan camera between parties | High-value trade |

**Spectator mode**: Auto-follow trades > 5 MON, bid war graphs, winner prediction.

**Next step:** Want me to generate the Solidity contract code or the TypeScript trading engine implementation?

---
## Round 5 — Implementation Priority & Migration

**Me:**
Final round. Let's synthesize everything into an implementation priority list. Given everything we've discussed:

1. What's the MINIMUM VIABLE version we should build first? (fewest endpoints, simplest rules, no trading yet)
2. What can stay client-side for now vs what MUST be server-authoritative from day one?
3. List the exact files we need to create/modify in priority order
4. What's the migration path? How do existing guilds get their first plots without disrupting the current experience?
5. Any risks or gotchas you see with this design?

Give me a concrete Phase 1 spec — something we can build in a day — and a Phase 2 roadmap for trading.

**Coordinator:**
Done. Implementation roadmap at `/root/.openclaw/workspace-coordinator/world-governance/IMPLEMENTATION_ROADMAP.md`.

**Quick summary:**

## 1. MVP (Phase 1) - Build in 1 Day

**Features:**
- 4 endpoints: list plots, assign plot, release plot, enhanced guilds
- In-memory world state (3136 plots) with JSON backup
- Hard enforcement: tier limits (1/3/9), road adjacency, district 80% warning
- Auto-approve everything (no coordinator approvals yet)
- Client: spawn + departure animations only
- NO trading, NO pricing, NO auctions

## 2. Client vs Server Authority

| Server Owns | Client Owns |
|-------------|-------------|
| Assignment state | Hall rendering (from server coordinates) |
| Tier enforcement | Animations (visual only) |
| Road validation | Camera, tilemap |
| Global events (SSE) | Ghost markers (decorative) |

**Sync:** 30s polling fallback if SSE drops

## 3. Files in Priority Order (Phase 1)

| # | File | Time |
|---|------|------|
| 1 | `server/world-state.js` | 2h |
| 2 | `server/routes/world.js` | 2h |
| 3 | `server/routes/guilds.js` (modify) | 30m |
| 4 | `server/sse/events.js` (modify) | 30m |
| 5 | `client/src/stores/WorldState.ts` | 1h |
| 6 | `client/src/managers/GuildHallManager.ts` (modify) | 1.5h |
| 7 | `client/src/scenes/WorldScene.ts` (modify) | 1.5h |
| 8 | `client/src/components/PlotAssignmentModal.vue` | 1h |

**Total: ~10 hours**

## 4. Migration Path

**Zero-downtime:**
1. Deploy server with world generation (feature flag off)
2. Run migration: auto-assign existing guilds to current deterministic spots
3. Deploy client with `USE_SERVER_PLOTS=true`
4. Invalid spots get "Choose New Location" modal
5. Remove legacy path after 24h monitoring

## 5. Risks & Gotchas

| Risk | Mitigation |
|------|------------|
| Double assignment race | SQLite unique constraint, atomic transactions |
| Client desync | 30s polling, SSE reconnection |
| Data loss | JSON backup every 5 min, SIGTERM handler |
| All prime plots taken | Pre-calculate min availability, alert at 70% |
| Coordinate mismatch | Server uses "x,y", ensure client parses correctly |

## 6. Phase 1 Spec (Day 1)

**Endpoints:**
```
GET  /api/guilds (with assignedPlot field)
GET  /api/world/plots?district=:id
POST /api/world/plots/:plotId/assign
POST /api/world/plots/:plotId/release
```

**Success criteria:**
- Guild claims unassigned, road-adjacent plot
- Tier limits enforced
- Assignment shows in world view immediately
- SSE broadcasts to all clients within 1s
- State persists to JSON

## 7. Phase 2 Roadmap (Week 1-2)

**Week 1:** Trading - list/buy plots, floor pricing, anti-manipulation, on-chain settlement
**Week 2:** Auctions (T3 required), eminent domain (30-day reclamation), visual polish

---

**Ready to start building Phase 1?** I can generate the actual `world-state.js` server implementation or the modified `GuildHallManager.ts` first—just say which.

