// robinhood chain (4663) constants — THE single copy. the agent's config.ts
// uses these as env-overridable defaults; the site imports them directly.
// every address below was previously verified on-chain (kumo-agent config.ts,
// ops-panel claim engine) — do not edit without re-verifying on blockscout.

export type HexAddress = `0x${string}`;

export const CHAIN_ID = 4663;
export const RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
export const EXPLORER_BASE = "https://robinhoodchain.blockscout.com";

export const ADDRESSES = {
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  usdg: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  uniV3Factory: "0x1f7d7550b1b028f7571e69a784071f0205fd2efa",
  swapRouter02: "0xcaf681a66d020601342297493863e78c959e5cb2",
  quoterV2: "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7",
  erc8004Registry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  nvda: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec",
  nvdaUsdgPool: "0xd4eb21209c4d6093f80b5b84f5c45cc093ea14a3",
  // pons launchpad lockers (creator-fee source for $KUMO)
  ponsLockerCurrent: "0x736D76699C26D0d966744cAe304C000d471f7F35", // block 8991118+, protocol 30%
  ponsLockerLegacy: "0x31ca5E101941A93A7DD6d0497928700625CF54B5", // block 8600612+, protocol 10%
  zero: "0x0000000000000000000000000000000000000000",
  dead: "0x000000000000000000000000000000000000dead",
} as const satisfies Record<string, HexAddress>;

export const FEE_TIERS = {
  wethUsdg: 100,
  usdgStock: 500,
  defaults: [500, 3000, 10000],
} as const;

export function txUrl(hash: string, explorerBase: string = EXPLORER_BASE): string {
  return `${explorerBase}/tx/${hash}`;
}

export function addrUrl(address: string, explorerBase: string = EXPLORER_BASE): string {
  return `${explorerBase}/address/${address}`;
}
