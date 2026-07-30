// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {KumoMultiStaking} from "../src/KumoMultiStaking.sol";

/// Deploy + genesis ceremony for robinhood chain (4663).
/// env:
///   KUMO_TOKEN        staked token CA (launched separately)     [required]
///   ADMIN_COLD        admin cold key                            [required]
///   FEE_FUNDER_HOT    backend hot wallet (stock distributor)    [required]
///   NVDA_TOKEN        launch stock reward token                 [required]
///   GENESIS_CAP       lifetime KUMO bootstrap cap (raw units)   [required]
///   MIN_NOTIFY_KUMO   min KUMO per notify                       [default 1e18]
///   MIN_NOTIFY_STOCK  min stock raw units per notify            [default 1e14]
///
/// forge script script/Deploy.s.sol --rpc-url rhc --broadcast \
///   --verify --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/
contract Deploy is Script {
    function run() external {
        address kumo = vm.envAddress("KUMO_TOKEN");
        address admin = vm.envAddress("ADMIN_COLD");
        address funder = vm.envAddress("FEE_FUNDER_HOT");
        address nvda = vm.envAddress("NVDA_TOKEN");
        uint256 genesisCap = vm.envUint("GENESIS_CAP");
        uint256 minKumo = vm.envOr("MIN_NOTIFY_KUMO", uint256(1e18));
        uint256 minStock = vm.envOr("MIN_NOTIFY_STOCK", uint256(1e14));

        vm.startBroadcast();

        KumoMultiStaking staking = new KumoMultiStaking(IERC20(kumo), msg.sender);

        // reward registry: KUMO bootstrap (cold-key distributor, on-chain cap)
        // + launch stock (hot-wallet distributor, uncapped fee stream)
        staking.addReward(kumo, admin, 7 days, minKumo, genesisCap);
        staking.addReward(nvda, funder, 7 days, minStock, 0);

        // zero-supply guard: perma-stake 1 KUMO before any notify can happen
        IERC20(kumo).approve(address(staking), 1e18);
        staking.stake(1e18);

        // hand admin to the cold key, drop the deployer
        staking.grantRole(staking.DEFAULT_ADMIN_ROLE(), admin);
        if (admin != msg.sender) {
            staking.renounceRole(staking.DEFAULT_ADMIN_ROLE(), msg.sender);
        }

        vm.stopBroadcast();

        console.log("KumoMultiStaking:", address(staking));
        console.log("staked 1 KUMO as the zero-supply guard");
    }
}
