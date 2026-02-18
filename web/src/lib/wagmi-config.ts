import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { defineChain } from 'viem';
import { NETWORKS } from './network';

export const monadMainnet = defineChain({
  id: NETWORKS.mainnet.chainId,
  name: 'Monad',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: [NETWORKS.mainnet.rpc] },
  },
  blockExplorers: {
    default: { name: 'Explorer', url: NETWORKS.mainnet.explorerUrl },
  },
  testnet: false,
});

export const monadTestnet = defineChain({
  id: NETWORKS.testnet.chainId,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: { http: [NETWORKS.testnet.rpc] },
  },
  blockExplorers: {
    default: { name: 'Explorer', url: NETWORKS.testnet.explorerUrl },
  },
  testnet: true,
});

// Backwards compat alias
export const monadChain = monadMainnet;

export const wagmiConfig = getDefaultConfig({
  appName: 'MoltiGuild',
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || 'demo',
  chains: [monadMainnet, monadTestnet],
  ssr: true,
});
