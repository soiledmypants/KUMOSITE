// ssrf hygiene for outbound fetches to other agents
import { lookup } from "node:dns/promises";
import net from "node:net";

function isPrivateIp(ip: string): boolean {
  if (net.isIPv6(ip)) {
    return ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    a === 0
  );
}

export async function assertSafeUrl(raw: string, allowLocalhost = false): Promise<URL> {
  const url = new URL(raw);
  const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname);
  if (isLocal) {
    if (!allowLocalhost) throw new Error("localhost urls not allowed");
    return url;
  }
  if (url.protocol !== "https:") throw new Error("only https urls allowed");
  const { address } = await lookup(url.hostname);
  if (isPrivateIp(address)) throw new Error("private-network urls not allowed");
  return url;
}

export async function safeFetchJson(raw: string, init?: RequestInit, allowLocalhost = false): Promise<unknown> {
  await assertSafeUrl(raw, allowLocalhost);
  const res = await fetch(raw, {
    ...init,
    signal: AbortSignal.timeout(5000),
    redirect: "error",
  });
  if (!res.ok) throw new Error(`fetch ${raw} -> ${res.status}`);
  const text = await res.text();
  if (text.length > 256_000) throw new Error("response too large");
  return JSON.parse(text);
}
