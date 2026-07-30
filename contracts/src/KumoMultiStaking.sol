// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title KumoMultiStaking
/// @notice Stake KUMO, earn up to 8 concurrent reward tokens (tokenized stocks +
///         the capped KUMO bootstrap stream). Synthetix MultiRewards-style
///         accounting with pull-based funding: notifyRewardAmount transfers the
///         reward in from the caller, so phantom rewards are impossible.
/// @dev    Deliberately immutable (no proxy), no removeReward, no sweep of
///         staked principal or reward reserves. withdraw/getReward are never
///         pausable — exiting is always possible and forfeits nothing.
///         Reward tokens are ERC-8056 stock tokens: raw balances never change
///         on splits/dividends, so raw-unit accounting is safe. uiMultiplier is
///         display-layer only and intentionally never read on-chain.
contract KumoMultiStaking is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- errors
    error ZeroAmount();
    error ZeroAddress();
    error NotDistributor();
    error UnknownRewardToken();
    error DuplicateRewardToken();
    error TooManyRewardTokens();
    error BelowMinNotify();
    error NotifyCapExceeded();
    error CapCanOnlyDecrease();
    error PeriodStillActive();
    error CannotRecoverProtected();
    error AmountTooLarge();

    // ---------------------------------------------------------------- types
    struct Reward {
        address distributor;          // sole address allowed to notify this token
        uint256 rewardsDuration;      // streaming window, e.g. 7 days
        uint256 periodFinish;
        uint256 rewardRate;           // reward tokens per second, scaled by 1e18
        uint256 lastUpdateTime;
        uint256 rewardPerTokenStored; // 1e18-scaled
        uint256 minNotifyAmount;      // anti-dust-dilution floor per notify
        uint256 notifyCap;            // lifetime cap; 0 = uncapped; lower-only
        uint256 notifiedTotal;
        uint256 claimedTotal;
        uint256 ethSpentTotal;        // informational buyback audit trail
    }

    // ---------------------------------------------------------------- state
    uint256 public constant MAX_REWARD_TOKENS = 8;

    IERC20 public immutable stakingToken;

    address[] private _rewardTokens;
    mapping(address => bool) public isRewardToken;
    mapping(address => Reward) private _rewardData;

    // user => token => checkpoint / accrued
    mapping(address => mapping(address => uint256)) public userRewardPerTokenPaid;
    mapping(address => mapping(address => uint256)) public rewards;

    uint256 private _totalSupply;
    mapping(address => uint256) private _balances;

    // ---------------------------------------------------------------- events
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, address indexed token, uint256 amount);
    event RewardAdded(address indexed token, address distributor, uint256 duration, uint256 notifyCap);
    event RewardNotified(
        address indexed token, uint256 amount, uint256 ethSpentWei, uint256 newRewardRate, uint256 periodFinish
    );
    event RewardsDistributorUpdated(address indexed token, address distributor);
    event RewardsDurationUpdated(address indexed token, uint256 duration);
    event NotifyCapLowered(address indexed token, uint256 newCap);
    event Recovered(address token, uint256 amount);

    // ---------------------------------------------------------------- setup
    constructor(IERC20 stakingToken_, address admin_) {
        if (address(stakingToken_) == address(0) || admin_ == address(0)) revert ZeroAddress();
        stakingToken = stakingToken_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
    }

    // ---------------------------------------------------------------- modifiers
    /// @dev storage math only — no external calls, so a misbehaving reward token
    ///      can never brick stake/withdraw.
    modifier updateReward(address account) {
        uint256 len = _rewardTokens.length;
        for (uint256 i = 0; i < len; ++i) {
            address token = _rewardTokens[i];
            Reward storage r = _rewardData[token];
            r.rewardPerTokenStored = _rewardPerToken(r);
            r.lastUpdateTime = _lastTimeRewardApplicable(r);
            if (account != address(0)) {
                rewards[account][token] = _earned(account, token, r);
                userRewardPerTokenPaid[account][token] = r.rewardPerTokenStored;
            }
        }
        _;
    }

    // ---------------------------------------------------------------- user
    function stake(uint256 amount) external nonReentrant whenNotPaused updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();
        // delta-measured credit: correct even for fee-on-transfer staking tokens
        uint256 before = stakingToken.balanceOf(address(this));
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        uint256 credited = stakingToken.balanceOf(address(this)) - before;
        if (credited == 0) revert ZeroAmount();
        _totalSupply += credited;
        _balances[msg.sender] += credited;
        emit Staked(msg.sender, credited);
    }

    /// @dev never pausable — withdrawing is the emergency exit and forfeits nothing
    function withdraw(uint256 amount) external nonReentrant updateReward(msg.sender) {
        _withdraw(amount);
    }

    /// @notice claim every reward token
    function getReward() external nonReentrant updateReward(msg.sender) {
        _claimAll();
    }

    /// @notice selective claim — confines a frozen reward token's damage to itself
    function getReward(address[] calldata tokens) external nonReentrant updateReward(msg.sender) {
        for (uint256 i = 0; i < tokens.length; ++i) {
            if (!isRewardToken[tokens[i]]) revert UnknownRewardToken();
            _payReward(tokens[i]);
        }
    }

    function exit() external nonReentrant updateReward(msg.sender) {
        _withdraw(_balances[msg.sender]);
        _claimAll();
    }

    function _withdraw(uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        _balances[msg.sender] -= amount;
        _totalSupply -= amount;
        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function _claimAll() private {
        uint256 len = _rewardTokens.length;
        for (uint256 i = 0; i < len; ++i) {
            _payReward(_rewardTokens[i]);
        }
    }

    function _payReward(address token) private {
        uint256 reward = rewards[msg.sender][token];
        if (reward == 0) return;
        rewards[msg.sender][token] = 0;
        Reward storage r = _rewardData[token];
        r.claimedTotal += reward;
        IERC20(token).safeTransfer(msg.sender, reward);
        emit RewardPaid(msg.sender, token, reward);
    }

    // ---------------------------------------------------------------- funding
    /// @notice pull-based: transfers `amount` in from the caller. Only the
    ///         token's distributor may notify. ethSpentWei is informational —
    ///         the buyback audit trail linking revenue to rewards.
    function notifyRewardAmount(address token, uint256 amount, uint256 ethSpentWei)
        external
        nonReentrant
        whenNotPaused
        updateReward(address(0))
    {
        if (!isRewardToken[token]) revert UnknownRewardToken();
        Reward storage r = _rewardData[token];
        if (msg.sender != r.distributor) revert NotDistributor();
        if (amount < r.minNotifyAmount || amount == 0) revert BelowMinNotify();
        if (amount > type(uint256).max / 1e18) revert AmountTooLarge();
        if (r.notifyCap != 0 && r.notifiedTotal + amount > r.notifyCap) revert NotifyCapExceeded();

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        if (block.timestamp >= r.periodFinish) {
            r.rewardRate = (amount * 1e18) / r.rewardsDuration;
        } else {
            uint256 remaining = r.periodFinish - block.timestamp;
            uint256 leftover = remaining * r.rewardRate; // already 1e18-scaled
            r.rewardRate = (amount * 1e18 + leftover) / r.rewardsDuration;
        }
        r.lastUpdateTime = block.timestamp;
        r.periodFinish = block.timestamp + r.rewardsDuration;
        r.notifiedTotal += amount;
        r.ethSpentTotal += ethSpentWei;

        emit RewardNotified(token, amount, ethSpentWei, r.rewardRate, r.periodFinish);
    }

    // ---------------------------------------------------------------- admin
    /// @notice register a reward token. Append-only: there is no removeReward,
    ///         by design — removal is a rug vector against owed rewards.
    function addReward(
        address token,
        address distributor,
        uint256 duration,
        uint256 minNotifyAmount,
        uint256 notifyCap
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (token == address(0) || distributor == address(0)) revert ZeroAddress();
        if (isRewardToken[token]) revert DuplicateRewardToken();
        if (_rewardTokens.length >= MAX_REWARD_TOKENS) revert TooManyRewardTokens();
        if (duration == 0) revert ZeroAmount();
        isRewardToken[token] = true;
        _rewardTokens.push(token);
        Reward storage r = _rewardData[token];
        r.distributor = distributor;
        r.rewardsDuration = duration;
        r.minNotifyAmount = minNotifyAmount;
        r.notifyCap = notifyCap;
        emit RewardAdded(token, distributor, duration, notifyCap);
    }

    function setRewardsDistributor(address token, address distributor) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!isRewardToken[token]) revert UnknownRewardToken();
        if (distributor == address(0)) revert ZeroAddress();
        _rewardData[token].distributor = distributor;
        emit RewardsDistributorUpdated(token, distributor);
    }

    function setRewardsDuration(address token, uint256 duration) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!isRewardToken[token]) revert UnknownRewardToken();
        if (duration == 0) revert ZeroAmount();
        if (block.timestamp <= _rewardData[token].periodFinish) revert PeriodStillActive();
        _rewardData[token].rewardsDuration = duration;
        emit RewardsDurationUpdated(token, duration);
    }

    function lowerNotifyCap(address token, uint256 newCap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (!isRewardToken[token]) revert UnknownRewardToken();
        Reward storage r = _rewardData[token];
        if (r.notifyCap == 0 || newCap >= r.notifyCap) revert CapCanOnlyDecrease();
        if (newCap < r.notifiedTotal) revert CapCanOnlyDecrease();
        r.notifyCap = newCap;
        emit NotifyCapLowered(token, newCap);
    }

    /// @dev gates stake + notify only; withdraw/claim are structurally unpausable
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /// @notice rescue accidentally-sent foreign tokens. The staking token and
    ///         every registered reward token are permanently unreachable.
    function recoverERC20(address token, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (token == address(stakingToken) || isRewardToken[token]) revert CannotRecoverProtected();
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Recovered(token, amount);
    }

    // ---------------------------------------------------------------- views
    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _balances[account];
    }

    function rewardTokens() external view returns (address[] memory) {
        return _rewardTokens;
    }

    function rewardData(address token) external view returns (Reward memory) {
        return _rewardData[token];
    }

    function lastTimeRewardApplicable(address token) external view returns (uint256) {
        return _lastTimeRewardApplicable(_rewardData[token]);
    }

    function rewardPerToken(address token) external view returns (uint256) {
        return _rewardPerToken(_rewardData[token]);
    }

    function earned(address account, address token) external view returns (uint256) {
        return _earned(account, token, _rewardData[token]);
    }

    function earnedAll(address account) external view returns (address[] memory tokens, uint256[] memory amounts) {
        uint256 len = _rewardTokens.length;
        tokens = _rewardTokens;
        amounts = new uint256[](len);
        for (uint256 i = 0; i < len; ++i) {
            amounts[i] = _earned(account, tokens[i], _rewardData[tokens[i]]);
        }
    }

    /// @notice everything a frontend needs for an honest APR display
    function aprInputs(address token)
        external
        view
        returns (uint256 rewardRateScaled, uint256 periodFinish, uint256 totalStaked)
    {
        Reward storage r = _rewardData[token];
        return (r.rewardRate, r.periodFinish, _totalSupply);
    }

    function lifetimeStats(address token)
        external
        view
        returns (uint256 notifiedTotal, uint256 claimedTotal, uint256 ethSpentTotal, uint256 capRemaining)
    {
        Reward storage r = _rewardData[token];
        capRemaining = r.notifyCap == 0 ? type(uint256).max : r.notifyCap - r.notifiedTotal;
        return (r.notifiedTotal, r.claimedTotal, r.ethSpentTotal, capRemaining);
    }

    // ---------------------------------------------------------------- internals
    function _lastTimeRewardApplicable(Reward storage r) private view returns (uint256) {
        return block.timestamp < r.periodFinish ? block.timestamp : r.periodFinish;
    }

    function _rewardPerToken(Reward storage r) private view returns (uint256) {
        if (_totalSupply == 0) return r.rewardPerTokenStored;
        return r.rewardPerTokenStored + ((_lastTimeRewardApplicable(r) - r.lastUpdateTime) * r.rewardRate) / _totalSupply;
    }

    function _earned(address account, address token, Reward storage r) private view returns (uint256) {
        return (_balances[account] * (_rewardPerToken(r) - userRewardPerTokenPaid[account][token])) / 1e18
            + rewards[account][token];
    }
}
