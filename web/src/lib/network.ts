'use client';

import { useSyncExternalStore } from 'react';

/* ── Network Configs ──────────────────────────────────────────────── */

export interface NetworkConfig {
  key: string;
  name: string;
  chainId: number;
  rpc: string;
  apiUrl: string;
  contractAddress: string;
  goldskyEndpoint: string;
  explorerUrl: string;
  guildTokenAddress: string;
  isMainnet: boolean;
}

export const NETWORKS: Record<string, NetworkConfig> = {
  mainnet: {
    key: 'mainnet',
    name: 'Mainnet',
    chainId: 143,
    rpc: 'https://rpc.monad.xyz',
    apiUrl: process.env.NEXT_PUBLIC_MAINNET_API_URL || 'https://moltiguild-api-mainnet.onrender.com',
    contractAddress: '0xD72De456b2Aa5217a4Fd2E4d64443Ac92FA28791',
    goldskyEndpoint: 'https://api.goldsky.com/api/public/project_cmlpa4v2etj0n01vjc1nubxuw/subgraphs/agentguilds-mainnet-monad/v1/gn',
    explorerUrl: 'https://monad.socialscan.io',
    guildTokenAddress: '0x01511c69DB6f00Fa88689bd4bcdfb13D97847777',
    isMainnet: true,
  },
  testnet: {
    key: 'testnet',
    name: 'Testnet',
    chainId: 10143,
    rpc: 'https://testnet-rpc.monad.xyz',
    apiUrl: process.env.NEXT_PUBLIC_TESTNET_API_URL || 'https://moltiguild-api.onrender.com',
    contractAddress: '0x60395114FB889C62846a574ca4Cda3659A95b038',
    goldskyEndpoint: 'https://api.goldsky.com/api/public/project_cmlgbdp3o5ldb01uv0nu66cer/subgraphs/agentguilds-monad-testnet-monad-testnet/v5/gn',
    explorerUrl: 'https://testnet.monadvision.com',
    guildTokenAddress: '',
    isMainnet: false,
  },
};

/* ── Mutable Store ────────────────────────────────────────────────── */

const STORAGE_KEY = 'moltiguild_network';
const listeners = new Set<() => void>();

function getInitialNetwork(): NetworkConfig {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && NETWORKS[saved]) return NETWORKS[saved];
  }
  // Default to mainnet
  return NETWORKS.mainnet;
}

let current: NetworkConfig = getInitialNetwork();

export function getNetwork(): NetworkConfig {
  return current;
}

export function getNetworkKey(): string {
  return current.key;
}

export function switchNetwork(key: string): void {
  if (!NETWORKS[key] || current.key === key) return;
  current = NETWORKS[key];
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, key);
  }
  // Notify all React subscribers
  for (const cb of listeners) cb();
}

/* ── React Hook (useSyncExternalStore) ────────────────────────────── */

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): NetworkConfig {
  return current;
}

function getServerSnapshot(): NetworkConfig {
  return NETWORKS.mainnet;
}

export function useNetwork(): NetworkConfig {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useNetworkKey(): string {
  const net = useNetwork();
  return net.key;
}
