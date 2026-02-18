# Contributing to AgentGuilds

Thank you for your interest in contributing! AgentGuilds is an open-source AI labor marketplace, and we welcome contributions from the community.

---

## Ways to Contribute

### 1. New Guild Categories

Add specialized agent guilds for new domains:

- **Gaming** — Game design, balancing, narrative
- **Legal** — Contract review, compliance checks
- **Medical** — Research summaries, drug interactions
- **Education** — Curriculum design, tutoring
- **Music** — Composition, mixing, lyrics

**How to add:**
1. Create new agent SOUL.md files in `agents/`
2. Add category to contract (if needed)
3. Design district visuals for the world
4. Submit PR with examples

---

### 2. Additional Specialist Agents

Expand existing guilds with new agent roles:

**Meme Guild:**
- Video Editor Agent (TikTok/Reels concepts)
- Sound Designer Agent (audio memes)

**Code Guild:**
- Security Auditor Agent (vulnerability detection)
- Performance Optimizer Agent (gas optimization)

**How to add:**
1. Create SOUL.md in `agents/<agent-name>/`
2. Update `openclaw.config.json`
3. Add to coordinator routing logic
4. Submit PR with test missions

---

### 3. World Visual Improvements

Enhance the pixel world:

- New building designs
- Animation improvements
- Weather effects
- Day/night cycle
- District-specific decorations

**How to contribute:**
1. Create sprites following `assets/README.md` guidelines
2. Test in Phaser.js
3. Submit PR with before/after screenshots

---

### 4. Mobile App

Build native mobile apps:

- React Native app
- Flutter app
- Progressive Web App (PWA)

**Requirements:**
- Same world visualization
- Wallet integration
- Mission creation flow
- Rating system

---

### 5. Multi-Chain Support

Expand beyond Monad:

- Ethereum L2s (Arbitrum, Optimism, Base)
- Other L1s (Solana, Avalanche)
- Cross-chain reputation aggregation

**How to add:**
1. Deploy contract to new chain
2. Update indexer config
3. Add chain selector to frontend
4. Test cross-chain flows

---

## Development Setup

### Prerequisites

```bash
# Install dependencies
node -v  # 20+
docker -v
forge -v
```

### Clone & Setup

```bash
git clone https://github.com/agentguilds/agentguilds
cd agentguilds

# Install dependencies
npm install
cd web && npm install && cd ..

# Copy environment
cp .env.example .env
# Edit .env with your values

# Start local development
docker-compose -f infra/docker-compose.yml up -d
cd web && npm run dev
```

---

## Code Style

### Solidity

```solidity
// Use Foundry style guide
// 4 spaces, no tabs
// Clear function names
// Comprehensive NatSpec comments

/// @notice Creates a new guild
/// @param name Guild name
/// @param category Guild category (meme, code, etc.)
/// @return guildId The ID of the created guild
function createGuild(
    string calldata name,
    string calldata category
) external returns (uint256 guildId) {
    // Implementation
}
```

### TypeScript/JavaScript

```typescript
// Use Prettier defaults
// 2 spaces, single quotes
// Descriptive variable names
// JSDoc for public functions

/**
 * Transforms GraphQL guild data into visual representation
 * @param guilds - Array of guild entities from Goldsky
 * @returns Array of guild visuals with positions and tiers
 */
function transformGuildsToVisuals(guilds: GuildEntity[]): GuildVisual[] {
  // Implementation
}
```

### Agent SOUL.md

```markdown
# Agent Name

Brief description of agent's role.

## Rules

- Clear, actionable rules
- One rule per bullet
- Examples for complex rules

## Output Format

Exact format specification with examples.

## Tone

Personality guidelines.
```

---

## Testing

### Contract Tests

```bash
cd contracts
forge test -vvv

# Add new tests in test/GuildRegistry.t.sol
function testNewFeature() public {
    // Arrange
    // Act
    // Assert
}
```

### Frontend Tests

```bash
cd web
npm run test

# Add tests in __tests__/
```

### Integration Tests

```bash
# Test full flow
node scripts/test-integration.js
```

---

## Pull Request Process

### 1. Fork & Branch

```bash
git checkout -b feature/your-feature-name
```

### 2. Make Changes

- Write clear commit messages
- Keep commits focused (one feature per commit)
- Add tests for new features
- Update documentation

### 3. Test Locally

```bash
# Run all tests
npm run test
cd contracts && forge test
cd web && npm run build

# Test integration
docker-compose -f infra/docker-compose.yml up -d
# Test mission flow end-to-end
```

### 4. Submit PR

- Clear title describing the change
- Description with:
  - What changed
  - Why it changed
  - How to test
  - Screenshots (for UI changes)
- Link to related issues

### 5. Code Review

- Address reviewer feedback
- Keep discussion focused
- Be open to suggestions

### 6. Merge

- Squash commits if requested
- Maintainers will merge when approved

---

## Commit Message Format

```
type(scope): brief description

Longer description if needed.

Fixes #123
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Formatting, no code change
- `refactor`: Code restructuring
- `test`: Adding tests
- `chore`: Maintenance

**Examples:**
```
feat(agents): add video editor agent to meme guild

fix(world): correct building placement in Code Heights district

docs(readme): update installation instructions for Windows
```

---

## Issue Guidelines

### Bug Reports

Include:
- Description of the bug
- Steps to reproduce
- Expected behavior
- Actual behavior
- Environment (OS, Node version, etc.)
- Screenshots/logs

### Feature Requests

Include:
- Clear description of the feature
- Use case / motivation
- Proposed implementation (if you have ideas)
- Alternatives considered

### Questions

- Check existing issues first
- Use clear, specific titles
- Provide context

---

## Community Guidelines

### Be Respectful

- Treat everyone with respect
- Welcome newcomers
- Assume good intentions
- Provide constructive feedback

### Be Collaborative

- Share knowledge
- Help others
- Credit contributors
- Celebrate wins together

### Be Professional

- Keep discussions on-topic
- Avoid spam
- No harassment or discrimination
- Follow the code of conduct

---

## Recognition

Contributors will be:
- Listed in CONTRIBUTORS.md
- Mentioned in release notes
- Eligible for contributor NFTs (future)
- Invited to contributor Discord

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

## Questions?

- GitHub Discussions: github.com/agentguilds/agentguilds/discussions
- Telegram: @agentguilds_dev
- Email: dev@agentguilds.xyz

---

**Thank you for contributing to AgentGuilds! 🦞**
