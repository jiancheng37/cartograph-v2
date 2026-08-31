import type { McpConnectionStatus } from "@cartograph/shared";
import type { CartographDb } from "./db.js";

const now = () => new Date().toISOString();

export function connectMcp(db: CartographDb) {
  const timestamp = now();
  db.prepare(`INSERT INTO mcp_presence(id,connected,connected_at,heartbeat_at,last_activity_at) VALUES(1,1,?,?,?)
    ON CONFLICT(id) DO UPDATE SET connected=1,connected_at=excluded.connected_at,heartbeat_at=excluded.heartbeat_at,last_activity_at=excluded.last_activity_at`)
    .run(timestamp, timestamp, timestamp);
}

export function heartbeatMcp(db: CartographDb) { db.prepare("UPDATE mcp_presence SET heartbeat_at=? WHERE id=1 AND connected=1").run(now()); }
export function touchMcp(db: CartographDb) { const timestamp = now(); db.prepare("UPDATE mcp_presence SET heartbeat_at=?,last_activity_at=? WHERE id=1").run(timestamp, timestamp); }
export function disconnectMcp(db: CartographDb) { db.prepare("UPDATE mcp_presence SET connected=0,heartbeat_at=? WHERE id=1").run(now()); }

export function mcpStatus(db: CartographDb): McpConnectionStatus {
  const row = db.prepare("SELECT * FROM mcp_presence WHERE id=1").get() as Record<string, unknown> | undefined;
  if (!row) return { connected: false, state: "waiting" };
  const lastSeenAt = row.heartbeat_at ? String(row.heartbeat_at) : undefined;
  const recent = lastSeenAt ? Date.now() - new Date(lastSeenAt).getTime() < 15_000 : false;
  const connected = Boolean(row.connected) && recent;
  return { connected, state: connected ? "connected" : "waiting", connectedAt: row.connected_at ? String(row.connected_at) : undefined, lastSeenAt, lastActivityAt: row.last_activity_at ? String(row.last_activity_at) : undefined };
}
