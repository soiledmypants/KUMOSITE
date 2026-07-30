// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {KumoMultiStaking} from "../src/KumoMultiStaking.sol";
import {MockERC20, FreezableERC20, FeeOnTransferERC20} from "./mocks/MockERC20.sol";

contract KumoMultiStakingTest is Test {
    KumoMultiStaking staking;
    MockERC20 kumo;
    MockERC20 nvda;

    address admin = makeAddr("admin");
    address funder = makeAddr("funder");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant DURATION = 7 days;
    uint256 constant GENESIS_CAP = 1_000_000e18;

    function setUp() public {
        kumo = new MockERC20("Kumo", "KUMO");
        nvda = new MockERC20("Nvidia Stock", "NVDA");
        staking = new KumoMultiStaking(IERC20(address(kumo)), admin);

        vm.startPrank(admin);
        staking.addReward(address(kumo), admin, DURATION, 1e18, GENESIS_CAP);
        staking.addReward(address(nvda), funder, DURATION, 1e12, 0);
        vm.stopPrank();

        kumo.mint(alice, 1_000e18);
        kumo.mint(bob, 1_000e18);
        kumo.mint(admin, GENESIS_CAP * 2);
        nvda.mint(funder, 1_000e18);

        vm.prank(alice);
        kumo.approve(address(staking), type(uint256).max);
        vm.prank(bob);
        kumo.approve(address(staking), type(uint256).max);
        vm.prank(admin);
        kumo.approve(address(staking), type(uint256).max);
        vm.prank(funder);
        nvda.approve(address(staking), type(uint256).max);
    }

    function _stake(address who, uint256 amount) internal {
        vm.prank(who);
        staking.stake(amount);
    }

    function _notifyNvda(uint256 amount, uint256 ethSpent) internal {
        vm.prank(funder);
        staking.notifyRewardAmount(address(nvda), amount, ethSpent);
    }

    function _notifyKumo(uint256 amount) internal {
        vm.prank(admin);
        staking.notifyRewardAmount(address(kumo), amount, 0);
    }

    // ---------------------------------------------------------------- flows

    function test_stakeWithdraw() public {
        _stake(alice, 100e18);
        assertEq(staking.totalSupply(), 100e18);
        assertEq(staking.balanceOf(alice), 100e18);
        vm.prank(alice);
        staking.withdraw(40e18);
        assertEq(staking.balanceOf(alice), 60e18);
        assertEq(kumo.balanceOf(alice), 940e18);
    }

    function test_stakeZeroReverts() public {
        vm.prank(alice);
        vm.expectRevert(KumoMultiStaking.ZeroAmount.selector);
        staking.stake(0);
    }

    function test_withdrawMoreThanBalanceReverts() public {
        _stake(alice, 10e18);
        vm.prank(alice);
        vm.expectRevert();
        staking.withdraw(11e18);
    }

    function test_streamingHalfPeriod() public {
        _stake(alice, 100e18);
        _notifyNvda(70e18, 1 ether);
        skip(DURATION / 2);
        uint256 earned = staking.earned(alice, address(nvda));
        assertApproxEqAbs(earned, 35e18, 1e6); // half the stream, tiny dust tolerance
    }

    function test_fullPeriodEarnsAll() public {
        _stake(alice, 100e18);
        _notifyNvda(70e18, 0);
        skip(DURATION + 1);
        assertApproxEqAbs(staking.earned(alice, address(nvda)), 70e18, DURATION);
        vm.prank(alice);
        staking.getReward();
        assertApproxEqAbs(nvda.balanceOf(alice), 70e18, DURATION);
        assertEq(staking.earned(alice, address(nvda)), 0);
    }

    function test_proRataSplit() public {
        _stake(alice, 100e18);
        _stake(bob, 300e18);
        _notifyNvda(40e18, 0);
        skip(DURATION + 1);
        uint256 a = staking.earned(alice, address(nvda));
        uint256 b = staking.earned(bob, address(nvda));
        assertApproxEqRel(b, a * 3, 1e12); // 1:3
    }

    function test_midPeriodJoinEarnsOnlyFromJoin() public {
        _stake(alice, 100e18);
        _notifyNvda(70e18, 0);
        skip(DURATION / 2);
        _stake(bob, 100e18);
        skip(DURATION / 2 + 1);
        uint256 a = staking.earned(alice, address(nvda));
        uint256 b = staking.earned(bob, address(nvda));
        // alice: 35 (solo half) + 17.5 (shared half); bob: 17.5
        assertApproxEqRel(a, 52.5e18, 1e12);
        assertApproxEqRel(b, 17.5e18, 1e12);
    }

    function test_exitWithdrawsAndClaims() public {
        _stake(alice, 100e18);
        _notifyNvda(70e18, 0);
        skip(DURATION + 1);
        vm.prank(alice);
        staking.exit();
        assertEq(staking.balanceOf(alice), 0);
        assertEq(kumo.balanceOf(alice), 1_000e18);
        assertApproxEqAbs(nvda.balanceOf(alice), 70e18, DURATION);
    }

    // ---------------------------------------------------------------- notify mechanics

    function test_notifyAfterFinishStartsCleanRate() public {
        _stake(alice, 100e18);
        _notifyNvda(70e18, 0);
        skip(DURATION + 10);
        _notifyNvda(14e18, 0);
        KumoMultiStaking.Reward memory r = staking.rewardData(address(nvda));
        assertEq(r.rewardRate, (14e18 * 1e18) / DURATION);
        assertEq(r.periodFinish, block.timestamp + DURATION);
    }

    function test_midPeriodTopUpRollsLeftoverIn() public {
        _stake(alice, 100e18);
        _notifyNvda(70e18, 0);
        skip(DURATION / 2);
        uint256 leftover = (DURATION / 2) * ((70e18 * 1e18) / DURATION);
        _notifyNvda(70e18, 0);
        KumoMultiStaking.Reward memory r = staking.rewardData(address(nvda));
        assertEq(r.rewardRate, (70e18 * 1e18 + leftover) / DURATION);
    }

    function test_belowMinNotifyReverts() public {
        _stake(alice, 1e18);
        vm.prank(funder);
        vm.expectRevert(KumoMultiStaking.BelowMinNotify.selector);
        staking.notifyRewardAmount(address(nvda), 1e11, 0); // min is 1e12
    }

    function test_capBoundaryExactOkPlusOneReverts() public {
        _stake(alice, 1e18);
        _notifyKumo(GENESIS_CAP); // exact cap ok
        vm.prank(admin);
        vm.expectRevert(KumoMultiStaking.NotifyCapExceeded.selector);
        staking.notifyRewardAmount(address(kumo), 1e18, 0);
    }

    function test_notifyWithoutBalanceReverts() public {
        _stake(alice, 1e18);
        vm.prank(funder);
        nvda.transfer(alice, 1_000e18); // funder now broke
        vm.prank(funder);
        vm.expectRevert();
        staking.notifyRewardAmount(address(nvda), 10e18, 0); // pull-based funding proof
    }

    function test_wrongDistributorReverts() public {
        _stake(alice, 1e18);
        nvda.mint(alice, 10e18);
        vm.startPrank(alice);
        nvda.approve(address(staking), type(uint256).max);
        vm.expectRevert(KumoMultiStaking.NotDistributor.selector);
        staking.notifyRewardAmount(address(nvda), 10e18, 0);
        vm.stopPrank();
    }

    function test_distributorRotationLocksOutOld() public {
        vm.prank(admin);
        staking.setRewardsDistributor(address(nvda), alice);
        _stake(alice, 1e18);
        vm.prank(funder);
        vm.expectRevert(KumoMultiStaking.NotDistributor.selector);
        staking.notifyRewardAmount(address(nvda), 10e18, 0);
    }

    function test_setDurationMidPeriodRevertsThenWorks() public {
        _stake(alice, 1e18);
        _notifyNvda(70e18, 0);
        vm.prank(admin);
        vm.expectRevert(KumoMultiStaking.PeriodStillActive.selector);
        staking.setRewardsDuration(address(nvda), 14 days);
        skip(DURATION + 1);
        uint256 newDuration = 14 days;
        vm.prank(admin);
        staking.setRewardsDuration(address(nvda), newDuration);
        _notifyNvda(14e18, 0);
        KumoMultiStaking.Reward memory r = staking.rewardData(address(nvda));
        assertEq(r.rewardRate, (14e18 * 1e18) / newDuration);
    }

    function test_lowerNotifyCapMonotone() public {
        vm.prank(admin);
        staking.lowerNotifyCap(address(kumo), GENESIS_CAP / 2);
        vm.prank(admin);
        vm.expectRevert(KumoMultiStaking.CapCanOnlyDecrease.selector);
        staking.lowerNotifyCap(address(kumo), GENESIS_CAP);
    }

    function test_zeroSupplyNotifyStrandsRewards() public {
        // documents the known behavior: rewards streamed with nobody staked are stuck
        _notifyNvda(70e18, 0);
        skip(DURATION / 2);
        _stake(alice, 100e18);
        skip(DURATION);
        uint256 earned = staking.earned(alice, address(nvda));
        assertApproxEqRel(earned, 35e18, 1e12); // only the second half streams to alice
        // the stranded 35 stay in the contract; solvency holds
        assertGe(nvda.balanceOf(address(staking)), earned);
    }

    // ---------------------------------------------------------------- multi-reward

    function test_perTokenIsolation() public {
        _stake(alice, 100e18);
        _notifyKumo(700e18);
        KumoMultiStaking.Reward memory before = staking.rewardData(address(nvda));
        skip(1 days);
        _notifyKumo(700e18); // touch KUMO again
        KumoMultiStaking.Reward memory afterR = staking.rewardData(address(nvda));
        assertEq(before.rewardRate, afterR.rewardRate);
        assertEq(before.periodFinish, afterR.periodFinish);
        assertEq(staking.earned(alice, address(nvda)), 0);
    }

    function test_claimAllPaysBothTokens() public {
        _stake(alice, 100e18);
        _notifyKumo(700e18);
        _notifyNvda(7e18, 1 ether);
        skip(DURATION + 1);
        vm.prank(alice);
        staking.getReward();
        assertApproxEqAbs(nvda.balanceOf(alice), 7e18, DURATION);
        assertApproxEqAbs(kumo.balanceOf(alice), 900e18 + 700e18, DURATION); // 1000 - 100 staked + 700 reward
    }

    function test_selectiveClaimLeavesOtherAccruing() public {
        _stake(alice, 100e18);
        _notifyKumo(700e18);
        _notifyNvda(7e18, 0);
        skip(DURATION + 1);
        address[] memory only = new address[](1);
        only[0] = address(kumo);
        vm.prank(alice);
        staking.getReward(only);
        assertEq(nvda.balanceOf(alice), 0);
        assertGt(staking.earned(alice, address(nvda)), 0);
    }

    function test_addRewardMidLifeNoRetroactiveAccrual() public {
        _stake(alice, 100e18);
        skip(30 days);
        MockERC20 tsla = new MockERC20("Tesla Stock", "TSLA");
        vm.prank(admin);
        staking.addReward(address(tsla), funder, DURATION, 1e12, 0);
        assertEq(staking.earned(alice, address(tsla)), 0);
        tsla.mint(funder, 100e18);
        vm.startPrank(funder);
        tsla.approve(address(staking), type(uint256).max);
        staking.notifyRewardAmount(address(tsla), 70e18, 0);
        vm.stopPrank();
        skip(DURATION + 1);
        assertApproxEqAbs(staking.earned(alice, address(tsla)), 70e18, DURATION);
    }

    function test_epochRotationOldLeftoverUntouched() public {
        _stake(alice, 100e18);
        _notifyNvda(70e18, 0);
        skip(DURATION / 2);
        MockERC20 tsla = new MockERC20("Tesla Stock", "TSLA");
        vm.prank(admin);
        staking.addReward(address(tsla), funder, DURATION, 1e12, 0);
        tsla.mint(funder, 100e18);
        vm.startPrank(funder);
        tsla.approve(address(staking), type(uint256).max);
        staking.notifyRewardAmount(address(tsla), 10e18, 0);
        vm.stopPrank();
        skip(DURATION + 1);
        vm.prank(alice);
        staking.getReward();
        assertApproxEqAbs(nvda.balanceOf(alice), 70e18, DURATION);
        assertApproxEqAbs(tsla.balanceOf(alice), 10e18, DURATION);
    }

    function test_duplicateAndNinthRewardRevert() public {
        vm.startPrank(admin);
        vm.expectRevert(KumoMultiStaking.DuplicateRewardToken.selector);
        staking.addReward(address(nvda), funder, DURATION, 0, 0);
        for (uint256 i = 0; i < 6; i++) {
            staking.addReward(address(new MockERC20("x", "X")), funder, DURATION, 0, 0);
        }
        address ninth = address(new MockERC20("y", "Y"));
        vm.expectRevert(KumoMultiStaking.TooManyRewardTokens.selector);
        staking.addReward(ninth, funder, DURATION, 0, 0);
        vm.stopPrank();
    }

    function test_frozenTokenDoSConfinedBySelectiveClaim() public {
        FreezableERC20 frz = new FreezableERC20();
        vm.prank(admin);
        staking.addReward(address(frz), funder, DURATION, 0, 0);
        frz.mint(funder, 100e18);
        vm.startPrank(funder);
        frz.approve(address(staking), type(uint256).max);
        staking.notifyRewardAmount(address(frz), 70e18, 0);
        vm.stopPrank();

        _stake(alice, 100e18);
        _notifyKumo(700e18);
        skip(DURATION + 1);

        frz.setFrozen(true);
        vm.prank(alice);
        vm.expectRevert(bytes("frozen"));
        staking.getReward(); // claim-all is blocked by the frozen token...

        address[] memory only = new address[](1);
        only[0] = address(kumo);
        vm.prank(alice);
        staking.getReward(only); // ...but selective claim still pays
        assertGt(kumo.balanceOf(alice), 900e18);

        // and principal is always exitable regardless (claim first died, withdraw works)
        vm.prank(alice);
        staking.withdraw(100e18);
    }

    // ---------------------------------------------------------------- access + safety

    function test_pauseGatesStakeAndNotifyOnly() public {
        _stake(alice, 100e18);
        _notifyNvda(70e18, 0);
        skip(1 days);
        vm.prank(admin);
        staking.pause();

        vm.prank(alice);
        vm.expectRevert();
        staking.stake(1e18);
        vm.prank(funder);
        vm.expectRevert();
        staking.notifyRewardAmount(address(nvda), 1e18, 0);

        vm.prank(alice);
        staking.getReward(); // claim works while paused
        vm.prank(alice);
        staking.withdraw(100e18); // withdraw works while paused
    }

    function test_adminFunctionsGated() public {
        vm.startPrank(alice);
        vm.expectRevert();
        staking.addReward(address(1), address(2), 1, 0, 0);
        vm.expectRevert();
        staking.pause();
        vm.expectRevert();
        staking.setRewardsDistributor(address(nvda), alice);
        vm.expectRevert();
        staking.recoverERC20(address(0xbeef), 1);
        vm.stopPrank();
    }

    function test_recoverERC20Protections() public {
        MockERC20 stray = new MockERC20("Stray", "STRAY");
        stray.mint(address(staking), 5e18);
        vm.startPrank(admin);
        vm.expectRevert(KumoMultiStaking.CannotRecoverProtected.selector);
        staking.recoverERC20(address(kumo), 1);
        vm.expectRevert(KumoMultiStaking.CannotRecoverProtected.selector);
        staking.recoverERC20(address(nvda), 1);
        staking.recoverERC20(address(stray), 5e18);
        vm.stopPrank();
        assertEq(stray.balanceOf(admin), 5e18);
    }

    function test_feeOnTransferStakeCreditsDelta() public {
        FeeOnTransferERC20 fee = new FeeOnTransferERC20();
        KumoMultiStaking s2 = new KumoMultiStaking(IERC20(address(fee)), admin);
        fee.mint(alice, 100e18);
        vm.startPrank(alice);
        fee.approve(address(s2), type(uint256).max);
        s2.stake(100e18);
        vm.stopPrank();
        assertEq(s2.balanceOf(alice), 99e18); // 1% fee burned in transit; delta credited
        vm.prank(alice);
        s2.withdraw(99e18); // solvent: contract holds exactly what it credited
    }

    function test_lifetimeStatsAndAprInputs() public {
        _stake(alice, 100e18);
        _notifyNvda(7e18, 2 ether);
        (uint256 notified, uint256 claimed, uint256 ethSpent, uint256 capRemaining) =
            staking.lifetimeStats(address(nvda));
        assertEq(notified, 7e18);
        assertEq(claimed, 0);
        assertEq(ethSpent, 2 ether);
        assertEq(capRemaining, type(uint256).max);

        (uint256 rate, uint256 finish, uint256 total) = staking.aprInputs(address(nvda));
        assertEq(rate, (7e18 * 1e18) / DURATION);
        assertEq(finish, block.timestamp + DURATION);
        assertEq(total, 100e18);

        skip(DURATION + 1);
        vm.prank(alice);
        staking.getReward();
        (, claimed,,) = staking.lifetimeStats(address(nvda));
        assertGt(claimed, 0);
    }

    // ---------------------------------------------------------------- fuzz

    /// solvency: over any single-staker stream, claims never exceed notified
    function testFuzz_claimsNeverExceedNotified(uint96 amount, uint32 elapsed) public {
        uint256 amt = bound(uint256(amount), 1e12, 1_000e18);
        uint256 dt = bound(uint256(elapsed), 1, 30 days);
        _stake(alice, 100e18);
        _notifyNvda(amt, 0);
        skip(dt);
        vm.prank(alice);
        staking.getReward();
        (uint256 notified, uint256 claimed,,) = staking.lifetimeStats(address(nvda));
        assertLe(claimed, notified);
        assertLe(nvda.balanceOf(alice), amt);
    }

    /// two stakers, random mid-period top-up: total claims still bounded by notified
    function testFuzz_topUpAccounting(uint96 first, uint96 second, uint32 gap) public {
        uint256 a1 = bound(uint256(first), 1e12, 500e18);
        uint256 a2 = bound(uint256(second), 1e12, 500e18);
        uint256 dt = bound(uint256(gap), 1, DURATION - 1);
        _stake(alice, 100e18);
        _stake(bob, 50e18);
        _notifyNvda(a1, 0);
        skip(dt);
        _notifyNvda(a2, 0);
        skip(DURATION + 1);
        vm.prank(alice);
        staking.getReward();
        vm.prank(bob);
        staking.getReward();
        (uint256 notified, uint256 claimed,,) = staking.lifetimeStats(address(nvda));
        assertLe(claimed, notified);
        assertEq(notified, a1 + a2);
    }
}
