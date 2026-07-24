import { formatEther, parseAbi } from "viem";
import { CONFIG } from "./config.js";
import { publicClient, botAddress } from "./clients.js";
import { withRetry } from "./rpc.js";
import { sendWithGasBump } from "./send.js";

/**
 * PonsLaunchLocker — verified on Blockscout at both deployments in
 * CONFIG.lockers. Fees accrue in the token's locked Uniswap V3 position as
 * WETH + the token itself; collectFees pays the on-chain fee recipient
 * (feeRedirects[token], falling back to the deployer) REGARDLESS of caller,
 * minus the protocol share snapshotted at lock time.
 */
export const LOCKER_ABI = parseAbi([
  "struct LaunchedToken { address token; address deployer; address pairedToken; address positionManager; uint256 positionId; uint256 dexId; uint256 launchConfigId; uint256 restrictionsEndBlock; uint256 supply; bool isToken0; uint24 poolFee; bool exists; uint256 initialBuyAmount; }",
  "function collectFees(address token) returns (uint256 amount0, uint256 amount1)",
  "function getLaunchedToken(address token) view returns (LaunchedToken memory)",
  "function feeRedirects(address token) view returns (address)",
  "function tokenProtocolFeeShares(address token) view returns (uint256)",
  "function feeCollectors(address collector) view returns (bool)",
  "event FeesClaimed(address indexed token, address indexed caller, address token0, address token1, uint256 recipientAmount0, uint256 recipientAmount1, uint256 protocolAmount0, uint256 protocolAmount1)",
]);

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface LaunchedTokenInfo {
  deployer: `0x${string}`;
  pairedToken: `0x${string}`;
  positionId: bigint;
  /** true = the launched token is token0 in the pool (so WETH is token1). */
  isToken0: boolean;
  exists: boolean;
}

export interface LockerContext {
  locker: `0x${string}`;
  generation: "current" | "legacy" | "override";
  launched: LaunchedTokenInfo;
  /** On-chain fee recipient: feeRedirects[token] || deployer. Refreshed each cycle. */
  recipient: `0x${string}`;
  /** Protocol's percentage cut, snapshotted at lock time (30 current gen, 10 legacy). */
  protocolFeeSharePct: bigint;
}

export interface Claimable {
  grossWethWei: bigint;
  grossTokenRaw: bigint;
  /** Creator share after the protocol cut — what actually lands in the wallet. */
  netWethWei: bigint;
  netTokenRaw: bigint;
}

async function readLaunched(
  locker: `0x${string}`,
  label: string,
): Promise<LaunchedTokenInfo | null> {
  try {
    const t = await withRetry(
      () =>
        publicClient.readContract({
          address: locker,
          abi: LOCKER_ABI,
          functionName: "getLaunchedToken",
          args: [CONFIG.tokenAddress],
        }),
      label,
      { retries: 2 },
    );
    return t.exists
      ? {
          deployer: t.deployer,
          pairedToken: t.pairedToken,
          positionId: t.positionId,
          isToken0: t.isToken0,
          exists: t.exists,
        }
      : null;
  } catch {
    // Locker reverts (TokenNotFound) or RPC refused — treat as "not on this locker".
    return null;
  }
}

/**
 * Boot resolution: find which locker holds TOKEN_ADDRESS (override > current >
 * legacy), assert the pool is WETH-quoted, and read recipient + protocol share.
 */
export async function resolveLockerContext(): Promise<LockerContext> {
  const candidates: Array<{ locker: `0x${string}`; generation: LockerContext["generation"] }> =
    CONFIG.lockerOverride
      ? [{ locker: CONFIG.lockerOverride, generation: "override" }]
      : [
          { locker: CONFIG.lockers.current, generation: "current" },
          { locker: CONFIG.lockers.legacy, generation: "legacy" },
        ];

  for (const { locker, generation } of candidates) {
    const launched = await readLaunched(locker, `locker.getLaunchedToken(${generation})`);
    if (!launched) continue;

    if (launched.pairedToken.toLowerCase() !== CONFIG.weth.toLowerCase()) {
      throw new Error(
        `token ${CONFIG.tokenAddress} is paired against ${launched.pairedToken}, not WETH ` +
          `(${CONFIG.weth}) — this bot only handles WETH-quoted pons tokens`,
      );
    }

    const [redirect, share] = await Promise.all([
      withRetry(
        () =>
          publicClient.readContract({
            address: locker,
            abi: LOCKER_ABI,
            functionName: "feeRedirects",
            args: [CONFIG.tokenAddress],
          }),
        "locker.feeRedirects",
      ),
      withRetry(
        () =>
          publicClient.readContract({
            address: locker,
            abi: LOCKER_ABI,
            functionName: "tokenProtocolFeeShares",
            args: [CONFIG.tokenAddress],
          }),
        "locker.tokenProtocolFeeShares",
      ),
    ]);

    const recipient = redirect.toLowerCase() === ZERO_ADDRESS ? launched.deployer : redirect;
    console.log(
      `[locker] resolved ${generation} locker ${locker} — deployer ${launched.deployer}, ` +
        `recipient ${recipient}, protocol share ${share}%`,
    );
    return { locker, generation, launched, recipient, protocolFeeSharePct: share };
  }

  throw new Error(
    `token ${CONFIG.tokenAddress} not found on any pons locker ` +
      `(tried ${candidates.map((c) => `${c.generation}:${c.locker}`).join(", ")}). ` +
      `Is TOKEN_ADDRESS a pons launchpad token on chain ${CONFIG.chainId}?`,
  );
}

/** Re-read feeRedirects (it can change at any time via setFeeRedirect). */
export async function refreshRecipient(ctx: LockerContext): Promise<void> {
  const redirect = await withRetry(
    () =>
      publicClient.readContract({
        address: ctx.locker,
        abi: LOCKER_ABI,
        functionName: "feeRedirects",
        args: [CONFIG.tokenAddress],
      }),
    "locker.feeRedirects",
  );
  ctx.recipient = redirect.toLowerCase() === ZERO_ADDRESS ? ctx.launched.deployer : redirect;
}

/**
 * Read claimable fees by SIMULATING collectFees via eth_call (no state change).
 * The simulation returns GROSS (amount0, amount1); the creator's net share is
 * gross minus the protocol cut. Simulated as the on-chain recipient in DRY_RUN
 * so reads work with any local key; as the bot wallet in live mode.
 */
export async function readClaimable(ctx: LockerContext): Promise<Claimable> {
  const sender = CONFIG.dryRun ? ctx.recipient : botAddress;
  const { result } = await withRetry(
    () =>
      publicClient.simulateContract({
        address: ctx.locker,
        abi: LOCKER_ABI,
        functionName: "collectFees",
        args: [CONFIG.tokenAddress],
        account: sender,
      }),
    "locker.simulateCollectFees",
  );

  const [amount0, amount1] = result;
  const grossWethWei = ctx.launched.isToken0 ? amount1 : amount0;
  const grossTokenRaw = ctx.launched.isToken0 ? amount0 : amount1;
  // Mirrors the verified source: protocolAmount = (amount * share) / 100,
  // recipientAmount = amount - protocolAmount. No fallback share logic exists.
  const netWethWei = grossWethWei - (grossWethWei * ctx.protocolFeeSharePct) / 100n;
  const netTokenRaw = grossTokenRaw - (grossTokenRaw * ctx.protocolFeeSharePct) / 100n;

  console.log(
    `[claim] claimable gross ${formatEther(grossWethWei)} WETH + ${grossTokenRaw} token units — ` +
      `net after ${ctx.protocolFeeSharePct}% protocol: ${formatEther(netWethWei)} WETH`,
  );
  return { grossWethWei, grossTokenRaw, netWethWei, netTokenRaw };
}

/** Send the real collectFees tx (gas-bump send, allowlisted target). */
export async function claim(ctx: LockerContext): Promise<`0x${string}`> {
  return sendWithGasBump(
    {
      kind: "contract",
      to: ctx.locker,
      abi: LOCKER_ABI,
      functionName: "collectFees",
      args: [CONFIG.tokenAddress],
    },
    "claim.collectFees",
  );
}
