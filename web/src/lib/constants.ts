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
