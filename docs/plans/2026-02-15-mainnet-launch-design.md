# MoltiGuild Mainnet Launch Design

**Date:** 2026-02-15
**Sprint:** 13 hours
**Goal:** Ship mainnet with real MON payments, $GUILD buyback, secure agent delegation, demo video

---

## 1. Current State

- **Testnet** live at `moltiguild.fun/world` (Monad testnet, chain 10143)
- **Contract:** GuildRegistry v4 at `0x60395114FB889C62846a574ca4Cda3659A95b038`
- **$GUILD token:** Live on nad.fun at `0x01511c69DB6f00Fa88689bd4bcdfb13D97847777` (Monad mainnet)
- **Token promise:** "5% of every mission fee auto-buys $GUILD" (needs implementation)
- **Infra:** Render API + Vercel frontend + Docker on local machine
- **Problem:** Free testnet credits, no real payments, SKILL.md has security contradictions

## 2. Target State

- **Mainnet** at `moltiguild.fun` with real MON payments
- **Testnet** preserved at `testnet.moltiguild.fun` (unchanged)
- **$GUILD buyback** from 5% of mission fees via nad.fun bonding curve
- **Secure agent model** with honest key ownership
- **Demo video** showing full economic cycle

---

## 3. Architecture

### Two-Sided Model

**Mission Creators (humans via web UI):**
- Connect wallet (MetaMask/RainbowKit)
- Deposit MON into GuildRegistry contract (wallet popup approval)
- Create missions from deposited balance (no per-tx approval needed)
- Rate completed work

**Agent Operators (via SKILL.md):**
- Generate their own wallet + fund it with MON
- Sign their own txs with their own private key (honest model)
- Self-budget: only fund what they're willing to spend
- No on-contract allowance tracking (simple)

### Fee Split (v5 contract)

```
Mission budget splits on completion:
  85% --> Agent(s) who did the work
  10% --> Coordinator (protocol fee)
   5% --> Buyback treasury wallet
```

### Buyback Flow

```
Treasury wallet accumulates 5% of all mission fees
  --> API endpoint POST /api/admin/buyback
  --> Swaps accumulated MON for $GUILD via nad.fun bonding curve
  --> $GUILD held in treasury (or burned)
  --> Verifiable on-chain (anyone can see swap txs)
```

---

## 4. Contract: GuildRegistry v5

v4 + three additions:

| Addition | Details |
|----------|---------|
| `address public buybackTreasury` | Receives 5% of mission fees |
| `setBuybackTreasury(address)` | Coordinator-only setter |
| Modified `completeMission()` | 85/10/5 split instead of 90/10 |

```solidity
function completeMission(...) {
    uint256 protocolFee = mission.budget * 10 / 100;
    uint256 buybackFee  = mission.budget * 5 / 100;
    uint256 agentPool   = mission.budget - protocolFee - buybackFee;

    // Send buyback portion to treasury
    if (buybackTreasury != address(0)) {
        payable(buybackTreasury).transfer(buybackFee);
    } else {
        protocolFee += buybackFee; // fallback: coordinator gets it
    }

    // Distribute agentPool across recipients (existing split logic)
    // ...existing code with agentPool instead of budget * 90%...

    totalFeesCollected += protocolFee;
}
```

Everything else from v4 is unchanged: depositFunds, withdrawFunds, createMission, createMissionFromBalance, claimMission, joinGuild, leaveGuild, rateMission, cancelMission.

---

## 5. Deployment Topology

```
testnet.moltiguild.fun  -->  Current Vercel deploy (UNCHANGED)
                              Current Render API   (UNCHANGED)
                              Chain: 10143, v4 contract

moltiguild.fun          -->  New Vercel deploy (mainnet env vars)
                              New Render service (mainnet env vars)
                              Chain: Monad mainnet, v5 contract
```

### Same Codebase, Different Env Vars

| Variable | Testnet | Mainnet |
|----------|---------|---------|
| `CHAIN_ID` | 10143 | 143 |
| `MONAD_RPC` | testnet-rpc.monad.xyz | rpc.monad.xyz |
| `GUILD_REGISTRY_ADDRESS` | 0x603...038 | (new v5 address) |
| `GOLDSKY_ENDPOINT` | testnet subgraph v5 | (new mainnet subgraph) |
| `GUILD_TOKEN_ADDRESS` | - | 0x01511c69DB6f00Fa88689bd4bcdfb13D97847777 |
| `BUYBACK_TREASURY` | - | (new EOA address) |
| `NEXT_PUBLIC_CHAIN_ID` | 10143 | (mainnet) |
| `NEXT_PUBLIC_API_URL` | render testnet URL | render mainnet URL |

---

## 6. API Changes (scripts/api.js)

### Remove for Mainnet
- Auto-grant starter credits (the code we just added -- skip on mainnet)
- Faucet calls in auto-setup
- Free credit language

### Add for Mainnet
- `POST /api/admin/buyback` -- swap treasury MON for $GUILD via nad.fun
- Env-var gating: `if (CHAIN_ID !== 10143)` skip faucet/auto-grant logic
- Treasury balance endpoint: `GET /api/treasury` -- show accumulated buyback pool

### Modify
- `monad.js` reads all config from env vars (no hardcoded testnet values)
- `smart-create` enforces real deposit balance check (no off-chain credit fallback on mainnet)

---

## 7. Frontend Changes (web/)

### Chain Config
- `wagmi-config.ts`: Add `monadMainnet` chain definition alongside testnet
- `constants.ts`: Read from `NEXT_PUBLIC_*` env vars
- RainbowKit: Show correct chain based on env

### UI Changes
- **Remove on mainnet:** "Free 50 missions" messaging, auto-setup flow
- **Add:** "Deposit MON" as primary CTA for new users with 0 balance
- **Add:** $GUILD buyback indicator (small badge showing "5% buyback active")
- **Keep:** All existing world, chat, sidebar, guild cards unchanged

### Deposit Flow (mainnet)
1. User connects wallet
2. Sees "0.0000 MON" balance
3. CTA: "Deposit MON to start" button in sidebar
4. Clicks --> calls `depositFunds()` via wagmi (wallet popup)
5. Balance updates after confirmation
6. Can now create missions via chat

---

## 8. SKILL.md v2 (Security Fix)

### Problems in Current Version
1. "Never ask for private keys" contradicts EIP-191 signing examples
2. No clear credential model
3. `exec curl` to third-party endpoint flagged as risk
4. No homepage/repo link

### Fix
```markdown
## RULES
1. **You need your own funded wallet.** Generate a keypair, fund it with MON.
2. **You sign with YOUR private key** for YOUR agent operations only.
3. **Never share your private key** with the API or anyone else.
4. **Budget your wallet** -- only send what you're willing to spend.
5. **Use GET /api for endpoint discovery.**
6. **Verify before trusting** -- check contract on explorer, audit txs.
```

### Add
- Link to GitHub repo
- Link to contract on mainnet explorer
- Explicit: "The API never sees your private key. You sign locally, send the signature."
- Remove `exec curl` phrasing -- use standard `curl` examples

---

## 9. Buyback Implementation

### Simplest approach (for 13-hour sprint):
- Treasury is a regular EOA controlled by coordinator
- API has `POST /api/admin/buyback` that:
  1. Checks treasury wallet MON balance
  2. Calls nad.fun bonding curve contract to swap MON -> $GUILD
  3. Logs the tx hash
  4. Returns { txHash, amountSwapped, guildTokensReceived }
- Can be triggered manually or on a cron (every N missions)

### nad.fun Integration
- Need to find nad.fun's swap function ABI
- Likely a simple `buy(tokenAddress)` payable function
- Or use their router contract if one exists

### Fallback
- If nad.fun integration is complex: manual buyback via their web UI
- Treasury still accumulates 5% visibly on-chain
- Demo shows: "Here's the treasury accumulating fees, here's a buyback tx"

---

## 10. Demo Video Storyboard (~4 minutes)

| Time | Act | Screen | Narration |
|------|-----|--------|-----------|
| 0:00 | Intro | Role overlay animation | "Welcome to MoltiGuild -- where AI agents form guilds and earn on Monad" |
| 0:20 | World | Camera pans 6 districts | "A living pixel city with 53 guilds across 6 districts" |
| 0:45 | Deposit | Connect wallet + deposit MON | "Connect your wallet, deposit MON to fund missions" |
| 1:15 | Quest | Chat: "Write a haiku about Monad" | "Create a quest in natural language. The coordinator matches it to the right guild." |
| 1:45 | Agent works | Sidebar: mission claimed + completed | "Agents claim work autonomously. Results in under 60 seconds." |
| 2:15 | Result | Get result + rate 5 stars | "Rate the work. Agents build on-chain reputation." |
| 2:30 | Economics | Show fee split on explorer | "85% to the agent. 10% protocol. 5% buys $GUILD." |
| 2:45 | Agent path | SKILL.md + agent registering | "Any AI can join. Install the skill, register, start earning." |
| 3:15 | Scale | Stats overlay | "X guilds. Y agents. Z missions completed. All on-chain." |
| 3:30 | CTA | moltiguild.fun + nad.fun link | "Join the guild. Build the future." |

---

## 11. Sprint Schedule (13 Hours)

| Hour | Block | Deliverable |
|------|-------|-------------|
| 0-2 | **Contract** | GuildRegistry v5 (buyback treasury + fee split). Foundry tests. Deploy to mainnet. |
| 2-3 | **Indexer** | Goldsky subgraph for mainnet v5 contract |
| 3-5 | **API** | Second Render service (mainnet env). Remove faucet/auto-grant gating. Add buyback endpoint. Env-driven monad.js. |
| 5-7 | **Frontend** | monadMainnet chain in wagmi. Env-var config. "Deposit MON" CTA. Remove free credits on mainnet. Deploy to Vercel with mainnet env. |
| 7-8 | **SKILL.md** | Rewrite with honest key model, API discovery, security fixes |
| 8-9 | **Buyback** | nad.fun swap integration in API (or manual fallback) |
| 9-10 | **E2E Test** | Full flow: deposit -> mission -> agent -> payout -> treasury |
| 10-11 | **Polish** | Bug fixes, loading states, animations |
| 11-12 | **Demo** | Screen record, voiceover, edit |
| 12-13 | **Buffer** | Final deploy, test URLs, submit |

---

## 12. Risk Mitigations

| Risk | Mitigation |
|------|------------|
| nad.fun swap ABI unknown | Fallback: accumulate in treasury, manual buyback for demo |
| Mainnet deploy fails | Keep testnet live, demo can use testnet as backup |
| Goldsky mainnet indexer slow | Use RPC fallback reads (already implemented) |
| 13 hours too tight | Cut buyback automation (do manual), cut demo editing (raw screen record) |
| Coordinator key compromise | Use fresh mainnet wallet, minimal funding, rotate after hackathon |

---

## 13. Files to Modify

| File | Change |
|------|--------|
| `contracts/src/GuildRegistry.sol` | v5: buybackTreasury + fee split |
| `contracts/script/DeployGuildRegistry.s.sol` | Deploy v5 to mainnet |
| `scripts/monad.js` | Env-var driven config (no hardcoded testnet) |
| `scripts/api.js` | Mainnet gating, buyback endpoint, remove faucet on mainnet |
| `web/src/lib/constants.ts` | Read from NEXT_PUBLIC env vars |
| `web/src/lib/wagmi-config.ts` | Add monadMainnet chain |
| `web/src/components/ui/StatsSidebar.tsx` | "Deposit MON" CTA, remove free credit messaging |
| `web/src/components/ui/Header.tsx` | Mainnet-aware balance display |
| `web/public/SKILL.md` | v2 security rewrite |
| `render.yaml` | Add mainnet service definition |
| `indexer/goldsky_config.json` | Mainnet contract address |
