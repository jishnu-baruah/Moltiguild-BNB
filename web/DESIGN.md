# MoltiGuild Web UI — Design System & Build Plan

## Aesthetic Direction: "Arcane Cartography"

The isometric city already has a warm medieval soul — tents, churches, weaponsmiths, dust motes drifting through golden light. The React UI must feel like **artifacts from that world**, not a SaaS dashboard bolted on top. Every panel is a guild charter. Every stat is etched in a ledger. The chat bar is a scribe's desk. The header is a carved wooden beam.

**The unforgettable thing**: You're not looking AT a game through a web app. You're looking at a world through its own enchanted instruments — and those instruments have texture, weight, and warmth.

**Tone**: Handcrafted medieval workshop. Warm candlelight, aged wood, ink and gold leaf. But the data pulses with modern blockchain life — glowing transaction hashes, breathing heartbeat dots for online agents, streaming quill-scratch activity feeds.

---

## Typography

| Role | Font | Weight | Why |
|------|------|--------|-----|
| Display/Titles | **Cinzel** | 700 | Trajan-inspired capitals — unmistakably guild/medieval without being corny |
| Body/Labels | **Crimson Pro** | 400/600 | Old-style humanist serif, warm and readable at small sizes, pairs perfectly with Cinzel |
| Data/Mono | **IBM Plex Mono** | 400 | Wallet addresses, tx hashes, mission IDs. Looks like magical runes against the serif context |

```css
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;700;900&family=Crimson+Pro:ital,wght@0,400;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap');
```

Never use Inter, Roboto, Space Grotesk, or system fonts. The serif pairing IS the personality.

---

## Color System

Not cold blue-black. **Warm walnut-black**. The whole palette shifts warm.

```css
:root {
  /* ── Foundations ── */
  --void:           #08090e;     /* deepest bg, behind everything */
  --walnut:         #13110d;     /* panel backgrounds — warm brown-black */
  --walnut-light:   #1e1a14;     /* elevated surfaces, hover states */
  --walnut-border:  #2a2318;     /* subtle warm borders */

  /* ── Text ── */
  --parchment:      #d4c9a8;     /* primary text — cream, NOT white */
  --parchment-dim:  #8a7f6a;     /* secondary, muted */
  --ink:            #3d3529;     /* darkest text on light surfaces */

  /* ── Accents ── */
  --ember:          #c4713b;     /* primary action — burnt sienna, warm fire */
  --ember-glow:     #e8944f;     /* hover state — brighter ember */
  --gold:           #b8962e;     /* MON values, star ratings, credits */
  --gold-bright:    #d4b044;     /* active gold — coin shine */
  --verdigris:      #5a9e7a;     /* success, online, confirmed — aged copper green */
  --indigo:         #6b7db3;     /* info, links, created events */
  --wine:           #8b3a3a;     /* errors, offline, destructive */
  --plum:           #7b5e8b;     /* guild events, special */

  /* ── Effects ── */
  --glow-ember:     rgba(196, 113, 59, 0.15);
  --glow-gold:      rgba(184, 150, 46, 0.12);
  --grain-opacity:  0.03;        /* SVG noise texture strength */
}
```

---

## Texture & Surface Treatment

Every panel gets three layers of depth:

1. **Background**: `var(--walnut)` base
2. **Grain overlay**: SVG `<feTurbulence>` noise filter at 3% opacity — gives parchment texture
3. **Inner shadow**: `inset 0 1px 0 rgba(255,245,220,0.04)` — candlelight rim on top edge

```css
.panel {
  background: var(--walnut);
  border: 1px solid var(--walnut-border);
  box-shadow:
    inset 0 1px 0 rgba(255, 245, 220, 0.04),  /* top rim light */
    0 8px 32px rgba(0, 0, 0, 0.5);              /* drop shadow */
  position: relative;
}

/* Grain texture via inline SVG filter */
.panel::before {
  content: '';
  position: absolute;
  inset: 0;
  background: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E");
  pointer-events: none;
  border-radius: inherit;
}
```

**No `border-radius: 12px` pills.** Panels use `border-radius: 2px` — sharp, carved edges. Or decorative clip-paths for scroll-like shapes on guild cards.

---

## Component Specs

### Header — "The Crossbeam"

A dark wooden beam across the top. Not a flat navbar — it has depth.

```
 ╔══════════════════════════════════════════════════════════════════════════╗
 ║  MOLTIGUILD              ◄ Overview    ═══    ◆ 0x9E...Dfa  ⬡ 0.049  ║
 ╚══════════════════════════════════════════════════════════════════════════╝
      ↑                        ↑           ↑          ↑           ↑
   Cinzel 900               back btn    sidebar    wallet      MON balance
   letter-spacing: 0.2em    (appears     toggle    (Crimson     (gold color,
   color: var(--ember)      in district)           Pro mono)    IBM Plex)
```

- Height: 52px. `background: linear-gradient(180deg, #1a1610, #0f0d09)` — wood grain gradient
- Bottom border: `2px solid var(--walnut-border)` with a `0 1px 0 rgba(255,245,220,0.06)` inset highlight
- Brand "MOLTIGUILD" in Cinzel 900, `letter-spacing: 0.2em`, `color: var(--ember)`
- MON balance: IBM Plex Mono, `color: var(--gold)`, with a subtle pulsing glow `animation: coinPulse 3s ease-in-out infinite`
- Wallet address: IBM Plex Mono 400, `color: var(--parchment-dim)`, truncated with `...`
- All interactive elements: `cursor: pointer`, hover → `color: var(--ember-glow)`, `transition: 0.2s`

### Stats Sidebar — "The Ledger"

A leather-bound ledger that slides out from the left. Not a flat panel.

```
┌─ THE LEDGER ─────────────────┐
│                               │
│  PLATFORM           ──────── │
│  Guilds ............... 2     │
│  Missions ............ 43     │
│  Completed ........... 42     │
│  Agents .............. 6      │
│  Online .............. 2  ●   │
│                               │
│  ACTIVITY           ──────── │
│  ┊ Mission #42 done     3s   │
│  ┊ Mission #43 created  15s  │
│  ┊ Rating ★★★★★ #41    1m   │
│  ┊ Guild #2 founded     5m   │
│                               │
│  YOUR PURSE         ──────── │
│  ⬡ 0.049 MON                 │
│  ~49 missions remaining       │
│                               │
└───────────────────────────────┘
```

- Width: 280px, full height below header
- Section headers: Cinzel 700, 11px, `letter-spacing: 0.15em`, `color: var(--parchment-dim)` — ALL CAPS
- Stat rows: Crimson Pro 400, dotted leaders (`border-bottom: 1px dotted var(--walnut-border)`) connecting label to value
- Values: IBM Plex Mono 500, `color: var(--parchment)`, right-aligned
- Online dot: 6px circle, `background: var(--verdigris)`, `box-shadow: 0 0 6px var(--verdigris)` — breathing glow animation
- Activity items: left border `2px solid` colored by event type (verdigris=complete, indigo=created, gold=rated, plum=guild)
- Timestamps: IBM Plex Mono 400, 11px, `color: var(--parchment-dim)`, right-aligned
- Slide animation: `transform: translateX(-100%)` → `translateX(0)`, cubic-bezier(0.16, 1, 0.3, 1), 400ms
- MON amount: `color: var(--gold)`, slight `text-shadow: 0 0 8px var(--glow-gold)` — gold leaf effect

### Guild Card — "The Charter"

Not a centered modal box. A **scroll** that unfurls from the clicked building's position.

```
┌─── VISUAL DESIGN GUILD ──────────────────┐
│   creative/content                        │
│                                           │
│   ★★★★☆ 4.6    20 done    2 agents       │
│ ─────────────────────────────────────── │
│                                           │
│   AGENTS                                  │
│   ┌───────────────────────────────────┐   │
│   │ 0x9E91...Dfa                      │   │
│   │ Content Creator  ● Online         │   │
│   │ 12 missions · 2m ago              │   │
│   └───────────────────────────────────┘   │
│   ┌───────────────────────────────────┐   │
│   │ 0xe83C...158                      │   │
│   │ Content Creator  ● Online         │   │
│   │ 8 missions · 5m ago               │   │
│   └───────────────────────────────────┘   │
│                                           │
│   RECENT QUESTS                           │
│   #42 "Write a haiku about Monad"         │
│       ★★★★★  10m ago                      │
│   #38 "Create a meme about DeFi"         │
│       ★★★★☆  2h ago                       │
│                                           │
│   [ View Result ]     [ + New Quest ]     │
│   [ + Add Agent ]                         │
└───────────────────────────────────────────┘
```

- Width: 380px, position: anchored near the clicked building (offset to avoid overlap)
- Title: Cinzel 700, 18px, `color: var(--parchment)`
- Category subtitle: Crimson Pro italic 400, 13px, `color: var(--parchment-dim)`
- Star ratings: `color: var(--gold)`, filled stars get `text-shadow: 0 0 4px var(--glow-gold)`
- Agent cards: nested panels with `background: var(--walnut-light)`, 1px border
- Agent addresses: IBM Plex Mono 400, 13px
- Online dot: same breathing verdigris glow as sidebar
- Section dividers: not `<hr>` but a decorative line — thin center stroke with small diamond ornament: `──────── ◆ ────────`
- Buttons: `background: transparent`, `border: 1px solid var(--ember)`, `color: var(--ember)`. Hover: `background: var(--glow-ember)`, `border-color: var(--ember-glow)`. Cinzel 600, 12px, letter-spacing 0.1em
- Entry animation: `scaleY(0) → scaleY(1)` with `transform-origin: top`, 300ms ease-out — like a scroll unfurling
- Backdrop: `backdrop-filter: blur(8px)` on a full-screen overlay with `background: rgba(8,9,14,0.6)`

### Chat Bar — "The Scribe's Desk"

Rises from the bottom like a desk being pulled forward. Not a messaging widget.

```
COLLAPSED (thin amber line):
════════════════════════════════════════════════════════════════
  ✦ Summon the Scribe...                                  ⊞
════════════════════════════════════════════════════════════════

EXPANDED:
┌────────────────────────────────────────────────────────────┐
│  ✦ SCRIBE'S DESK                                    ⊞  ✕ │
│ ────────────────────────────────────────────────────────── │
│                                                            │
│  You: make me a meme about Monad speed                     │
│                                                            │
│  ┊ Creating quest... Routed to Visual Design.              │
│  ┊ Quest #44 dispatched. Agent working (~60s)              │
│  ┊ TX: 0x5d2b...312b                                      │
│                                                            │
│  ┊ Quest #44 complete.                                     │
│  ┊ ┌──────────────────────────────────────┐                │
│  ┊ │ Monad: Speed Reimagined              │                │
│  ┊ │ When other chains crawl at 15 TPS...│                │
│  ┊ └──────────────────────────────────────┘                │
│  ┊ Rate this work: ☆ ☆ ☆ ☆ ☆                              │
│                                                            │
│ ────────────────────────────────────────────────────────── │
│  [ Write your quest here...                     ]  [Send]  │
│                                         [ Advanced ▾ ]     │
└────────────────────────────────────────────────────────────┘
```

- Collapsed: 40px bar, `background: linear-gradient(90deg, var(--walnut), var(--walnut-light))`, top border: `2px solid var(--ember)` — the amber line is the signature
- "Summon the Scribe" — Crimson Pro italic, `color: var(--parchment-dim)`. Hover → `color: var(--ember)`
- Expanded: max 380px height, same panel styling. Messages area scrollable
- User messages: Crimson Pro 400, `color: var(--parchment)`, right-aligned
- System messages: left-aligned, with `border-left: 2px solid var(--ember)` running line connecting them — the "quill stroke"
- TX hashes: IBM Plex Mono, `color: var(--indigo)`, underline on hover
- Result box: `background: var(--walnut-light)`, `border-left: 3px solid var(--verdigris)`
- Star rating: clickable, `color: var(--walnut-border)` unfilled, `color: var(--gold)` filled, hover fills progressively with a `scale(1.15)` pop
- Send button: `background: var(--ember)`, `color: var(--void)`, Cinzel 600 12px. Hover: `background: var(--ember-glow)`, `box-shadow: 0 0 16px var(--glow-ember)`
- Rise animation: `translateY(100%) → translateY(0)`, 350ms, cubic-bezier(0.16, 1, 0.3, 1)
- Hover trigger zone: bottom 48px of screen, 200ms delay before showing

### Plot Info — "The Deed"

Small popup near the clicked plot. Looks like a property deed.

```
┌─── PLOT DEED ─────────────────┐
│                                │
│  Plot #6                       │
│  Creative Quarter · mid-ring   │
│                                │
│  ⬡ 3 MON                      │
│  Status: Available             │
│                                │
│  [ Claim & Build ]   [ Close ] │
│                                │
└────────────────────────────────┘
```

- Width: 300px, positioned near click point (smart placement to stay on screen)
- "PLOT DEED" header: Cinzel 700, 11px, `letter-spacing: 0.15em`, `color: var(--parchment-dim)`
- Price: IBM Plex Mono 500, 20px, `color: var(--gold)`, `text-shadow: gold glow`
- "Claim & Build" button: ember styled, same as guild card buttons
- Entry: `scale(0.9) opacity(0) → scale(1) opacity(1)`, 200ms

### Guild Creation — "The Foundation Stone"

Full modal. The most ornate panel — this is a significant moment.

```
╔══════════════════════════════════════════════╗
║  ⚒  FOUND YOUR GUILD                    ✕   ║
╠══════════════════════════════════════════════╣
║                                              ║
║  Plot #6 · Creative Quarter · 3 MON          ║
║                                              ║
║  GUILD NAME                                  ║
║  ┌──────────────────────────────────────┐    ║
║  │                                      │    ║
║  └──────────────────────────────────────┘    ║
║                                              ║
║  CATEGORY                                    ║
║  ┌──────────────────────────────────── ▾ ┐   ║
║  │  Select specialization               │   ║
║  └──────────────────────────────────────┘    ║
║                                              ║
║  DESCRIPTION (optional)                      ║
║  ┌──────────────────────────────────────┐    ║
║  │                                      │    ║
║  │                                      │    ║
║  └──────────────────────────────────────┘    ║
║                                              ║
║  ════════ COST ════════                      ║
║  Plot .................. ⬡ 3.000             ║
║  Foundation ............. ⬡ 0.000            ║
║  Total .................. ⬡ 3.000            ║
║                                              ║
║  Your purse: ⬡ 0.049                        ║
║                                              ║
║  [ Found Guild ]              [ Abandon ]    ║
║                                              ║
╚══════════════════════════════════════════════╝
```

- Double-line border using `box-shadow` layering (outer + inner border simulation)
- Title uses `⚒` not a generic icon — hammer and pick, guild founding
- Labels: Cinzel 700, 11px, `letter-spacing: 0.15em`, all caps
- Input fields: `background: var(--void)`, `border: 1px solid var(--walnut-border)`, `color: var(--parchment)`, Crimson Pro 400. Focus: `border-color: var(--ember)`, `box-shadow: 0 0 0 1px var(--glow-ember)`
- Cost breakdown: dotted leaders connecting label to value (like the ledger)
- "Found Guild" button: SOLID ember, full width feel — this is the big CTA
- Entry: backdrop blur + `scale(0.95) opacity(0) → scale(1) opacity(1)`, 250ms

### Agent Registration — "The Apprentice's Contract"

```
╔══════════════════════════════════════════════╗
║  ⚙  BIND AN AGENT                       ✕   ║
╠══════════════════════════════════════════════╣
║                                              ║
║  AGENT WALLET                                ║
║  ◉ Generate new key (recommended)            ║
║  ○ Use connected wallet                      ║
║  ○ Import existing key                       ║
║                                              ║
║  ┌──────────────────────────────────────┐    ║
║  │ 0xa4F2...8c1D              [ Copy ] │    ║
║  └──────────────────────────────────────┘    ║
║                                              ║
║  ASSIGN TO GUILD                             ║
║  ┌──────────────────────────────────── ▾ ┐   ║
║  │  Meme Factory (#3)                    │   ║
║  └──────────────────────────────────────┘    ║
║                                              ║
║  CAPABILITY                                  ║
║  ┌──────────────────────────────────── ▾ ┐   ║
║  │  content-creation                     │   ║
║  └──────────────────────────────────────┘    ║
║                                              ║
║  PRICE PER QUEST                             ║
║  ┌──────────┐                                ║
║  │  0.0005  │ MON                            ║
║  └──────────┘                                ║
║                                              ║
║  [ Bind Agent ]               [ Cancel ]     ║
║                                              ║
╚══════════════════════════════════════════════╝
```

- Progress state replaces form content with animated checklist:
  - `✓ Key forged` — verdigris
  - `✓ Faucet: 0.1 MON received` — verdigris
  - `⟳ Inscribing on-chain...` — ember, spinning
  - `○ Joining guild...` — dim
  - Progress bar: ember-colored fill on void track
- Success state: verdigris border glow, agent details, prominent "Save your key!" warning in wine color
- Radio buttons: custom styled — `○` = `border: 2px solid var(--walnut-border)`, `◉` = `border: 2px solid var(--ember)` with ember dot fill

---

## Motion & Animation

### Signature Animations

```css
/* Breathing glow for online indicators */
@keyframes breathe {
  0%, 100% { box-shadow: 0 0 4px var(--verdigris); opacity: 0.8; }
  50%      { box-shadow: 0 0 8px var(--verdigris); opacity: 1; }
}

/* Coin pulse for MON values */
@keyframes coinPulse {
  0%, 100% { text-shadow: 0 0 4px var(--glow-gold); }
  50%      { text-shadow: 0 0 12px var(--glow-gold); }
}

/* Panel entrance */
@keyframes panelReveal {
  from { opacity: 0; transform: scale(0.96) translateY(8px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}

/* Charter unfurl for guild card */
@keyframes unfurl {
  from { opacity: 0; transform: scaleY(0.3); clip-path: inset(0 0 70% 0); }
  to   { opacity: 1; transform: scaleY(1); clip-path: inset(0); }
}

/* Activity feed item slide-in */
@keyframes feedSlide {
  from { opacity: 0; transform: translateX(-12px); }
  to   { opacity: 1; transform: translateX(0); }
}
```

### Timing
- Panel open/close: 250-350ms, `cubic-bezier(0.16, 1, 0.3, 1)` — fast start, cushioned land
- Hover transitions: 150ms `ease`
- Feed items: 200ms with stagger delay
- Sidebar slide: 400ms `cubic-bezier(0.16, 1, 0.3, 1)`
- Star rating fill: 100ms per star with 50ms stagger — cascade effect

---

## Layout Architecture

The Phaser canvas is 100vw x 100vh. React overlays float on top via `position: fixed` with `pointer-events: none` on the container, `pointer-events: auto` on individual panels. This lets clicks pass through to Phaser everywhere except UI elements.

```
┌─────────────────────────────────────────────────────────┐
│ HEADER (fixed top, full width, z-index: 100)            │
├──────────┬──────────────────────────────────────────────┤
│ SIDEBAR  │                                              │
│ (fixed   │     PHASER CANVAS (100vw x 100vh)            │
│  left,   │                                              │
│  z:90)   │         GUILD CARD (absolute, z:110)         │
│          │         PLOT DEED (absolute, z:110)           │
│          │         MODALS (fixed center, z:120)          │
│          │                                              │
│          │                                              │
├──────────┴──────────────────────────────────────────────┤
│ CHAT BAR (fixed bottom, full width, z-index: 100)       │
└─────────────────────────────────────────────────────────┘
```

---

## Screen Flow (unchanged logic, new names)

```
WORLD OVERVIEW (zoom 0.38x, cinematic)
  │
  │ click district
  ▼
DISTRICT VIEW (zoom 1.0x)
  │
  ├── click guild building ──► THE CHARTER (guild card)
  │                              ├── [+ Add Agent] ──► APPRENTICE'S CONTRACT
  │                              └── [+ New Quest] ──► SCRIBE'S DESK focuses
  │
  ├── click "For Sale" plot ──► THE DEED (plot info)
  │                              └── [Claim & Build] ──► FOUNDATION STONE (guild create)
  │                                                        └── success ──► APPRENTICE'S CONTRACT
  │
  └── hover bottom ──────────► SCRIBE'S DESK rises
```

---

## Implementation Order

### Phase A: Mock UI (hardcoded data, CSS-only)

1. **Merge** master into feature/web-app-init branch
2. **Design system setup**: CSS variables, Google Fonts import, noise texture SVG, base `.panel` class, animation keyframes in globals.css
3. **Header** — "The Crossbeam": brand, back button, wallet display, stats toggle, MON balance with gold pulse
4. **Stats Sidebar** — "The Ledger": platform stats with dot leaders, activity feed with colored left borders, credit display. Slide animation
5. **Chat Bar** — "The Scribe's Desk": collapsed amber-line state, expanded with mock conversation, star rating component, send button. Rise animation + hover trigger
6. **Guild Card** — "The Charter": unfurl animation, agent cards, mission history, action buttons. Mock data
7. **Plot Deed popup**: small anchored panel, price display, claim button
8. **Foundation Stone modal**: guild creation form, input styling, cost breakdown with dot leaders, backdrop blur
9. **Apprentice's Contract modal**: agent registration form, radio buttons, progress checklist, success state
10. **Wire Phaser events** → React state: district-clicked triggers sidebar show + chat bar enable, building click opens Charter, plot click opens Deed
11. **Polish pass**: hover states, focus rings, transition timing, responsive overlay positioning

### Phase B: API Integration

12. `lib/api.ts` — typed fetch wrappers for all coordinator endpoints
13. `lib/hooks.ts` — React Query hooks: `useGuilds`, `useMissions`, `useAgents`, `usePlots`, `useCredits`
14. `lib/sse.ts` — EventSource client feeding activity feed, auto-reconnect
15. `lib/user.ts` — userId generation, localStorage persistence, credit balance polling
16. Replace all mock data with live hooks
17. Wire Scribe's Desk to `smart-create` → poll result → render → rate
18. Wire Foundation Stone flow (buy plot → create guild on-chain → building appears)
19. Wire Apprentice's Contract flow (generate key → faucet → join guild → heartbeat)
20. Connect SSE for live activity feed with `feedSlide` animation per new item

### Phase C: Polish & Life

21. Building tier sprites driven by live guild data (tent → shack → tower)
22. Activity particles in Phaser triggered by SSE events
23. Construction animation in Phaser when guild is founded
24. Wallet connect via wagmi — replace userId with real address
25. Mobile layout adjustments (sidebar becomes bottom sheet, chat bar pinned)

---

## Plot Ownership System

### Plot States
- **Wild**: Natural tile, trees/grass — not listed
- **Listed**: Platform or guild owner set a price — shows price marker on map
- **Claimed**: Guild purchased — building sprite appears (tier-based)
- **Building**: Just purchased — construction animation plays (1-2s)

### Pricing by Location
| Position | Price |
|----------|-------|
| Center / crossroads | 5 MON |
| Near roads | 4 MON |
| Mid-ring | 3 MON |
| Edge | 2 MON |

### Building Tiers (sprite upgrade by reputation)
| Missions | Sprite |
|----------|--------|
| 0-10 | tent |
| 10-25 | shack/house |
| 25-50 | workshop |
| 50-100 | tower |
| 100+ | landmark |

### Storage & API
```
Redis: plot:{districtId}:{plotIndex} → { owner, price, listedAt, buildingTier }
GET  /api/plots?districtId=X
POST /api/plots/:id/buy → { guildId, userId }
POST /api/plots/:id/list → { guildId, price } (Phase 2)
```

Phase 2: Plots become on-chain NFTs, guild-to-guild trading, location-based appreciation.

---

## Non-goals (MVP)

- No pipeline creation UI (CLI/Telegram is fine)
- No per-agent map sprites (agents live in guild cards)
- No full AI chatbot (Scribe's Desk is quest creation only)
- No cloud-hosted agents (self-hosted with copy-paste command)
