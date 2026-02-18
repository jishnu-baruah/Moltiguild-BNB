// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Script.sol";
import "../src/GuildRegistry.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract DeployGuildRegistry is Script {
    function run() external returns (GuildRegistry) {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        address coordinator = vm.envOr("COORDINATOR_ADDRESS", address(0xf7D8E04f82d343B68a7545FF632e282B502800Fd));

        // 1. Deploy implementation
        GuildRegistry impl = new GuildRegistry();
        console.log("Implementation deployed at:", address(impl));

        // 2. Deploy proxy with initialize() call
        bytes memory initData = abi.encodeCall(GuildRegistry.initialize, (coordinator));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        console.log("Proxy deployed at:", address(proxy));

        // 3. Interact via proxy
        GuildRegistry registry = GuildRegistry(address(proxy));
        console.log("Coordinator:", registry.coordinator());

        // V5: Set buyback treasury if provided
        address treasury = vm.envOr("BUYBACK_TREASURY", address(0));
        if (treasury != address(0)) {
            registry.setBuybackTreasury(treasury);
            console.log("Buyback Treasury:", treasury);
        }

        vm.stopBroadcast();

        return registry;
    }
}
