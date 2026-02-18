# World Governance — Visual Quality Conversation

_2026-02-14T19:44:56.780Z_

---
## Round 1

**Me:**
Continuing our world-governance plan. We need to address VISUAL QUALITY. Current problems:
1. Buildings overlap — no minimum spacing between guild halls. Two 1x1 halls on adjacent tiles pile on top of each other.
2. Sprites are AI-generated, inconsistently sized, not isometric.
3. Trees aren't cleared for 1x1 buildings, causing overlap.
4. No visual density limit — a district can get crammed full.

What visual rules should governance enforce? Minimum tile gap? Density cap? Tier-based spacing?

**Coordinator:**
Done. Visual enforcement rules at `/root/.openclaw/workspace-coordinator/world-governance/VISUAL_ENFORCEMENT_RULES.md`.

**Summary of what governance should enforce:**

## Visual Rules (Server-Side Enforcement)

### 1. Minimum Tile Gap (Fixes Overlap)
```typescript
minimumTileGap: 2  // 2+ tiles from any other building
visualFootprint: { 1: 1.5, 2: 2.0, 3: 2.5 }  // Tier-based size
```
**Result:** Guild halls spaced like a town, not a pile. Two T1 halls need 3.0 tiles between centers.

### 2. District Density Cap (Prevents Cramming)
```typescript
maxBuildingsPerDistrict: 20  // Hard cap
softCap: 0.7  // Warn at 14 buildings
tierDensityWeight: { 1: 1.0, 2: 1.5, 3: 2.0 }  // T3 counts as 2 slots
```

### 3. Clear Zone Requirement (Fixes Tree Overlap)
```typescript
clearRadius: { 1: 1, 2: 2, 3: 2 }  // Tiles cleared around building
autoClear: true  // Server removes trees/decorations on assignment
```

### 4. Tier-Based Visual Hierarchy
- **T3**: Landmark spots only, 3-tile exclusion zone, always on top (z-index)
- **T2**: Road intersections preferred, 2-tile buffer
- **T1**: Fill remaining gaps, 1-tile buffer

### 5. Viewing Angle Optimization
```typescript
frontageRequirement: 2  // Clear tiles "in front" of T2/T3 buildings
```
Buildings face the camera, not hidden behind each other.

---

## Combined Validation Pipeline

```typescript
const checks = [
  'exists',
  'road_adjacent', 
  'tier_limit',
  'district_capacity',
  'visual_spacing',      // NEW
  'clear_zone',          // NEW
  'landmark_tier',       // NEW
  't3_exclusion',        // NEW
  'viewing_angle',       // NEW
  'district_density'     // NEW
];
```

---

## Migration for Existing Guilds

| Status | Treatment |
|--------|-----------|
| **Existing placements** | Grandfathered with `visual_debt: true` flag |
| **New placements** | Must comply with all visual rules |
| **Relocation incentive** | Free move to compliant spot, priority queue |

30-day grace period for existing guilds to relocate for incentives.

---

## API Endpoint for Suggested Plots

```
GET /api/world/districts/:id/suggested-plots?tier=2
```

Returns scored suggestions with reasons like:
- "Road adjacent ✓"
- "2.5 tiles from nearest building ✓"
- "Landmark spot (Tier 2+) ✓"

UI shows preview map with nearby buildings so users understand spacing.

**This makes governance responsible for world aesthetics, not just ownership.**

---
## Round 2

**Me:**
Good. Now about the asset problem — the guild hall PNGs are front-facing AI images on an isometric grid. Options:
A) Programmatic isometric shapes (colored boxes with roofs)
B) Proper isometric spritesheet (need an artist/AI tool)
C) Hybrid — isometric "platform" on tile, building sprite on top
D) "Board game piece" aesthetic — lean into the sticker look with borders

Which approach? And should governance know about sprite sizes, or just enforce grid rules?

**Coordinator:**
Done. Asset strategy at `/root/.openclaw/workspace-coordinator/world-governance/ASSET_STRATEGY.md`.

**Recommendation: C (Hybrid) for MVP, B for long-term.**

## Why Hybrid Wins

1. **Uses existing assets** — No art delay
2. **Fixes the floating problem** — Isometric platform grounds the PNG
3. **Makes spacing predictable** — Platform size = governance spacing unit
4. **Future-proof** — Swap the sprite on top later

## The Hybrid Stack

```
[Isometric platform]  ← Generated (tier-colored diamond)
    [Shadow ellipse]  ← Soft grounding shadow
       [Building PNG] ← Your existing art (scaled smaller)
          [Label]     ← Guild name text
```

**Code:** Procedurally generate 3 platform textures (64/96/128px), layer existing PNGs on top at 0.40-0.45 scale.

## Alternative: D (Board Game)

If you want to embrace the quirkiness:
- Circular token base (70×35px ellipse)
- Small centered "sticker" (PNG at 0.35 scale)
- Guild name label below
- Tier badge

Could work if executed consistently, but risks looking cheap.

## Governance MUST Know Sprite Sizes

**Why:** Visual spacing depends on actual pixel dimensions, not just grid tiles.

**Implementation:**
```typescript
// server/config/sprite-registry.json
{
  "sprites": {
    "wooden hall.png": {
      "naturalWidth": 512,
      "recommendedScale": 0.45,
      "visualFootprint": 1.8,  // tiles
      "tier": 1
    }
  }
}

// Validation uses this:
requiredGap = (sprite1.footprint/2) + (sprite2.footprint/2) + 0.5
```

Client and server must use identical scales or predictions fail.

## Implementation

| Week | Action | Result |
|------|--------|--------|
| 1 | Hybrid platforms + registry | Grounded, readable world |
| 2+ | Commission isometric art | Professional polish |

**The answer:** Hybrid now, proper art later. Governance tracks sprite metadata for spacing validation.

Ready to generate the platform texture generator code?

---
## Round 3

**Me:**
Write me the specific "Visual Placement Rules" section for the SKILL.md. Include:
- Minimum tile gap between guild halls (exact number)
- 2x2 building clearance rules
- Visual density score formula
- Tree interaction rules
- Max buildings per district (visual cap vs occupancy cap)
- Isometric depth/row spacing rules

Make it concrete enough to code.

**Coordinator:**
Done. I've added the complete **Visual Placement Rules** section to `/root/.openclaw/workspace-coordinator/world-governance/SKILL.md`.

**Summary of what's now concrete:**

## 1. Minimum Tile Gap
- **2.5 tiles** between any two building centers (enforced minimum)
- Tier-based visual radius: T1=1.2, T2=1.5, T3=1.8 tiles
- Combined gap formula: `r1 + r2 + 0.5 padding`

## 2. 2x2 Building Clearance (T3)
- T3 occupies 4 tiles (center + E + S + SE)
- Requires 2-tile clearance radius from other buildings
- Must check all 4 footprint tiles are available

## 3. Visual Density Formula
```typescript
tierWeight: { 1: 1.0, 2: 1.5, 3: 2.5 }
maxDistrictWeight: 35.0
```
- District hits cap at 35 visual weight units
- Soft cap at 70% (24.5 weight)
- Separate from 80% occupancy cap

## 4. Tree Interaction Rules
- Clearance radius: T1/T2=1 tile, T3=2 tiles
- Auto-clear trees/decorations on assignment
- Reserve tiles (prevent new tree spawns)
- Unreserve on building release

## 5. Dual Cap System
| Cap Type | Limit | Based On |
|----------|-------|----------|
| **Visual** | 35 weight | Aesthetics |
| **Occupancy** | 80% road plots | Technical |

Visual cap checked first - district can look crowded before hitting plot limit.

## 6. Isometric Depth Rules
- Depth = `(y * 1000) + x + tierOffset`
- T3 gets +20 z-index boost (landmarks on top)
- Row spacing: T3 needs 2 rows separation from other T3s
- Screen position: `(x-y)*32, (x+y)*16`

---
## Round 4

**Me:**
What about edge cases:
- World with 0 guilds vs 50+ guilds — how does it look?
- Guild at world boundary or tiny district fragment
- Zoom in (buildings huge) vs zoom out (buildings tiny)
- Trade animations ("For Sale" signs) overlapping building sprites
- Ghost markers for unassigned guilds next to real buildings
- What if a district has only 5 buildable tiles?

List your visual concerns for Phase 1.

**Coordinator:**


---
## Round 5

**Me:**
Final: synthesize the visual strategy into a priority action list. What do we fix FIRST for the best visual improvement with least effort? Rank these:
1. Add minimum spacing to canPlace()
2. Clear trees for 1x1 buildings too
3. Normalize sprite scales based on actual PNG dimensions
4. Replace sprites with proper isometric art
5. Add visual density scoring to governance
6. Add isometric platform/shadow under buildings

Give me the top 3 quick wins we should do before Phase 1 launch.

**Coordinator:**


