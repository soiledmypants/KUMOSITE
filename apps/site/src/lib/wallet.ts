// minimal evm wallet plumbing: EIP-6963 discovery with window.ethereum
// fallback, connect, personal_sign. no wallet kit, no extra deps — kumo only
// needs an address and one signature.

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

interface Eip6963Detail {
  info: { uuid: string; name: string; rdns: string };
  provider: Eip1193Provider;
}

const discovered: Eip6963Detail[] = [];
let listening = false;

/** start EIP-6963 discovery (idempotent; call from an effect) */
export function initWalletDiscovery(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("eip6963:announceProvider", (ev) => {
    const detail = (ev as CustomEvent<Eip6963Detail>).detail;
    if (detail?.provider && !discovered.some((d) => d.info.uuid === detail.info.uuid)) {
      discovered.push(detail);
    }
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

export function walletAvailable(): boolean {
  return discovered.length > 0 || Boolean((window as { ethereum?: Eip1193Provider }).ethereum);
}

function pickProvider(): Eip1193Provider {
  const injected = (window as { ethereum?: Eip1193Provider }).ethereum;
  const provider = discovered[0]?.provider ?? injected;
  if (!provider) throw new Error("no evm wallet found — install one (rabby, metamask, ...) and reload");
  return provider;
}

export async function connectWallet(): Promise<{ address: string; provider: Eip1193Provider }> {
  const provider = pickProvider();
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const address = accounts?.[0];
  if (!address) throw new Error("wallet returned no account");
  return { address: address.toLowerCase(), provider };
}

/** personal_sign of a utf-8 message (hex-encoded per spec) */
export async function personalSign(provider: Eip1193Provider, address: string, message: string): Promise<string> {
  const hex = "0x" + Array.from(new TextEncoder().encode(message), (b) => b.toString(16).padStart(2, "0")).join("");
  return (await provider.request({ method: "personal_sign", params: [hex, address] })) as string;
}
