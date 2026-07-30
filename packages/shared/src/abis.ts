// human-readable abi fragments shared across consumers. kept as plain string
// arrays (no viem dependency here) — consumers run them through parseAbi.

export const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
] as const;

export const STAKING_VIEW_ABI = [
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function rewardTokens() view returns (address[])",
] as const;
