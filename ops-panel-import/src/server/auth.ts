import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { NextFunction, Request, Response } from "express";
import { CONFIG } from "../config.js";

/**
 * Password → session-cookie auth for the panel.
 * - ADMIN_PASSWORD compared via sha256 + timingSafeEqual (no length leak).
 * - Sessions are random 32-byte tokens in an in-memory Map with TTL; a
 *   restart logs everyone out (fine for an admin panel).
 * - Login is rate-limited per IP: 5 failures → 15-minute lockout.
 */

const SESSION_COOKIE = "ops_session";
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const sessions = new Map<string, number>(); // token -> expiresAt (ms)
const failures = new Map<string, { count: number; lockedUntil: number }>();

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function passwordMatches(candidate: string): boolean {
  return timingSafeEqual(sha256(candidate), sha256(CONFIG.adminPassword));
}

function sweepSessions(): void {
  const now = Date.now();
  for (const [token, expiresAt] of sessions) {
    if (expiresAt < now) sessions.delete(token);
  }
}

/** Minimal cookie-header parser (we only ever read our one cookie). */
function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

function sessionFromHeaders(req: IncomingMessage): string | null {
  const token = readCookie(req.headers.cookie, SESSION_COOKIE);
  if (!token) return null;
  sweepSessions();
  return sessions.has(token) ? token : null;
}

/** Auth check that works for both express requests and raw ws upgrade requests. */
export function isAuthedRequest(req: IncomingMessage): boolean {
  return sessionFromHeaders(req) !== null;
}

export function handleLogin(req: Request, res: Response): void {
  const ip = req.ip ?? "unknown";
  const now = Date.now();
  const fail = failures.get(ip);
  if (fail && fail.lockedUntil > now) {
    res.status(429).json({
      error: `too many failed attempts — locked out for ${Math.ceil((fail.lockedUntil - now) / 60000)} more min`,
    });
    return;
  }

  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!password || !passwordMatches(password)) {
    const next = { count: (fail?.count ?? 0) + 1, lockedUntil: 0 };
    if (next.count >= MAX_FAILURES) {
      next.lockedUntil = now + LOCKOUT_MS;
      next.count = 0;
    }
    failures.set(ip, next);
    res.status(401).json({ error: "wrong password" });
    return;
  }

  failures.delete(ip);
  const token = randomBytes(32).toString("hex");
  sessions.set(token, now + CONFIG.sessionTtlHours * 3600_000);

  const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax` +
      `; Max-Age=${CONFIG.sessionTtlHours * 3600}${secure ? "; Secure" : ""}`,
  );
  res.json({ ok: true });
}

export function handleLogout(req: Request, res: Response): void {
  const token = sessionFromHeaders(req);
  if (token) sessions.delete(token);
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
  res.json({ ok: true });
}

/** Express middleware guarding everything under /api except /api/login. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isAuthedRequest(req)) {
    next();
    return;
  }
  res.status(401).json({ error: "unauthorized" });
}
