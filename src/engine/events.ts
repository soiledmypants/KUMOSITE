import { EventEmitter } from "node:events";

/**
 * Tiny in-process event bus. Everything the engine does (journal appends,
 * scan progress, per-tx airdrop progress, round lifecycle) flows through here;
 * server/ws.ts subscribes once and broadcasts every event to panel clients.
 */
export interface OpsEvent {
  type: string;
  ts: string;
  projectId?: string;
  data: unknown;
}

const bus = new EventEmitter();
bus.setMaxListeners(50);

export function emitEvent(type: string, data: unknown, projectId?: string): void {
  const event: OpsEvent = { type, ts: new Date().toISOString(), projectId, data };
  bus.emit("event", event);
}

export function onEvent(listener: (event: OpsEvent) => void): () => void {
  bus.on("event", listener);
  return () => bus.off("event", listener);
}
