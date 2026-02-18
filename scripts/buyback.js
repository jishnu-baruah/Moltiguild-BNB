#!/usr/bin/env node

/**
 * MoltiGuild $GUILD Buyback Script
 *
 * Swaps accumulated MON from the buyback treasury into $GUILD tokens
 * via nad.fun bonding curve (or DEX if token has graduated).
 *
 * Usage:
 *   node scripts/buyback.js                  # Dry run (quote only)
 *   node scripts/buyback.js --execute        # Execute the swap
 *   node scripts/buyback.js --execute --max 0.5   # Max 0.5 MON per swap
 *
 * Required env vars:
 *   BUYBACK_TREASURY_KEY  — private key of the treasury wallet
 *   GUILD_TOKEN_ADDRESS   — $GUILD token address (default: 0x01511c69DB6f00Fa88689bd4bcdfb13D97847777)
 *
 * Optional env vars:
 *   MONAD_RPC             — RPC endpoint (default: https://rpc.monad.xyz)
 *   SLIPPAGE_BPS          — slippage tolerance in basis points (default: 500 = 5%)
 *   MIN_BUYBACK_MON       — minimum MON balance to trigger buyback (default: 0.01)
 */

const { createPublicClient, createWalletClient, http, parseEther, formatEther } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

// ═══════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════

const MONAD_RPC = process.env.MONAD_RPC || 'https://rpc.monad.xyz';
const GUILD_TOKEN = process.env.GUILD_TOKEN_ADDRESS || '0x01511c69DB6f00Fa88689bd4bcdfb13D97847777';
const SLIPPAGE_BPS = parseInt(process.env.SLIPPAGE_BPS || '500'); // 5% default
const MIN_BUYBACK = parseEther(process.env.MIN_BUYBACK_MON || '0.01');

// nad.fun contracts (Monad mainnet)
const NAD_LENS = '0x7e78A8DE94f21804F7a17F4E8BF9EC2c872187ea';
const NAD_BC_ROUTER = '0x6F6B8F1a20703309951a5127c45B49b1CD981A22';
const NAD_DEX_ROUTER = '0x0B79d71AE99528D1dB24A4148b5f4F865cc2b137';

// Chain definition
const monadMainnet = {
    id: 143,
    name: 'Monad',
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: [MONAD_RPC] } },
    blockExplorers: { default: { name: 'SocialScan', url: 'https://monad.socialscan.io' } },
};

// ═══════════════════════════════════════
// ABIs
// ═══════════════════════════════════════

const LENS_ABI = [
    {
        type: 'function', name: 'getAmountOut', stateMutability: 'view',
        inputs: [
            { name: '_token', type: 'address' },
            { name: '_amountIn', type: 'uint256' },
            { name: '_isBuy', type: 'bool' },
        ],
        outputs: [
            { name: 'router', type: 'address' },
            { name: 'amountOut', type: 'uint256' },
        ],
    },
    {
        type: 'function', name: 'isGraduated', stateMutability: 'view',
        inputs: [{ name: '_token', type: 'address' }],
        outputs: [{ name: '', type: 'bool' }],
    },
    {
        type: 'function', name: 'getProgress', stateMutability: 'view',
        inputs: [{ name: '_token', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
    },
];

const ROUTER_BUY_ABI = [
    {
        type: 'function', name: 'buy', stateMutability: 'payable',
        inputs: [{
            name: 'params', type: 'tuple',
            components: [
                { name: 'amountOutMin', type: 'uint256' },
                { name: 'token', type: 'address' },
                { name: 'to', type: 'address' },
                { name: 'deadline', type: 'uint256' },
            ],
        }],
        outputs: [],
    },
];

const ERC20_ABI = [
    {
        type: 'function', name: 'balanceOf', stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
    },
    {
        type: 'function', name: 'decimals', stateMutability: 'view',
        inputs: [],
        outputs: [{ name: '', type: 'uint8' }],
    },
    {
        type: 'function', name: 'symbol', stateMutability: 'view',
        inputs: [],
        outputs: [{ name: '', type: 'string' }],
    },
];

// ═══════════════════════════════════════
// MAIN
// ═══════════════════════════════════════

async function main() {
    const args = process.argv.slice(2);
    const execute = args.includes('--execute');
    const maxIdx = args.indexOf('--max');
    const maxMon = maxIdx !== -1 && args[maxIdx + 1] ? parseEther(args[maxIdx + 1]) : null;

    // Validate env
    const treasuryKey = process.env.BUYBACK_TREASURY_KEY;
    if (!treasuryKey) {
        console.error('ERROR: BUYBACK_TREASURY_KEY env var required');
        process.exit(1);
    }

    const account = privateKeyToAccount(treasuryKey.startsWith('0x') ? treasuryKey : `0x${treasuryKey}`);
    console.log(`Treasury wallet: ${account.address}`);
    console.log(`$GUILD token:    ${GUILD_TOKEN}`);
    console.log(`Mode:            ${execute ? 'EXECUTE' : 'DRY RUN (add --execute to swap)'}`);
    console.log('');

    const publicClient = createPublicClient({
        chain: monadMainnet,
        transport: http(MONAD_RPC),
    });

    // Check MON balance
    const monBalance = await publicClient.getBalance({ address: account.address });
    console.log(`MON balance:     ${formatEther(monBalance)} MON`);

    if (monBalance < MIN_BUYBACK) {
        console.log(`Below minimum buyback threshold (${formatEther(MIN_BUYBACK)} MON). Nothing to do.`);
        return;
    }

    // Reserve gas (0.005 MON)
    const gasReserve = parseEther('0.005');
    let swapAmount = monBalance - gasReserve;
    if (swapAmount <= 0n) {
        console.log('Not enough MON after gas reserve. Nothing to do.');
        return;
    }

    // Apply max cap if set
    if (maxMon && swapAmount > maxMon) {
        swapAmount = maxMon;
        console.log(`Capped swap to:  ${formatEther(swapAmount)} MON (--max)`);
    }

    console.log(`Swap amount:     ${formatEther(swapAmount)} MON`);
    console.log('');

    // Check token status on nad.fun
    const [graduated, progress] = await Promise.all([
        publicClient.readContract({
            address: NAD_LENS, abi: LENS_ABI,
            functionName: 'isGraduated', args: [GUILD_TOKEN],
        }),
        publicClient.readContract({
            address: NAD_LENS, abi: LENS_ABI,
            functionName: 'getProgress', args: [GUILD_TOKEN],
        }),
    ]);

    console.log(`Token graduated: ${graduated}`);
    console.log(`Curve progress:  ${Number(progress) / 100}%`);

    // Get quote from Lens
    const [router, expectedOut] = await publicClient.readContract({
        address: NAD_LENS, abi: LENS_ABI,
        functionName: 'getAmountOut',
        args: [GUILD_TOKEN, swapAmount, true],
    });

    const routerLabel = router.toLowerCase() === NAD_BC_ROUTER.toLowerCase()
        ? 'BondingCurve' : router.toLowerCase() === NAD_DEX_ROUTER.toLowerCase()
            ? 'DEX' : 'Unknown';

    console.log(`Router:          ${routerLabel} (${router})`);
    console.log(`Expected $GUILD: ${formatEther(expectedOut)}`);

    // Apply slippage
    const minOut = (expectedOut * BigInt(10000 - SLIPPAGE_BPS)) / 10000n;
    console.log(`Min out (${SLIPPAGE_BPS / 100}% slip): ${formatEther(minOut)}`);

    // Check current $GUILD balance
    const guildBefore = await publicClient.readContract({
        address: GUILD_TOKEN, abi: ERC20_ABI,
        functionName: 'balanceOf', args: [account.address],
    });
    console.log(`$GUILD before:   ${formatEther(guildBefore)}`);
    console.log('');

    if (!execute) {
        console.log('--- DRY RUN COMPLETE ---');
        console.log('Run with --execute to perform the swap.');
        return;
    }

    // Execute the swap
    console.log('Executing buyback swap...');
    const walletClient = createWalletClient({
        account,
        chain: monadMainnet,
        transport: http(MONAD_RPC),
    });

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

    const hash = await walletClient.writeContract({
        address: router,
        abi: ROUTER_BUY_ABI,
        functionName: 'buy',
        args: [{
            amountOutMin: minOut,
            token: GUILD_TOKEN,
            to: account.address,
            deadline,
        }],
        value: swapAmount,
    });

    console.log(`TX submitted:    ${hash}`);
    console.log(`Explorer:        https://monad.socialscan.io/tx/${hash}`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`Status:          ${receipt.status}`);

    if (receipt.status === 'success') {
        const guildAfter = await publicClient.readContract({
            address: GUILD_TOKEN, abi: ERC20_ABI,
            functionName: 'balanceOf', args: [account.address],
        });
        const bought = guildAfter - guildBefore;
        console.log('');
        console.log(`Buyback complete!`);
        console.log(`Spent:           ${formatEther(swapAmount)} MON`);
        console.log(`Received:        ${formatEther(bought)} $GUILD`);
        console.log(`$GUILD balance:  ${formatEther(guildAfter)}`);
    } else {
        console.error('Transaction reverted!');
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Buyback failed:', err.message || err);
    process.exit(1);
});
