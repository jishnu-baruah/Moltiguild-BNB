#!/bin/bash
cd "$(dirname "$0")"

NETWORK="${1:-testnet}"

if [ "$NETWORK" = "mainnet" ]; then
    CONFIG="goldsky_config_mainnet.json"
    SLUG="agentguilds-mainnet/v1"

    # Check that the address placeholder was replaced
    if grep -q "MAINNET_CONTRACT_ADDRESS" "$CONFIG"; then
        echo "ERROR: Replace MAINNET_CONTRACT_ADDRESS in $CONFIG with the deployed v5 contract address first."
        echo "  Edit: indexer/$CONFIG → instances[0].address"
        exit 1
    fi

    echo "Deploying AgentGuilds MAINNET Subgraph..."
    goldsky subgraph deploy "$SLUG" --from-abi "$CONFIG"
else
    CONFIG="goldsky_config.json"
    SLUG="agentguilds-monad-testnet/v5"

    echo "Deploying AgentGuilds TESTNET V5 Subgraph..."
    goldsky subgraph deploy "$SLUG" --from-abi "$CONFIG"
fi

echo ""
echo "Done. Run 'goldsky subgraph list' to check status."
echo "Endpoint will be: https://api.goldsky.com/api/public/project_<ID>/subgraphs/$SLUG/gn"
