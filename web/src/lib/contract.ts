import { getNetwork } from './network';

export const GUILD_REGISTRY_ABI = [
  // Views
  { name: 'coordinator', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'guildCount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'totalFeesCollected', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'getMissionCount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'getAgentCount', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'getAgentList', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address[]' }] },
  { name: 'missionTimeout', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'missionClaims', type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }], outputs: [{ type: 'address' }] },
  { name: 'userBalances', type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'isAgentInGuild', type: 'function', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }, { name: '', type: 'address' }], outputs: [{ type: 'bool' }] },
  {
    name: 'getMission', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'missionId', type: 'uint256' }],
    outputs: [{
      name: '', type: 'tuple',
      components: [
        { name: 'client', type: 'address' },
        { name: 'guildId', type: 'uint256' },
        { name: 'taskHash', type: 'bytes32' },
        { name: 'budget', type: 'uint256' },
        { name: 'createdAt', type: 'uint256' },
        { name: 'completedAt', type: 'uint256' },
        { name: 'completed', type: 'bool' },
        { name: 'rated', type: 'bool' },
        { name: 'rating', type: 'uint8' },
        { name: 'resultHashes', type: 'bytes32[]' },
      ],
    }],
  },
  {
    name: 'getGuild', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'guildId', type: 'uint256' }],
    outputs: [{
      name: '', type: 'tuple',
      components: [
        { name: 'name', type: 'string' },
        { name: 'category', type: 'string' },
        { name: 'creator', type: 'address' },
        { name: 'totalMissions', type: 'uint256' },
        { name: 'totalRatingSum', type: 'uint256' },
        { name: 'ratingCount', type: 'uint256' },
        { name: 'acceptedMissions', type: 'uint256' },
        { name: 'disputedMissions', type: 'uint256' },
        { name: 'active', type: 'bool' },
      ],
    }],
  },
  {
    name: 'getGuildReputation', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'guildId', type: 'uint256' }],
    outputs: [
      { name: 'avgRatingScaled', type: 'uint256' },
      { name: 'totalMissions', type: 'uint256' },
    ],
  },
  {
    name: 'agents', type: 'function', stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [
      { name: 'wallet', type: 'address' },
      { name: 'owner', type: 'address' },
      { name: 'capability', type: 'string' },
      { name: 'priceWei', type: 'uint256' },
      { name: 'missionsCompleted', type: 'uint256' },
      { name: 'active', type: 'bool' },
    ],
  },
  {
    name: 'getGuildAgents', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'guildId', type: 'uint256' }],
    outputs: [{ type: 'address[]' }],
  },
  {
    name: 'getAgentGuilds', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'agent', type: 'address' }],
    outputs: [{ type: 'uint256[]' }],
  },
  // Writes
  {
    name: 'depositFunds', type: 'function', stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'withdrawFunds', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  // Events
  { name: 'FundsDeposited', type: 'event', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'amount', type: 'uint256' }] },
  { name: 'FundsWithdrawn', type: 'event', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'amount', type: 'uint256' }] },
] as const;

export function getGuildRegistryConfig() {
  return {
    address: getNetwork().contractAddress as `0x${string}`,
    abi: GUILD_REGISTRY_ABI,
  } as const;
}
