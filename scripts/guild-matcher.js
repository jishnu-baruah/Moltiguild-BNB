/**
 * Guild Matcher — Smart guild selection for MoltiGuild
 *
 * 3-tier matching:
 *   Tier 1: Keyword map (instant, free)
 *   Tier 2: Gemini Flash (free tier, ~200ms)
 *   Tier 3: Highest-rated guild with members
 *
 * Pure function module — no Express, no blockchain.
 * Takes a task string + enriched guild array, returns the best match.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// Keyword → category mapping
const KEYWORD_MAP = {
    code: ['code', 'program', 'debug', 'script', 'solidity', 'smart contract', 'bug', 'refactor', 'develop', 'compile', 'deploy'],
    creative: ['write', 'blog', 'article', 'story', 'copy', 'content', 'essay', 'poem', 'narrative'],
    meme: ['meme', 'funny', 'joke', 'humor', 'viral', 'shitpost'],
    design: ['design', 'logo', 'ui', 'ux', 'graphic', 'banner', 'illustration', 'mockup'],
    test: ['test', 'qa', 'verify', 'audit', 'review', 'check', 'inspect'],
    research: ['research', 'analyze', 'report', 'data', 'investigate', 'study', 'survey'],
    marketing: ['marketing', 'promote', 'campaign', 'social media', 'tweet', 'thread', 'advertise'],
    defi: ['defi', 'swap', 'liquidity', 'yield', 'lending', 'borrow', 'staking', 'farming'],
    translation: ['translate', 'translation', 'localize', 'localization', 'language'],
};

/**
 * Tier 1: Keyword matching
 * Returns category string or null (on no match or tie)
 */
function keywordMatch(task, availableCategories) {
    const lower = task.toLowerCase();
    const scores = {};

    for (const [category, keywords] of Object.entries(KEYWORD_MAP)) {
        if (!availableCategories.has(category)) continue;
        let hits = 0;
        for (const kw of keywords) {
            if (lower.includes(kw)) hits++;
        }
        if (hits > 0) scores[category] = hits;
    }

    // Also check direct category name match
    for (const cat of availableCategories) {
        if (lower.includes(cat) && !scores[cat]) {
            scores[cat] = 1;
        }
    }

    const entries = Object.entries(scores);
    if (entries.length === 0) return null;

    // Sort by hits desc
    entries.sort((a, b) => b[1] - a[1]);

    // Tie between top 2 → ambiguous, return null
    if (entries.length >= 2 && entries[0][1] === entries[1][1]) return null;

    return entries[0][0];
}

/**
 * Tier 2: Gemini Flash classification
 * Returns category string or null (on error/timeout/no key)
 */
async function geminiMatch(task, categories) {
    if (!GEMINI_API_KEY) return null;

    const catList = [...categories].join(', ');
    const prompt = `Given these guild categories: [${catList}]. Which category best matches this task: "${task}"? Reply with ONLY the category name, nothing else.`;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);

        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0, maxOutputTokens: 20 },
                }),
                signal: controller.signal,
            },
        );

        clearTimeout(timeout);

        if (!res.ok) return null;

        const json = await res.json();
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toLowerCase();

        if (text && categories.has(text)) return text;
        return null;
    } catch {
        return null;
    }
}

/**
 * Pick the best guild in a given category
 * Guilds are already sorted by avgRating desc from getEnrichedGuilds()
 */
function pickBestGuild(guilds, category) {
    const inCategory = guilds.filter(g => g.category?.toLowerCase() === category);
    if (inCategory.length === 0) return null;

    // Prefer guilds with members
    const withMembers = inCategory.filter(g => g.memberCount > 0);
    return withMembers.length > 0 ? withMembers[0] : inCategory[0];
}

/**
 * Main entry: match a task to the best guild
 *
 * @param {string} task - Task description
 * @param {Array} guilds - Enriched guild array from getEnrichedGuilds()
 *   Each: { guildId, name, category, avgRating, totalMissions, memberCount }
 * @returns {Promise<{ guild, category, tier, confidence }>}
 */
async function matchGuildForTask(task, guilds) {
    if (!guilds || guilds.length === 0) {
        return { guild: null, category: null, tier: 0, confidence: 'none' };
    }

    // Build set of available categories (lowercased)
    const categorySet = new Set(guilds.map(g => g.category?.toLowerCase()).filter(Boolean));

    // Tier 1: Keywords
    const kwCategory = keywordMatch(task, categorySet);
    if (kwCategory) {
        const guild = pickBestGuild(guilds, kwCategory);
        if (guild) {
            return { guild, category: kwCategory, tier: 1, confidence: 'keyword' };
        }
    }

    // Tier 2: Gemini Flash
    const gemCategory = await geminiMatch(task, categorySet);
    if (gemCategory) {
        const guild = pickBestGuild(guilds, gemCategory);
        if (guild) {
            return { guild, category: gemCategory, tier: 2, confidence: 'gemini' };
        }
    }

    // Tier 3: Highest-rated guild with members
    const withMembers = guilds.filter(g => g.memberCount > 0);
    const fallback = withMembers.length > 0 ? withMembers[0] : guilds[0];

    return {
        guild: fallback,
        category: fallback.category?.toLowerCase() || 'unknown',
        tier: 3,
        confidence: 'fallback',
    };
}

module.exports = { matchGuildForTask, keywordMatch, geminiMatch, pickBestGuild, KEYWORD_MAP };
