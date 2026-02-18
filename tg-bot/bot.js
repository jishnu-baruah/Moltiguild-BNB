#!/usr/bin/env node

/**
 * MoltiGuild Telegram Bot
 *
 * Lightweight, stateless command bot that talks to the Coordinator API.
 * No OpenClaw, no LLM, no blockchain dependencies - just HTTP calls.
 *
 * Commands:
 *   /start         - Welcome message
 *   /help          - List commands
 *   /status        - Platform stats
 *   /guilds        - Browse guilds
 *   /guild <id>    - Guild details + agents
 *   /missions      - Open missions
 *   /mission <id>  - Mission details
 *   /agents        - Online agents
 *   /ask <budget> <task>  - Auto-pick guild & create mission
 *   /create <guildId> <budget> <task>  - Create a mission (manual guild)
 *   /pipeline <guildId> <budget> <role1,role2> <task>  - Multi-agent pipeline
 *   /rate <missionId> <score>  - Rate a mission (1-5)
 *   /balance <address>  - Check deposit balance
 *   /events        - Toggle live event stream in this chat
 */

require('dotenv').config();
const { Bot } = require('grammy');

const API_URL = (process.env.API_URL || 'http://localhost:3001').replace(/\/$/, '');
const ADMIN_KEY = process.env.ADMIN_API_KEY || '';
const bot = new Bot(process.env.TG_BOT_TOKEN);

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════

async function api(path) {
    const res = await fetch(`${API_URL}${path}`);
    return res.json();
}

async function adminPost(path, body) {
    const res = await fetch(`${API_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN_KEY },
        body: JSON.stringify(body),
    });
    return res.json();
}

function esc(text) {
    // Escape MarkdownV2 special chars
    return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

function mono(text) {
    return `\`${esc(String(text))}\``;
}

function shortenAddr(addr) {
    if (!addr || addr.length < 12) return addr;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatMON(weiStr) {
    try {
        const wei = BigInt(weiStr);
        const whole = wei / 1000000000000000000n;
        const frac = wei % 1000000000000000000n;
        const fracStr = frac.toString().padStart(18, '0').slice(0, 4);
        return `${whole}.${fracStr}`;
    } catch {
        return weiStr;
    }
}

// ═══════════════════════════════════════
// COMMANDS
// ═══════════════════════════════════════

bot.command('start', async (ctx) => {
    await ctx.reply(
        `*MoltiGuild Bot*\n\n` +
        `On\\-chain AI labor marketplace on Monad\\.\n` +
        `Browse guilds, missions, and create work requests\\.\n\n` +
        `Type /help for commands\\.`,
        { parse_mode: 'MarkdownV2' },
    );
});

bot.command('help', async (ctx) => {
    await ctx.reply(
        `*Commands*\n\n` +
        `*Read:*\n` +
        `/status \\- Platform stats\n` +
        `/guilds \\- Browse guilds\n` +
        `/guild \\<id\\> \\- Guild details\n` +
        `/missions \\- Open missions\n` +
        `/mission \\<id\\> \\- Mission details\n` +
        `/agents \\- Online agents\n` +
        `/balance \\<address\\> \\- Deposit balance\n\n` +
        `*Write \\(admin\\):*\n` +
        `/ask \\<budget\\> \\<task\\> \\- Auto\\-pick guild\n` +
        `/create \\<guildId\\> \\<budget\\> \\<task\\>\n` +
        `/pipeline \\<guildId\\> \\<budget\\> \\<roles\\> \\<task\\>\n` +
        `/rate \\<missionId\\> \\<score 1\\-5\\>\n\n` +
        `*Live:*\n` +
        `/events \\- Toggle live event stream`,
        { parse_mode: 'MarkdownV2' },
    );
});

bot.command('status', async (ctx) => {
    try {
        const { data } = await api('/api/status');
        await ctx.reply(
            `*Platform Status*\n\n` +
            `Guilds: ${esc(data.guilds)}\n` +
            `Missions created: ${esc(data.missionsCreated)}\n` +
            `Missions completed: ${esc(data.missionsCompleted)}\n` +
            `Agents registered: ${esc(data.agents)}\n` +
            `Agents online: ${esc(data.onlineAgents)}`,
            { parse_mode: 'MarkdownV2' },
        );
    } catch (err) {
        await ctx.reply(`Error: ${err.message}`);
    }
});

bot.command('guilds', async (ctx) => {
    try {
        const { data } = await api('/api/guilds');
        if (!data.guilds.length) return ctx.reply('No guilds found.');

        const lines = data.guilds.map(g =>
            `*#${esc(g.guildId)}* ${esc(g.name)} \\[${esc(g.category)}\\]\n` +
            `  Rating: ${esc(g.avgRating)} | Missions: ${esc(g.totalMissions)} | Members: ${esc(g.memberCount)}`
        );
        await ctx.reply(`*Guilds \\(${esc(data.count)}\\)*\n\n${lines.join('\n\n')}`, { parse_mode: 'MarkdownV2' });
    } catch (err) {
        await ctx.reply(`Error: ${err.message}`);
    }
});

bot.command('guild', async (ctx) => {
    const id = ctx.match?.trim();
    if (!id) return ctx.reply('Usage: /guild <id>');

    try {
        const [guildRes, agentsRes] = await Promise.all([
            api('/api/guilds'),
            api(`/api/guilds/${id}/agents`),
        ]);
        const guild = guildRes.data.guilds.find(g => String(g.guildId) === id);
        if (!guild) return ctx.reply(`Guild ${id} not found.`);

        const agentList = agentsRes.data.agents.length
            ? agentsRes.data.agents.map(a => `  ${mono(shortenAddr(a))}`).join('\n')
            : '  None';

        await ctx.reply(
            `*Guild #${esc(id)}: ${esc(guild.name)}*\n` +
            `Category: ${esc(guild.category)}\n` +
            `Rating: ${esc(guild.avgRating)} | Missions: ${esc(guild.totalMissions)}\n` +
            `Members \\(${esc(agentsRes.data.count)}\\):\n${agentList}`,
            { parse_mode: 'MarkdownV2' },
        );
    } catch (err) {
        await ctx.reply(`Error: ${err.message}`);
    }
});

bot.command('missions', async (ctx) => {
    try {
        const { data } = await api('/api/missions/open');
        if (!data.missions.length) return ctx.reply('No open missions.');

        const lines = data.missions.slice(0, 10).map(m => {
            const budget = m.budget ? formatMON(m.budget) : '?';
            return `*#${esc(m.missionId)}* Guild ${esc(m.guildId)} | ${esc(budget)} MON\n` +
                `  Client: ${mono(shortenAddr(m.client))}`;
        });
        await ctx.reply(
            `*Open Missions \\(${esc(data.count)}\\)*\n\n${lines.join('\n\n')}`,
            { parse_mode: 'MarkdownV2' },
        );
    } catch (err) {
        await ctx.reply(`Error: ${err.message}`);
    }
});

bot.command('mission', async (ctx) => {
    const id = ctx.match?.trim();
    if (!id) return ctx.reply('Usage: /mission <id>');

    try {
        // Try pipeline info first, then on-chain
        const [pipelinesRes, statusRes] = await Promise.all([
            api('/api/pipelines'),
            api('/api/status'),
        ]);

        const pipeline = pipelinesRes.data.pipelines.find(p => String(p.missionId) === id);

        let text = `*Mission #${esc(id)}*\n\n`;
        if (pipeline) {
            const detail = await api(`/api/pipeline/${pipeline.id}`);
            const p = detail.data;
            text += `Pipeline: ${esc(p.id)}\n`;
            text += `Task: ${esc(p.task)}\n`;
            text += `Guild: ${esc(p.guildId)} | Budget: ${esc(p.budget)} MON\n`;
            text += `Status: ${esc(p.status)} | Step: ${esc(p.currentStep)}/${esc(p.totalSteps)}\n\n`;
            text += `*Steps:*\n`;
            p.steps.forEach(s => {
                const agent = s.agent ? shortenAddr(s.agent) : 'waiting';
                text += `  ${esc(s.step)}\\. ${esc(s.role)} \\[${esc(s.status)}\\] ${mono(agent)}\n`;
            });
        } else {
            text += `No pipeline data\\. Use Goldsky or explorer for on\\-chain details\\.`;
        }

        await ctx.reply(text, { parse_mode: 'MarkdownV2' });
    } catch (err) {
        await ctx.reply(`Error: ${err.message}`);
    }
});

bot.command('agents', async (ctx) => {
    try {
        const { data } = await api('/api/agents/online');
        if (!data.agents.length) return ctx.reply('No agents online.');

        const lines = data.agents.map(a =>
            `${mono(shortenAddr(a.address))} \\- ${esc(a.minutesAgo)}m ago`
        );
        await ctx.reply(
            `*Online Agents \\(${esc(data.count)}\\)*\n\n${lines.join('\n')}`,
            { parse_mode: 'MarkdownV2' },
        );
    } catch (err) {
        await ctx.reply(`Error: ${err.message}`);
    }
});

bot.command('balance', async (ctx) => {
    const addr = ctx.match?.trim();
    if (!addr) return ctx.reply('Usage: /balance <address>');

    try {
        const { data } = await api(`/api/balance/${addr}`);
        await ctx.reply(`Balance for ${mono(shortenAddr(addr))}: *${esc(data.balance)}*`, { parse_mode: 'MarkdownV2' });
    } catch (err) {
        await ctx.reply(`Error: ${err.message}`);
    }
});

// ═══════════════════════════════════════
// WRITE COMMANDS (admin key required)
// ═══════════════════════════════════════

bot.command('ask', async (ctx) => {
    if (!ADMIN_KEY) return ctx.reply('Admin API key not configured.');

    // /ask <budget> <task description>
    const parts = ctx.match?.trim().split(/\s+/);
    if (!parts || parts.length < 2) {
        return ctx.reply('Usage: /ask <budgetMON> <task description>\nExample: /ask 0.005 Write a meme about Monad speed');
    }

    const budget = parts[0];
    const task = parts.slice(1).join(' ');

    try {
        await ctx.reply(`Finding best guild for: "${task}"...`);
        const result = await adminPost('/api/smart-create', { task, budget });

        if (!result.ok) return ctx.reply(`Failed: ${result.error}`);

        const d = result.data;
        await ctx.reply(
            `*Mission Created\\!*\n\n` +
            `Guild: *${esc(d.guildName)}* \\(#${esc(d.guildId)}\\)\n` +
            `Category: ${esc(d.matchedCategory)}\n` +
            `Matched via: ${esc(d.matchConfidence)} \\(tier ${esc(d.matchTier)}\\)\n` +
            `Mission ID: ${esc(d.missionId)}\n` +
            `Budget: ${esc(budget)} MON\n` +
            `TX: ${mono(d.txHash?.slice(0, 16) + '...')}`,
            { parse_mode: 'MarkdownV2' },
        );
    } catch (err) {
        await ctx.reply(`Error: ${err.message}`);
    }
});

bot.command('create', async (ctx) => {
    if (!ADMIN_KEY) return ctx.reply('Admin API key not configured.');

    // /create <guildId> <budget> <task description>
    const parts = ctx.match?.trim().split(/\s+/);
    if (!parts || parts.length < 3) {
        return ctx.reply('Usage: /create <guildId> <budgetMON> <task description>\nExample: /create 0 0.005 Write a blog post about DeFi');
    }

    const guildId = parseInt(parts[0]);
    const budget = parts[1];
    const task = parts.slice(2).join(' ');

    try {
        await ctx.reply(`Creating mission on guild ${guildId} with ${budget} MON...`);
        const result = await adminPost('/api/admin/create-mission', { guildId, task, budget });

        if (!result.ok) return ctx.reply(`Failed: ${result.error}`);

        await ctx.reply(
            `*Mission Created\\!*\n\n` +
            `Mission ID: ${esc(result.data.missionId)}\n` +
            `Guild: ${esc(guildId)}\n` +
            `Budget: ${esc(budget)} MON\n` +
            `Task: ${esc(task)}\n` +
            `TX: ${mono(result.data.txHash?.slice(0, 16) + '...')}`,
            { parse_mode: 'MarkdownV2' },
        );
    } catch (err) {
        await ctx.reply(`Error: ${err.message}`);
    }
});

bot.command('pipeline', async (ctx) => {
    if (!ADMIN_KEY) return ctx.reply('Admin API key not configured.');

    // /pipeline <guildId> <budget> <role1,role2,...> <task>
    const parts = ctx.match?.trim().split(/\s+/);
    if (!parts || parts.length < 4) {
        return ctx.reply(
            'Usage: /pipeline <guildId> <budget> <roles> <task>\n' +
            'Example: /pipeline 0 0.01 writer,designer Create a meme about Monad',
        );
    }

    const guildId = parseInt(parts[0]);
    const budget = parts[1];
    const roles = parts[2].split(',').map(r => r.trim());
    const task = parts.slice(3).join(' ');

    if (roles.length < 2) return ctx.reply('Need at least 2 roles (comma-separated).');

    try {
        await ctx.reply(`Creating ${roles.length}-step pipeline on guild ${guildId}...`);
        const result = await adminPost('/api/create-pipeline', {
            guildId,
            task,
            budget,
            steps: roles.map(role => ({ role })),
        });

        if (!result.ok) return ctx.reply(`Failed: ${result.error}`);

        await ctx.reply(
            `*Pipeline Created\\!*\n\n` +
            `Pipeline: ${esc(result.data.pipelineId)}\n` +
            `Mission ID: ${esc(result.data.missionId)}\n` +
            `Guild: ${esc(guildId)} | Budget: ${esc(budget)} MON\n` +
            `Steps: ${roles.map((r, i) => `${i + 1}\\. ${esc(r)}`).join(', ')}\n` +
            `Task: ${esc(task)}`,
            { parse_mode: 'MarkdownV2' },
        );
    } catch (err) {
        await ctx.reply(`Error: ${err.message}`);
    }
});

bot.command('rate', async (ctx) => {
    if (!ADMIN_KEY) return ctx.reply('Admin API key not configured.');

    const parts = ctx.match?.trim().split(/\s+/);
    if (!parts || parts.length !== 2) {
        return ctx.reply('Usage: /rate <missionId> <score 1-5>');
    }

    const missionId = parseInt(parts[0]);
    const score = parseInt(parts[1]);

    try {
        const result = await adminPost('/api/admin/rate-mission', { missionId, score });
        if (!result.ok) return ctx.reply(`Failed: ${result.error}`);

        await ctx.reply(
            `*Mission #${esc(missionId)} rated ${esc(score)}/5*\n` +
            `TX: ${mono(result.data.txHash?.slice(0, 16) + '...')}`,
            { parse_mode: 'MarkdownV2' },
        );
    } catch (err) {
        await ctx.reply(`Error: ${err.message}`);
    }
});

// ═══════════════════════════════════════
// SSE LIVE EVENTS
// ═══════════════════════════════════════

const eventSubscribers = new Set(); // chat IDs

bot.command('events', async (ctx) => {
    const chatId = ctx.chat.id;
    if (eventSubscribers.has(chatId)) {
        eventSubscribers.delete(chatId);
        await ctx.reply('Live events OFF.');
    } else {
        eventSubscribers.add(chatId);
        await ctx.reply('Live events ON. You\'ll receive real-time updates. Send /events again to stop.');
    }
});

function connectSSE() {
    const url = `${API_URL}/api/events`;
    console.log(`Connecting to SSE: ${url}`);

    fetch(url).then(async (res) => {
        if (!res.ok) {
            console.log(`SSE failed: ${res.status}, retrying in 10s...`);
            setTimeout(connectSSE, 10000);
            return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop();

            let currentEvent = '';
            for (const line of lines) {
                if (line.startsWith('event: ')) {
                    currentEvent = line.slice(7);
                } else if (line.startsWith('data: ') && currentEvent) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        broadcastToTG(currentEvent, data);
                    } catch {}
                    currentEvent = '';
                }
            }
        }
        console.log('SSE ended, reconnecting...');
        setTimeout(connectSSE, 5000);
    }).catch((err) => {
        console.log(`SSE error: ${err.message}, retrying in 10s...`);
        setTimeout(connectSSE, 10000);
    });
}

const EVENT_LABELS = {
    mission_created: 'Mission Created',
    mission_claimed: 'Mission Claimed',
    mission_completed: 'Mission Completed',
    mission_rated: 'Mission Rated',
    pipeline_created: 'Pipeline Created',
    step_completed: 'Pipeline Step Done',
    pipeline_completed: 'Pipeline Completed',
    agent_joined_guild: 'Agent Joined Guild',
    agent_left_guild: 'Agent Left Guild',
};

function broadcastToTG(event, data) {
    if (event === 'connected' || event === 'heartbeat') return; // skip noisy events

    const label = EVENT_LABELS[event] || event;
    const details = [];

    if (data.missionId !== undefined) details.push(`Mission #${data.missionId}`);
    if (data.pipelineId) details.push(`Pipeline: ${data.pipelineId}`);
    if (data.guildId !== undefined) details.push(`Guild ${data.guildId}`);
    if (data.agent) details.push(`Agent: ${shortenAddr(data.agent)}`);
    if (data.task) details.push(`Task: ${data.task.slice(0, 80)}`);
    if (data.budget) details.push(`Budget: ${data.budget} MON`);
    if (data.paid) details.push(`Paid: ${data.paid}`);
    if (data.score) details.push(`Score: ${data.score}/5`);
    if (data.completedStep) details.push(`Step ${data.completedStep} done`);
    if (data.nextRole) details.push(`Next: ${data.nextRole}`);

    const msg = `[${label}]\n${details.join('\n')}`;

    for (const chatId of eventSubscribers) {
        bot.api.sendMessage(chatId, msg).catch(() => {
            eventSubscribers.delete(chatId); // remove dead chats
        });
    }
}

// ═══════════════════════════════════════
// START
// ═══════════════════════════════════════

console.log('MoltiGuild TG Bot starting...');
console.log(`API: ${API_URL}`);
console.log(`Admin key: ${ADMIN_KEY ? 'configured' : 'NOT SET (write commands disabled)'}`);

bot.start({
    onStart: () => {
        console.log('Bot is running!');
        connectSSE();
    },
});
