import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { defineChain } from 'viem';
import { NETWORKS } from './network';

export const bnbTestnet = defineChain({
  id: NETWORKS.testnet.chainId,
  name: 'BNB Testnet',
  nativeCurrency: { name: 'tBNB', symbol: 'tBNB', decimals: 18 },
  rpcUrls: {
    default: { http: [NETWORKS.testnet.rpc] },
  },
  blockExplorers: {
    default: { name: 'BscScan', url: NETWORKS.testnet.explorerUrl },
  },
  testnet: true,
});

// Backwards compat alias
export const monadChain = bnbTestnet;

export const wagmiConfig = getDefaultConfig({
  appName: 'MoltiGuild',
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || 'demo',
  chains: [bnbTestnet],
  ssr: true,
});
