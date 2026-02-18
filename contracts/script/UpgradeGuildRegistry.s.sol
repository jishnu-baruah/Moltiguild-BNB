// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "forge-std/Script.sol";
import "../src/GuildRegistry.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract UpgradeGuildRegistry is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address proxyAddress = vm.envAddress("PROXY_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy new implementation
        GuildRegistry newImpl = new GuildRegistry();
        console.log("New implementation deployed at:", address(newImpl));

        // 2. Upgrade proxy to point at new implementation
        GuildRegistry proxy = GuildRegistry(proxyAddress);
        proxy.upgradeToAndCall(address(newImpl), "");
        console.log("Proxy upgraded:", proxyAddress);

        // 3. Verify
        console.log("Coordinator:", proxy.coordinator());

        vm.stopBroadcast();
    }
}
