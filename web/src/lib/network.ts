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
  testnet: {
    key: 'testnet',
    name: 'BNB Testnet',
    chainId: 97,
    rpc: 'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
    apiUrl: process.env.NEXT_PUBLIC_TESTNET_API_URL || 'https://moltiguild-api.onrender.com',
    contractAddress: process.env.NEXT_PUBLIC_GUILD_REGISTRY_ADDRESS || '0x0000000000000000000000000000000000000000',
    goldskyEndpoint: '',
    explorerUrl: 'https://testnet.bscscan.com',
    guildTokenAddress: '',
    isMainnet: false,
  },
};

/* ── Mutable Store ────────────────────────────────────────────────── */

const listeners = new Set<() => void>();

const current: NetworkConfig = NETWORKS.testnet;

export function getNetwork(): NetworkConfig {
  return current;
}

export function getNetworkKey(): string {
  return current.key;
}

export function switchNetwork(_key: string): void {
  // Single-network mode — no switching needed
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
  return NETWORKS.testnet;
}

export function useNetwork(): NetworkConfig {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useNetworkKey(): string {
  const net = useNetwork();
  return net.key;
}
