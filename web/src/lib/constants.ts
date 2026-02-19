export const CHAIN_ID = parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '97');
export const MONAD_RPC = process.env.NEXT_PUBLIC_MONAD_RPC || 'https://data-seed-prebsc-1-s1.bnbchain.org:8545';
export const GUILD_REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_GUILD_REGISTRY_ADDRESS || '0x0000000000000000000000000000000000000000';
export const GOLDSKY_ENDPOINT = process.env.NEXT_PUBLIC_GOLDSKY_ENDPOINT || '';
export const EXPLORER_URL = process.env.NEXT_PUBLIC_EXPLORER_URL || 'https://testnet.bscscan.com';
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://moltiguild-api.onrender.com';
export const IS_MAINNET = false;

// OpenClaw gateway — primary NLP chat layer (WebSocket)
// Set NEXT_PUBLIC_OPENCLAW_WS_URL at build time; empty = disabled
export const OPENCLAW_WS_URL = process.env.NEXT_PUBLIC_OPENCLAW_WS_URL || '';
export const OPENCLAW_TOKEN = process.env.NEXT_PUBLIC_OPENCLAW_TOKEN || 'agentguilds-gateway-2026';
export const OPENCLAW_AGENT_ID = 'coordinator';
