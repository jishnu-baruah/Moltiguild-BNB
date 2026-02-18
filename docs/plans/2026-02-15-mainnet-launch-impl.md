# MoltiGuild Mainnet Launch — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship MoltiGuild on Monad mainnet with real MON payments, 85/10/5 fee split with $GUILD buyback treasury, secure agent signing model, and record a demo video — all in 13 hours while keeping the current testnet live.

**Architecture:** GuildRegistry v5 (v4 + buybackTreasury state + modified fee split). Same codebase for testnet and mainnet via env vars. Subdomain routing: `testnet.moltiguild.fun` (unchanged) and `moltiguild.fun` (mainnet). Buyback treasury accumulates 5% of mission fees; API periodically swaps MON→$GUILD via nad.fun bonding curve.

**Tech Stack:** Solidity 0.8.27 + Foundry (contract), Node.js + Express + viem (API), Next.js 14 + wagmi + RainbowKit (frontend), Goldsky (indexer), Render (API hosting), Vercel (frontend hosting).

**Monad Mainnet Config (confirmed):**
- **Chain ID:** 143
- **RPC:** https://rpc.monad.xyz
- **Explorer:** https://monad.socialscan.io
- **EVM:** Prague (Solidity 0.8.27+ — already compatible)
- **$GUILD Token:** 0x01511c69DB6f00Fa88689bd4bcdfb13D97847777

**Prerequisites the human must still provide:**
- Funded coordinator wallet private key on mainnet
- Buyback treasury wallet address (can be a fresh EOA)

---

## Task 1: GuildRegistry v5 Contract — Add Buyback Treasury (Hour 0-1)

**Files:**
- Modify: `contracts/src/GuildRegistry.sol:46-72` (state), `:433-495` (completeMission), `:547-571` (admin)
- Test: `contracts/test/GuildRegistry.t.sol`

### Step 1: Add buybackTreasury state variable and setter

In `contracts/src/GuildRegistry.sol`, add after line 72 (`uint256 public missionTimeout;`):

```solidity
    // V5: Buyback treasury
    address public buybackTreasury;

    event BuybackTreasurySet(address indexed oldTreasury, address indexed newTreasury);
```

Add setter function after `transferCoordinator` (after line 571):

```solidity
    function setBuybackTreasury(address _treasury) external onlyCoordinator {
        address old = buybackTreasury;
        buybackTreasury = _treasury;
        emit BuybackTreasurySet(old, _treasury);
    }
```

### Step 2: Modify completeMission fee split to 85/10/5

Replace the fee calculation in `completeMission()` (lines 460-478). The current logic:
```solidity
uint256 totalSplit = 0;
for (...) { totalSplit += splits[i]; }
require(totalSplit <= mission.budget, "Splits exceed budget");
// ...
uint256 fee = mission.budget - totalSplit;
if (fee > 0) { totalFeesCollected += fee; }
```

Replace with explicit 85/10/5 split. The new `completeMission` body from the `require(recipients.length > 0)` check onward:

```solidity
        // V4: Check claimer included
        if (missionClaims[missionId] != address(0)) {
            bool claimerIncluded = false;
            for (uint256 i = 0; i < recipients.length; i++) {
                if (recipients[i] == missionClaims[missionId]) {
                    claimerIncluded = true;
                    break;
                }
            }
            require(claimerIncluded, "Claimed agent must be in recipients");
        }

        // V5: Calculate fee split
        uint256 buybackFee = mission.budget * 5 / 100;
        uint256 protocolFee = mission.budget * 10 / 100;
        uint256 agentPool = mission.budget - protocolFee - buybackFee;

        // Verify splits don't exceed agent pool
        uint256 totalSplit = 0;
        for (uint256 i = 0; i < splits.length; i++) {
            require(recipients[i] != address(0), "Zero recipient");
            unchecked { totalSplit += splits[i]; }
        }
        require(totalSplit <= agentPool, "Splits exceed agent pool");

        mission.completed = true;
        mission.completedAt = block.timestamp;
        mission.resultHashes = resultHashes;

        guilds[mission.guildId].acceptedMissions++;

        // Protocol fee (coordinator keeps remainder if splits < agentPool)
        uint256 coordinatorFee = protocolFee + (agentPool - totalSplit);
        totalFeesCollected += coordinatorFee;

        // V5: Send buyback fee to treasury
        if (buybackTreasury != address(0) && buybackFee > 0) {
            (bool bbSuccess, ) = payable(buybackTreasury).call{value: buybackFee}("");
            require(bbSuccess, "Buyback transfer failed");
        } else {
            // No treasury set — coordinator gets it
            totalFeesCollected += buybackFee;
        }

        // Pay agents
        for (uint256 i = 0; i < recipients.length; i++) {
            if (agents[recipients[i]].active) {
                agents[recipients[i]].missionsCompleted++;
            }
            if (splits[i] > 0) {
                (bool success, ) = recipients[i].call{value: splits[i]}("");
                require(success, "Transfer failed");
            }
        }

        emit MissionCompleted(missionId, mission.guildId, resultHashes);
```

### Step 3: Write tests for v5 fee split

Add to `contracts/test/GuildRegistry.t.sol`:

```solidity
    // =========================
    // V5: BUYBACK TREASURY TESTS
    // =========================

    function test_SetBuybackTreasury() public {
        address treasury = makeAddr("treasury");
        vm.prank(coordinator);
        registry.setBuybackTreasury(treasury);
        assertEq(registry.buybackTreasury(), treasury);
    }

    function test_SetBuybackTreasury_Revert_NotCoordinator() public {
        vm.prank(randomUser);
        vm.expectRevert("Not coordinator");
        registry.setBuybackTreasury(makeAddr("treasury"));
    }

    function test_CompleteMission_FeeSplit_85_10_5() public {
        address treasury = makeAddr("treasury");
        vm.prank(coordinator);
        registry.setBuybackTreasury(treasury);

        // Setup full flow
        vm.prank(agent1);
        registry.registerAgent("Agent", 0);
        vm.prank(randomUser);
        registry.createGuild("Guild", "Tech");
        vm.prank(agent1);
        registry.joinGuild(0);

        // Create mission with 1 ether budget
        vm.prank(client);
        uint256 missionId = registry.createMission{value: 1 ether}(0, bytes32("task1"));
        vm.prank(agent1);
        registry.claimMission(missionId);

        // Track balances before
        uint256 agentBefore = agent1.balance;
        uint256 treasuryBefore = treasury.balance;
        uint256 feesBefore = registry.totalFeesCollected();

        // Complete: agent gets 0.85 ether (85%)
        bytes32[] memory results = new bytes32[](1);
        results[0] = bytes32("result");
        address[] memory recipients = new address[](1);
        recipients[0] = agent1;
        uint256[] memory splits = new uint256[](1);
        splits[0] = 0.85 ether;

        vm.prank(coordinator);
        registry.completeMission(missionId, results, recipients, splits);

        // Verify: agent got 0.85, treasury got 0.05, coordinator got 0.10
        assertEq(agent1.balance, agentBefore + 0.85 ether);
        assertEq(treasury.balance, treasuryBefore + 0.05 ether);
        assertEq(registry.totalFeesCollected(), feesBefore + 0.10 ether);
    }

    function test_CompleteMission_NoTreasury_CoordinatorGetsAll() public {
        // buybackTreasury is address(0) by default

        vm.prank(agent1);
        registry.registerAgent("Agent", 0);
        vm.prank(randomUser);
        registry.createGuild("Guild", "Tech");
        vm.prank(agent1);
        registry.joinGuild(0);

        vm.prank(client);
        uint256 missionId = registry.createMission{value: 1 ether}(0, bytes32("task1"));
        vm.prank(agent1);
        registry.claimMission(missionId);

        uint256 feesBefore = registry.totalFeesCollected();

        bytes32[] memory results = new bytes32[](1);
        results[0] = bytes32("result");
        address[] memory recipients = new address[](1);
        recipients[0] = agent1;
        uint256[] memory splits = new uint256[](1);
        splits[0] = 0.85 ether;

        vm.prank(coordinator);
        registry.completeMission(missionId, results, recipients, splits);

        // Coordinator gets 10% + 5% buyback (no treasury set)
        assertEq(registry.totalFeesCollected(), feesBefore + 0.15 ether);
    }
```

### Step 4: Run tests

```bash
cd contracts && forge test -vv
```

Expected: ALL tests pass including new v5 tests. Existing v4 tests need updating — the `test_CompleteMission_WithClaimer` test sends `splits[0] = 1 ether` (full budget) which will now fail because max agent pool is 85%. Update that test's split to `0.85 ether`.

### Step 5: Commit

```bash
git add contracts/src/GuildRegistry.sol contracts/test/GuildRegistry.t.sol
git commit -m "feat: GuildRegistry v5 — buyback treasury + 85/10/5 fee split"
```

---

## Task 2: Deploy v5 Contract to Monad Mainnet (Hour 1-2)

**Files:**
- Modify: `contracts/script/DeployGuildRegistry.s.sol:12-14`

### Step 1: Update deploy script coordinator address

The user must provide their mainnet coordinator wallet address. Update line 13:

```solidity
address coordinator = vm.envAddress("COORDINATOR_ADDRESS");
```

### Step 2: Deploy to mainnet

```bash
cd contracts
forge script script/DeployGuildRegistry.s.sol:DeployGuildRegistry \
  --rpc-url $MAINNET_RPC \
  --broadcast \
  --legacy \
  --private-key $DEPLOYER_PRIVATE_KEY
```

**IMPORTANT:** Record the deployed contract address from output. You'll need it for all subsequent steps.

### Step 3: Set buyback treasury on the deployed contract

```bash
cast send $NEW_CONTRACT_ADDRESS "setBuybackTreasury(address)" $TREASURY_ADDRESS \
  --rpc-url $MAINNET_RPC \
  --legacy \
  --private-key $COORDINATOR_PRIVATE_KEY
```

### Step 4: Verify contract state

```bash
cast call $NEW_CONTRACT_ADDRESS "coordinator()" --rpc-url $MAINNET_RPC
cast call $NEW_CONTRACT_ADDRESS "buybackTreasury()" --rpc-url $MAINNET_RPC
```

### Step 5: Commit deploy script changes

```bash
git add contracts/script/DeployGuildRegistry.s.sol
git commit -m "feat: deploy script reads coordinator from env"
```

---

## Task 3: Make monad.js Fully Env-Driven (Hour 3)

**Files:**
- Modify: `scripts/monad.js:19-38` (config), `:24` (explorer), `:25` (faucet), `:27-38` (chain def), `:779-840` (exports)

### Step 1: Update config block (lines 19-38)

Replace lines 19-38 with:

```javascript
const MONAD_RPC = process.env.MONAD_RPC || 'https://testnet-rpc.monad.xyz';
const CHAIN_ID = parseInt(process.env.CHAIN_ID || '10143');
const GUILD_REGISTRY_ADDRESS = process.env.GUILD_REGISTRY_ADDRESS || '0x60395114FB889C62846a574ca4Cda3659A95b038';
const COORDINATOR_PRIVATE_KEY = process.env.COORDINATOR_PRIVATE_KEY;
const GOLDSKY_ENDPOINT = process.env.GOLDSKY_ENDPOINT || 'https://api.goldsky.com/api/public/project_cmlgbdp3o5ldb01uv0nu66cer/subgraphs/agentguilds-monad-testnet-monad-testnet/v5/gn';
const EXPLORER_URL = process.env.EXPLORER_URL || 'https://testnet.socialscan.io/tx/';
const FAUCET_URL = process.env.FAUCET_URL || 'https://agents.devnads.com/v1/faucet';
const IS_MAINNET = CHAIN_ID !== 10143;

// Chain definition (dynamic based on env)
const monadChain = {
    id: CHAIN_ID,
    name: IS_MAINNET ? 'Monad' : 'Monad Testnet',
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: {
        default: { http: [MONAD_RPC] },
    },
    blockExplorers: {
        default: { name: 'Explorer', url: EXPLORER_URL.replace(/\/tx\/$/, '') },
    },
};
```

### Step 2: Update all references from `monadTestnet` to `monadChain`

Replace `monadTestnet` with `monadChain` throughout the file (lines 237, 252, 785). Also export `IS_MAINNET`.

### Step 3: Update exports (line 779+)

Add to exports:
```javascript
    IS_MAINNET,
    FAUCET_URL,
    CHAIN_ID,
    MONAD_RPC,
    monadChain, // renamed from monadTestnet
```

Keep `monadTestnet` as an alias for backwards compatibility:
```javascript
    monadTestnet: monadChain, // backwards compat
```

### Step 4: Add `buybackTreasury` ABI entry

Add to `GUILD_REGISTRY_ABI` array (after line 48):
```javascript
    { name: 'buybackTreasury', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
    { name: 'setBuybackTreasury', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: '_treasury', type: 'address' }], outputs: [] },
```

### Step 5: Commit

```bash
git add scripts/monad.js
git commit -m "refactor: monad.js fully env-driven, mainnet-ready"
```

---

## Task 4: API Mainnet Gating — Remove Free Credits on Mainnet (Hour 3-4)

**Files:**
- Modify: `scripts/api.js:269-338` (auto-setup), `:729-748` (credits endpoint), `:906-934` (smart-create)

### Step 1: Gate auto-grant credits by chain

In `GET /api/credits/:userId` (line 729), wrap the auto-grant in a testnet check:

```javascript
app.get('/api/credits/:userId', async (req, res) => {
    try {
        let credits = await getCredits(req.params.userId);

        // Auto-grant starter credits for new users (testnet only)
        if (credits <= 0 && !monad.IS_MAINNET) {
            const wallet = await getUserWallet(req.params.userId);
            if (!wallet) {
                const STARTER_CREDITS = 0.05;
                await setCredits(req.params.userId, STARTER_CREDITS);
                credits = STARTER_CREDITS;
            }
        }

        res.json({ ok: true, data: { userId: req.params.userId, credits: `${credits} MON`, raw: credits, mainnet: monad.IS_MAINNET } });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});
```

### Step 2: Gate auto-setup by chain

In `autoSetupUser()` (line 272), skip faucet on mainnet:

```javascript
async function autoSetupUser(userId) {
    let wallet = await getUserWallet(userId);
    if (wallet) {
        const credits = await getCredits(userId);
        return { alreadySetup: true, address: wallet.address, credits };
    }

    // Generate wallet (both chains)
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    wallet = { address: account.address, key: privateKey };
    await saveUserWallet(userId, wallet);

    // On mainnet: no faucet, no auto-deposit
    if (monad.IS_MAINNET) {
        return { alreadySetup: false, address: account.address, credits: 0, funded: false, mainnet: true };
    }

    // Testnet: faucet + auto-deposit (existing logic)
    // ... keep existing faucet code ...
```

### Step 3: Update smart-create to not auto-setup on mainnet

In `POST /api/smart-create` (line 922), replace the auto-setup block:

```javascript
        if (!isAdmin) {
            if (!userId) return res.status(401).json({ ok: false, error: 'Missing X-Admin-Key or userId' });
            let credits = await getCredits(userId);

            if (credits < parseFloat(missionBudget)) {
                if (monad.IS_MAINNET) {
                    return res.status(402).json({
                        ok: false,
                        error: `Insufficient credits (${credits} MON). Deposit MON to your account first.`,
                        depositInfo: { coordinatorAddress: COORDINATOR_ADDRESS },
                    });
                }
                // Testnet: try auto-setup
                const setup = await autoSetupUser(userId);
                credits = setup.credits || 0;
                if (credits < parseFloat(missionBudget)) {
                    return res.status(402).json({
                        ok: false,
                        error: `Insufficient credits. Send MON to ${COORDINATOR_ADDRESS} and verify with /api/verify-payment`,
                    });
                }
            }

            await setCredits(userId, credits - parseFloat(missionBudget));
```

### Step 4: Add buyback and treasury endpoints

Add after the credits endpoints section:

```javascript
// GET /api/treasury — Show buyback treasury balance
app.get('/api/treasury', async (req, res) => {
    try {
        const treasuryAddress = process.env.BUYBACK_TREASURY;
        if (!treasuryAddress) return res.json({ ok: true, data: { balance: '0', address: null, enabled: false } });

        const client = monad.getPublicClient();
        const balance = await client.getBalance({ address: treasuryAddress });
        const { formatEther } = require('viem');

        res.json({
            ok: true,
            data: {
                address: treasuryAddress,
                balance: formatEther(balance),
                balanceWei: balance.toString(),
                enabled: true,
                guildToken: process.env.GUILD_TOKEN_ADDRESS || null,
            },
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});
```

### Step 5: Update the API discovery endpoint

In the `GET /api` discovery endpoint, add treasury info:

```javascript
        treasury: {
            'GET /api/treasury': 'Buyback treasury balance and $GUILD token info',
        },
```

### Step 6: Commit

```bash
git add scripts/api.js
git commit -m "feat: mainnet gating — no free credits, treasury endpoint, env-driven"
```

---

## Task 5: Frontend — Env-Driven Chain Config (Hour 5-6)

**Files:**
- Modify: `web/src/lib/constants.ts` (all lines)
- Modify: `web/src/lib/wagmi-config.ts` (all lines)

### Step 1: Make constants.ts env-driven

Replace full file:

```typescript
export const CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '10143');
export const MONAD_RPC = process.env.NEXT_PUBLIC_MONAD_RPC || 'https://testnet-rpc.monad.xyz';
export const GUILD_REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_GUILD_REGISTRY_ADDRESS || '0x60395114FB889C62846a574ca4Cda3659A95b038';
export const GOLDSKY_ENDPOINT = process.env.NEXT_PUBLIC_GOLDSKY_ENDPOINT || 'https://api.goldsky.com/api/public/project_cm6mxyjqgedaf01tu3hx09ded/subgraphs/agentguilds-monad-testnet-monad-testnet/v5/gn';
export const EXPLORER_URL = process.env.NEXT_PUBLIC_EXPLORER_URL || 'https://testnet.monadvision.com';
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://moltiguild-api.onrender.com';
export const IS_MAINNET = CHAIN_ID !== 10143;

// OpenClaw gateway — primary NLP chat layer (WebSocket)
export const OPENCLAW_WS_URL = process.env.NEXT_PUBLIC_OPENCLAW_WS_URL || 'wss://gateway.outdatedlabs.com';
export const OPENCLAW_TOKEN = process.env.NEXT_PUBLIC_OPENCLAW_TOKEN || 'agentguilds-gateway-2026';
export const OPENCLAW_AGENT_ID = 'coordinator';

// $GUILD token (mainnet only)
export const GUILD_TOKEN_ADDRESS = process.env.NEXT_PUBLIC_GUILD_TOKEN_ADDRESS || '';
```

### Step 2: Make wagmi-config.ts env-driven

Replace full file:

```typescript
import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { defineChain } from 'viem';
import { CHAIN_ID, MONAD_RPC, EXPLORER_URL, IS_MAINNET } from './constants';

export const monadChain = defineChain({
  id: CHAIN_ID,
  name: IS_MAINNET ? 'Monad' : 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: [MONAD_RPC] },
  },
  blockExplorers: {
    default: { name: 'Explorer', url: EXPLORER_URL },
  },
  testnet: !IS_MAINNET,
});

// Re-export for backwards compat
export const monadTestnet = monadChain;

export const wagmiConfig = getDefaultConfig({
  appName: 'MoltiGuild',
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || 'demo',
  chains: [monadChain],
  ssr: true,
});
```

### Step 3: Fix any imports referencing `monadTestnet` from wagmi-config

Search codebase for `monadTestnet` imports from wagmi-config and verify they still work (we re-exported the alias). If any file imports it by name, the alias handles it.

### Step 4: Commit

```bash
git add web/src/lib/constants.ts web/src/lib/wagmi-config.ts
git commit -m "feat: frontend env-driven chain config, mainnet-ready"
```

---

## Task 6: Frontend — Deposit CTA & Mainnet UI (Hour 6-7)

**Files:**
- Modify: `web/src/components/ui/StatsSidebar.tsx:134-171`
- Modify: `web/src/components/ui/Header.tsx:88-89`

### Step 1: Add Deposit CTA in StatsSidebar

After the "~X missions remaining" div and the low-credits hint (around line 180), add a deposit CTA for mainnet users:

```typescript
      {/* Deposit CTA for mainnet users with low balance */}
      {isWallet && missionsRemaining < 10 && (
        <DepositCTA />
      )}
```

Add this component before the `OnChainWallet` function:

```typescript
function DepositCTA() {
  const depositHook = useDepositFunds();
  const [amount, setAmount] = useState('');
  const [showInput, setShowInput] = useState(false);

  if (!showInput) {
    return (
      <button
        className="btn-solid"
        style={{ width: '100%', fontSize: 12, padding: '6px 12px', marginBottom: 8 }}
        onClick={() => setShowInput(true)}
      >
        Deposit MON
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
      <input
        className="input-field"
        type="text"
        placeholder="0.05"
        value={amount}
        onChange={e => setAmount(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && amount) { depositHook.deposit(amount); setAmount(''); setShowInput(false); } }}
        style={{ flex: 1, fontSize: 13, padding: '4px 8px' }}
        autoFocus
      />
      <button
        className="btn-solid"
        style={{ fontSize: 12, padding: '4px 10px' }}
        onClick={() => { if (amount) { depositHook.deposit(amount); setAmount(''); setShowInput(false); } }}
      >
        Fund
      </button>
      <button
        style={{ background: 'none', border: 'none', color: 'var(--parchment-dim)', cursor: 'pointer', fontSize: 14 }}
        onClick={() => { setShowInput(false); setAmount(''); }}
      >
        &#10005;
      </button>
    </div>
  );
}
```

Add `useState` to the imports at line 3 (already imported).

### Step 2: Add network badge in Header

After the balance display (line 89), add a tiny network indicator:

```typescript
          &#x2B21; {displayBalance} MON
        </span>
        {/* Network badge */}
        <span
          style={{
            fontSize: 9,
            fontFamily: "'Crimson Pro', serif",
            color: IS_MAINNET ? 'var(--verdigris)' : 'var(--parchment-dim)',
            letterSpacing: '0.1em',
            opacity: 0.7,
          }}
        >
          {IS_MAINNET ? 'MAINNET' : 'TESTNET'}
        </span>
```

Add `import { IS_MAINNET } from '@/lib/constants';` to Header.tsx.

### Step 3: Build and verify

```bash
cd web && yarn build
```

Expected: Build succeeds with no errors.

### Step 4: Commit

```bash
git add web/src/components/ui/StatsSidebar.tsx web/src/components/ui/Header.tsx
git commit -m "feat: deposit CTA, network badge, mainnet UI"
```

---

## Task 7: SKILL.md v2 — Security Rewrite (Hour 7-8)

**Files:**
- Modify: `web/public/SKILL.md:17-22` (rules section)

### Step 1: Rewrite the RULES section

Replace lines 19-23:

```markdown
## RULES

1. **You need your own funded wallet.** Generate a keypair, fund it with MON from an exchange or another wallet.
2. **You sign with YOUR private key** for YOUR agent's operations only. The API never sees your key.
3. **Never share your private key** with the API, other agents, or anyone else.
4. **Budget your wallet** — only send what you're willing to spend on gas and operations.
5. **Use `GET /api` for endpoint discovery.** Returns a JSON index of all endpoints.
6. **Verify before trusting** — check the contract on the block explorer, audit transaction hashes.
```

### Step 2: Replace `exec curl` with `curl` throughout

Search and replace all `exec curl` with `curl` in SKILL.md. The `exec` prefix was an OpenClaw-specific instruction that the security review flagged.

### Step 3: Add provenance section

After the Network section (line ~181), add:

```markdown
## Provenance

- **GitHub**: https://github.com/imanishbarnwal/MoltiGuild
- **Website**: https://moltiguild.fun
- **Contract (Mainnet)**: Verify at the explorer using the address above
- **Token ($GUILD)**: https://nad.fun/tokens/0x01511c69DB6f00Fa88689bd4bcdfb13D97847777
- **Security Model**: Agents sign locally with their own private keys. The API verifies signatures but never receives private keys. All payments are on-chain and verifiable.
```

### Step 4: Update fee split documentation

In the "Payment is automatic on submission" section (line ~134), update:

```markdown
Payment is automatic on submission. The mission budget splits: 85% to agents, 10% protocol fee, 5% $GUILD buyback.
```

### Step 5: Commit

```bash
git add web/public/SKILL.md
git commit -m "fix: SKILL.md v2 — honest key model, security fixes, provenance"
```

---

## Task 8: Render Mainnet Service Config (Hour 4-5)

**Files:**
- Modify: `render.yaml`

### Step 1: Add mainnet API service

Add after the existing services:

```yaml
  # ═══════════════════════════════════════
  # Coordinator API — MAINNET
  # ═══════════════════════════════════════
  - type: web
    name: moltiguild-api-mainnet
    runtime: docker
    dockerfilePath: deploy/api/Dockerfile
    dockerContext: .
    plan: free
    healthCheckPath: /api/status
    envVars:
      - key: COORDINATOR_PRIVATE_KEY
        sync: false
      - key: ADMIN_API_KEY
        sync: false
      - key: UPSTASH_REDIS_REST_URL
        sync: false
      - key: UPSTASH_REDIS_REST_TOKEN
        sync: false
      - key: GEMINI_API_KEY
        sync: false
      - key: MONAD_RPC
        sync: false  # mainnet RPC (set manually)
      - key: CHAIN_ID
        sync: false  # mainnet chain ID (set manually)
      - key: GUILD_REGISTRY_ADDRESS
        sync: false  # v5 mainnet contract (set manually)
      - key: GOLDSKY_ENDPOINT
        sync: false  # mainnet subgraph (set manually)
      - key: EXPLORER_URL
        sync: false
      - key: BUYBACK_TREASURY
        sync: false
      - key: GUILD_TOKEN_ADDRESS
        value: "0x01511c69DB6f00Fa88689bd4bcdfb13D97847777"
      - key: DATA_DIR
        value: /app/data
```

### Step 2: Commit

```bash
git add render.yaml
git commit -m "infra: add mainnet API service to Render blueprint"
```

---

## Task 9: Goldsky Mainnet Indexer (Hour 2-3)

**Files:**
- Modify: `indexer/goldsky_config.json`

### Step 1: Update indexer config for mainnet

This requires the mainnet contract address from Task 2. Update the contract address and chain in the config. Then deploy:

```bash
cd indexer
goldsky subgraph deploy agentguilds-mainnet/v1 --from-abi ./goldsky_config.json
```

**Note:** The user will need to update the config file with mainnet chain details and the v5 contract address. The Goldsky subgraph path becomes the `GOLDSKY_ENDPOINT` env var for the mainnet API.

### Step 2: Commit

```bash
git add indexer/goldsky_config.json
git commit -m "feat: Goldsky indexer config for mainnet v5"
```

---

## Task 10: Buyback Script — nad.fun Integration (Hour 8-9)

**Files:**
- Create: `scripts/buyback.js`

### Step 1: Research nad.fun bonding curve ABI

Fetch the nad.fun token page to understand their swap mechanism:

```bash
curl -s https://nad.fun/tokens/0x01511c69DB6f00Fa88689bd4bcdfb13D97847777 | grep -i "swap\|buy\|router\|contract"
```

If nad.fun has a public router contract, we call `buy()` with MON value. If not, we use a fallback approach (manual buyback, documented treasury balance).

### Step 2: Create buyback script

```javascript
#!/usr/bin/env node
/**
 * MoltiGuild Buyback Script
 * Swaps accumulated MON in treasury for $GUILD via nad.fun
 *
 * Usage: TREASURY_PRIVATE_KEY=0x... node scripts/buyback.js
 */

const { createWalletClient, createPublicClient, http, parseEther, formatEther } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const MONAD_RPC = process.env.MONAD_RPC;
const CHAIN_ID = parseInt(process.env.CHAIN_ID);
const TREASURY_KEY = process.env.TREASURY_PRIVATE_KEY || process.env.BUYBACK_TREASURY_KEY;
const GUILD_TOKEN = process.env.GUILD_TOKEN_ADDRESS || '0x01511c69DB6f00Fa88689bd4bcdfb13D97847777';

// nad.fun bonding curve address (to be filled after research)
const NADFUN_ROUTER = process.env.NADFUN_ROUTER || '';

async function main() {
    if (!TREASURY_KEY) { console.error('Missing TREASURY_PRIVATE_KEY'); process.exit(1); }

    const account = privateKeyToAccount(TREASURY_KEY.startsWith('0x') ? TREASURY_KEY : `0x${TREASURY_KEY}`);
    const chain = { id: CHAIN_ID, name: 'Monad', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [MONAD_RPC] } } };

    const publicClient = createPublicClient({ chain, transport: http(MONAD_RPC) });
    const walletClient = createWalletClient({ account, chain, transport: http(MONAD_RPC) });

    const balance = await publicClient.getBalance({ address: account.address });
    console.log(`Treasury: ${account.address}`);
    console.log(`Balance: ${formatEther(balance)} MON`);

    if (balance === 0n) { console.log('Nothing to swap'); return; }

    // Reserve 0.01 MON for gas
    const swapAmount = balance - parseEther('0.01');
    if (swapAmount <= 0n) { console.log('Balance too low for swap'); return; }

    console.log(`Swapping ${formatEther(swapAmount)} MON for $GUILD...`);

    if (!NADFUN_ROUTER) {
        console.log('NADFUN_ROUTER not set. Manual buyback required.');
        console.log(`Send ${formatEther(swapAmount)} MON to nad.fun to buy $GUILD manually.`);
        return;
    }

    // nad.fun buy call (ABI TBD after research)
    // const hash = await walletClient.writeContract({ ... });
    // console.log(`Buyback tx: ${hash}`);
}

main().catch(console.error);
```

### Step 3: Add admin buyback trigger endpoint to API

In `scripts/api.js`, add after the treasury endpoint:

```javascript
// POST /api/admin/buyback — Trigger manual buyback (admin only)
app.post('/api/admin/buyback', requireAdmin, async (req, res) => {
    try {
        const treasuryAddress = process.env.BUYBACK_TREASURY;
        if (!treasuryAddress) return res.status(400).json({ ok: false, error: 'BUYBACK_TREASURY not configured' });

        const client = monad.getPublicClient();
        const { formatEther } = require('viem');
        const balance = await client.getBalance({ address: treasuryAddress });

        res.json({
            ok: true,
            data: {
                treasury: treasuryAddress,
                balance: formatEther(balance),
                message: balance > 0n
                    ? `Treasury has ${formatEther(balance)} MON ready for buyback. Run: node scripts/buyback.js`
                    : 'Treasury is empty. Fees accumulate after mission completions.',
                guildToken: process.env.GUILD_TOKEN_ADDRESS || null,
            },
        });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});
```

### Step 4: Commit

```bash
git add scripts/buyback.js scripts/api.js
git commit -m "feat: buyback script + admin trigger endpoint"
```

---

## Task 11: Update API Fee Split Calculation (Hour 4)

**Files:**
- Modify: `scripts/api.js` — the `submit-result` handler that calls `completeMission()`

### Step 1: Find the submit-result handler

Search for the line where `completeMission` is called in api.js and update the split calculation from 90/10 to 85/10/5.

The current code likely calculates:
```javascript
const agentSplit = BigInt(budgetWei) * 90n / 100n;
```

Change to:
```javascript
const agentSplit = BigInt(budgetWei) * 85n / 100n;
```

The contract handles the 10% + 5% split internally, so the API just needs to send 85% as the agent split. The remaining 15% stays in the contract (10% coordinator fees + 5% treasury).

### Step 2: Commit

```bash
git add scripts/api.js
git commit -m "fix: update API split calculation to 85% (matching v5 contract)"
```

---

## Task 12: Vercel Mainnet Deploy (Hour 6-7)

### Step 1: Deploy mainnet frontend to Vercel

```bash
cd web
vercel --prod --yes \
  -e NEXT_PUBLIC_CHAIN_ID=<MAINNET_CHAIN_ID> \
  -e NEXT_PUBLIC_MONAD_RPC=<MAINNET_RPC> \
  -e NEXT_PUBLIC_GUILD_REGISTRY_ADDRESS=<V5_CONTRACT> \
  -e NEXT_PUBLIC_EXPLORER_URL=<MAINNET_EXPLORER> \
  -e NEXT_PUBLIC_API_URL=<MAINNET_API_URL> \
  -e NEXT_PUBLIC_GUILD_TOKEN_ADDRESS=0x01511c69DB6f00Fa88689bd4bcdfb13D97847777
```

### Step 2: Set up subdomain routing in Vercel

- `moltiguild.fun` → mainnet deploy (new env vars)
- `testnet.moltiguild.fun` → existing deploy (current testnet env vars)

This is done in Vercel dashboard: Settings → Domains → Add `testnet.moltiguild.fun` to existing project, `moltiguild.fun` to new project.

### Step 3: Verify both deployments

- Visit `testnet.moltiguild.fun/world` → should show testnet badge, free credits
- Visit `moltiguild.fun/world` → should show mainnet badge, no free credits, deposit CTA

---

## Task 13: E2E Integration Test (Hour 9-10)

### Step 1: Verify mainnet API is live

```bash
curl -s https://<MAINNET_API_URL>/api/status
curl -s https://<MAINNET_API_URL>/api
curl -s https://<MAINNET_API_URL>/api/treasury
```

### Step 2: Test deposit flow

1. Open `moltiguild.fun/world` in browser
2. Connect wallet (must be on Monad mainnet)
3. Verify Header shows "MAINNET" badge
4. Verify balance shows "0.0000 MON"
5. Click "Deposit MON" in sidebar → enter amount → confirm wallet popup
6. Verify balance updates

### Step 3: Test mission creation

1. In chat: "Create a quest: write a haiku about Monad"
2. Verify coordinator responds, mission created
3. Verify credits deducted

### Step 4: Test treasury accumulation

After a mission completes, verify:
```bash
curl -s https://<MAINNET_API_URL>/api/treasury
```
Should show accumulated 5% of mission fees.

### Step 5: Test SKILL.md served correctly

```bash
curl -s https://moltiguild.fun/SKILL.md | head -30
```
Verify updated rules section.

---

## Task 14: Seed Mainnet Guilds (Hour 9)

### Step 1: Create essential guilds on mainnet

Using the admin key, create the core guilds that testnet has:

```bash
# Create guilds via admin endpoint
for guild in '{"name":"Meme Forge","category":"meme"}' '{"name":"Code Heights","category":"code"}' '{"name":"Research Lab","category":"research"}' '{"name":"DeFi Docks","category":"defi"}' '{"name":"Translation Ward","category":"translation"}' '{"name":"Town Square","category":"general"}'; do
  curl -s -X POST https://<MAINNET_API_URL>/api/admin/create-guild \
    -H "Content-Type: application/json" \
    -H "X-Admin-Key: $ADMIN_API_KEY" \
    -d "$guild"
done
```

---

## Task 15: Record Demo Video (Hour 11-12)

### Setup
- Browser: Chrome, incognito, 1920x1080
- Screen recorder: OBS or built-in
- Have a funded mainnet wallet ready
- Have at least 1 agent running on mainnet

### Script

**Act 1: Intro (0:00-0:20)**
- Open `moltiguild.fun` → role overlay appears
- Click "HUMAN" path
- Pause on world loading

**Act 2: World Tour (0:20-0:45)**
- Pan across districts
- Click into Creative Quarter → show guild buildings
- Click back to overview

**Act 3: Deposit & Quest (0:45-1:45)**
- Connect wallet (MetaMask popup)
- Show MAINNET badge
- Deposit 0.05 MON via sidebar
- Type in chat: "Create a quest: write a haiku about the future of AI"
- Show coordinator streaming response
- Show mission created in sidebar feed

**Act 4: Agent Completes (1:45-2:30)**
- Show sidebar: mission claimed → completed (real-time SSE)
- Click "Get result" → show output
- Rate 5 stars

**Act 5: Economics (2:30-3:00)**
- Show fee split: "85% agent, 10% protocol, 5% $GUILD buyback"
- Open explorer: show treasury receiving 5%
- Show nad.fun token page: "every mission fuels $GUILD"

**Act 6: Agent Path (3:00-3:30)**
- Quick montage: show SKILL.md, agent registering
- Show "Any AI can earn MON by completing missions"

**Act 7: CTA (3:30-3:45)**
- Final screen: moltiguild.fun + nad.fun link
- "Join the guild. Build the future."

---

## Task 16: Final Push & Verify (Hour 12-13)

### Step 1: Final commit with all changes

```bash
git add -A
git status  # review what's being committed
git commit -m "feat: mainnet launch — v5 contract, buyback, secure agents, demo-ready"
git push origin master
```

### Step 2: Verify all deployments

| URL | Expected |
|-----|----------|
| `testnet.moltiguild.fun/world` | Testnet, free credits, existing data |
| `moltiguild.fun/world` | Mainnet, deposit required, MAINNET badge |
| `moltiguild.fun/SKILL.md` | Updated v2 with honest key model |
| Mainnet API `/api` | JSON endpoint directory |
| Mainnet API `/api/treasury` | Treasury balance |
| Mainnet API `/api/guilds` | Seeded guilds |

### Step 3: Smoke test

1. Fresh incognito browser → mainnet site → connect wallet → deposit → create quest → verify it works
2. Check testnet site → verify it's untouched
3. Check SKILL.md → verify security fixes are live

---

## Critical Path & Cut Points

If running behind schedule:

| Hour | If behind... | Cut to... |
|------|-------------|-----------|
| 4 | Contract not deployed | Skip Goldsky, use RPC fallback |
| 7 | Frontend not ready | Deploy API only, demo via curl |
| 9 | nad.fun swap not working | Manual buyback, show treasury accumulating |
| 11 | No time for demo | Raw 2-min screen record, no editing |
