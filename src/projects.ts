import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, defineChain, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { addr, dataPath } from "./config.js";
import { decryptKey } from "./keyvault.js";
import { getOverride, type ProjectOverride } from "./overrides.js";
import { makeSender, type PC, type Sender, type WC } from "./send.js";

/** Verified Uniswap v3 periphery on Robinhood Chain (defaults; overridable per project). */
const RHC_SWAP_ROUTER_02 = "0xcaf681a66d020601342297493863e78c959e5cb2";
const RHC_QUOTER_V2 = "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7";

export interface RawProject {
  id: string;
  name: string;
  chainId: number;
  rpcUrl: string;
  explorerBase?: string;
  tokenAddress: string;
  weth: string;
  /** "auto" = pons current→legacy probe; 0x… = explicit locker; null/absent = no fee claiming. */
  locker?: string | null;
  treasuryWallet: string;
  kumoWallet?: string;
  treasuryPct?: number;
  /** "env:VAR_NAME" or "vault:<key-id>". */
  keyRef: string;
  claim?: { enabled?: boolean; intervalMinutes?: number; claimMinEth?: string };
  caps?: {
    gasReserveEth?: string;
    maxForwardEth?: string;
    forwardMinEth?: string;
    maxRoundEth?: string;
    maxAirdropRecipients?: number;
  };
  swap?: { router?: string; quoter?: string; feeTier?: number; slippagePct?: number };
  holders?: { startBlock?: string; scanChunkBlocks?: string; minBalance?: string; exclude?: string[] };
}

export interface ProjectRuntime {
  id: string;
  name: string;
  chainId: number;
  rpcUrl: string;
  explorerBase: string;
  tokenAddress: `0x${string}`;
  weth: `0x${string}`;
  lockerMode: "auto" | `0x${string}` | null;
  treasuryWallet: `0x${string}`;
  kumoWallet: `0x${string}` | null;
  treasuryPct: number;
  claim: { enabled: boolean; intervalMinutes: number; claimMinWei: bigint };
  caps: {
    gasReserveWei: bigint;
    maxForwardWei: bigint;
    forwardMinWei: bigint;
    maxRoundWei: bigint;
    maxAirdropRecipients: number;
  };
  swap: { router: `0x${string}`; quoter: `0x${string}`; feeTier: number; slippagePct: number };
  holders: { startBlock: bigint; scanChunkBlocks: bigint; minBalance: bigint; exclude: string[] };
  publicClient: PC;
  walletClient: WC;
  botAddress: `0x${string}`;
  sender: Sender;
  holdersDbPath: string;
  explorerTx(hash: string): string;
}

/** Replace ${ENV_VAR} in every string of the parsed JSON (missing vars → empty string). */
function interpolate<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_, name: string) => process.env[name] ?? "") as T;
  }
  if (Array.isArray(value)) return value.map((v) => interpolate(v)) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = interpolate(v);
    return out as T;
  }
  return value;
}

function req(project: string, field: string, value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error(
      `project "${project}": ${field} is empty — set the env var it interpolates or edit projects.json`,
    );
  }
  return value;
}

function resolvePrivateKey(project: string, keyRef: string): `0x${string}` {
  if (keyRef.startsWith("env:")) {
    const name = keyRef.slice(4);
    const raw = process.env[name];
    if (!raw || raw.trim().length === 0) {
      throw new Error(`project "${project}": keyRef "${keyRef}" — env var ${name} is unset`);
    }
    const trimmed = raw.trim();
    return (trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as `0x${string}`;
  }
  if (keyRef.startsWith("vault:")) {
    return decryptKey(keyRef.slice(6)); // requires KEY_SECRET; throws clearly if missing
  }
  throw new Error(`project "${project}": keyRef must be "env:VAR" or "vault:<id>", got "${keyRef}"`);
}

function buildRuntime(raw: RawProject): ProjectRuntime {
  const id = req(raw.id ?? "?", "id", raw.id);
  const tokenAddress = addr(req(id, "tokenAddress", raw.tokenAddress));
  const weth = addr(req(id, "weth", raw.weth));
  const treasuryWallet = addr(req(id, "treasuryWallet", raw.treasuryWallet));
  const kumoWallet = raw.kumoWallet && raw.kumoWallet.trim() ? addr(raw.kumoWallet) : null;
  const treasuryPct = raw.treasuryPct ?? 0;
  if (!Number.isInteger(treasuryPct) || treasuryPct < 0 || treasuryPct > 100) {
    throw new Error(`project "${id}": treasuryPct must be an integer 0-100`);
  }
  if (treasuryPct < 100 && !kumoWallet) {
    throw new Error(`project "${id}": kumoWallet required while treasuryPct < 100`);
  }

  const lockerMode: ProjectRuntime["lockerMode"] =
    raw.locker === undefined || raw.locker === null
      ? null
      : raw.locker === "auto"
        ? "auto"
        : addr(raw.locker);

  const rpcUrl = req(id, "rpcUrl", raw.rpcUrl);
  const explorerBase = raw.explorerBase?.replace(/\/$/, "") ?? "";
  const chain = defineChain({
    id: raw.chainId,
    name: raw.name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });

  const account = privateKeyToAccount(resolvePrivateKey(id, req(id, "keyRef", raw.keyRef)));
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) }) as PC;
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) }) as WC;

  const explorerTx = (hash: string): string =>
    explorerBase ? `${explorerBase}/tx/${hash}` : hash;

  const p: ProjectRuntime = {
    id,
    name: raw.name ?? id,
    chainId: raw.chainId,
    rpcUrl,
    explorerBase,
    tokenAddress,
    weth,
    lockerMode,
    treasuryWallet,
    kumoWallet,
    treasuryPct,
    claim: {
      enabled: (raw.claim?.enabled ?? lockerMode !== null) && lockerMode !== null,
      intervalMinutes: raw.claim?.intervalMinutes ?? 10,
      claimMinWei: parseEther(raw.claim?.claimMinEth ?? "0.01"),
    },
    caps: {
      gasReserveWei: parseEther(raw.caps?.gasReserveEth ?? "0.02"),
      maxForwardWei: parseEther(raw.caps?.maxForwardEth ?? "1"),
      forwardMinWei: parseEther(raw.caps?.forwardMinEth ?? "0.001"),
      maxRoundWei: parseEther(raw.caps?.maxRoundEth ?? "0.25"),
      maxAirdropRecipients: raw.caps?.maxAirdropRecipients ?? 500,
    },
    swap: {
      router: addr(raw.swap?.router ?? RHC_SWAP_ROUTER_02),
      quoter: addr(raw.swap?.quoter ?? RHC_QUOTER_V2),
      feeTier: raw.swap?.feeTier ?? 10000,
      slippagePct: raw.swap?.slippagePct ?? 3,
    },
    holders: {
      // `||` (not ??) — interpolated-but-unset env vars arrive as "".
      startBlock: BigInt(raw.holders?.startBlock || "0"),
      scanChunkBlocks: BigInt(raw.holders?.scanChunkBlocks || "2000"),
      minBalance: BigInt(raw.holders?.minBalance || "0"),
      exclude: (raw.holders?.exclude ?? []).map((a) => a.toLowerCase()),
    },
    publicClient,
    walletClient,
    botAddress: account.address,
    sender: makeSender({
      projectId: id,
      publicClient,
      walletClient,
      botAddress: account.address,
      explorerTx,
    }),
    // token-scoped: switching the CA (panel config) automatically starts a
    // fresh holder index instead of mixing balances of two different tokens.
    holdersDbPath: dataPath(`holders-${id}-${tokenAddress.toLowerCase().slice(2, 10)}.db`),
    explorerTx,
  };

  // Static allowlist. The locker is added after resolution in engine/claim.ts;
  // round recipients are only ever added via sender.withExtraAllowed().
  p.sender.allow(p.weth);
  p.sender.allow(p.tokenAddress);
  p.sender.allow(p.treasuryWallet);
  if (p.kumoWallet) p.sender.allow(p.kumoWallet);
  p.sender.allow(p.swap.router);
  return p;
}

/** Panel overrides (persisted on the data volume) win over projects.json/env. */
function applyOverride(raw: RawProject, o: ProjectOverride): RawProject {
  const merged: RawProject = { ...raw };
  if (o.tokenAddress) merged.tokenAddress = o.tokenAddress;
  if (o.treasuryWallet) merged.treasuryWallet = o.treasuryWallet;
  if (o.kumoWallet !== undefined) merged.kumoWallet = o.kumoWallet;
  if (o.treasuryPct !== undefined) merged.treasuryPct = o.treasuryPct;
  if (o.keyRef) merged.keyRef = o.keyRef;
  if (o.claimEnabled !== undefined || o.claimMinEth || o.claimIntervalMinutes !== undefined) {
    merged.claim = { ...raw.claim };
    if (o.claimEnabled !== undefined) merged.claim.enabled = o.claimEnabled;
    if (o.claimMinEth) merged.claim.claimMinEth = o.claimMinEth;
    if (o.claimIntervalMinutes !== undefined) merged.claim.intervalMinutes = o.claimIntervalMinutes;
  }
  if (o.holdersStartBlock) {
    merged.holders = { ...raw.holders, startBlock: o.holdersStartBlock };
  }
  return merged;
}

/** Interpolated projects.json entries, before overrides. */
export function loadRawProjects(): RawProject[] {
  const path = resolve(process.cwd(), process.env.PROJECTS_FILE ?? "projects.json");
  const parsed = interpolate(
    JSON.parse(readFileSync(path, "utf8")) as { projects: RawProject[] },
  );
  if (!parsed.projects || parsed.projects.length === 0) {
    throw new Error(`no projects defined in ${path}`);
  }
  return parsed.projects;
}

/** Load + validate projects.json with panel overrides applied. */
export function loadProjects(): ProjectRuntime[] {
  const seen = new Set<string>();
  return loadRawProjects().map((raw) => {
    // buildRuntime resolves keyRefs eagerly, so a vault: ref without KEY_SECRET
    // fails right here at boot with keyvault's clear error message.
    const p = buildRuntime(applyOverride(raw, getOverride(raw.id ?? "")));
    if (seen.has(p.id)) throw new Error(`duplicate project id "${p.id}"`);
    seen.add(p.id);
    return p;
  });
}

/**
 * Rebuild one project's runtime from projects.json + a candidate override.
 * Throws (without side effects) if the result is invalid — callers persist the
 * override and swap the runtime in only after this succeeds.
 */
export function rebuildProject(id: string, override: ProjectOverride): ProjectRuntime {
  const raw = loadRawProjects().find((r) => r.id === id);
  if (!raw) throw new Error(`unknown project "${id}" in projects.json`);
  return buildRuntime(applyOverride(raw, override));
}
