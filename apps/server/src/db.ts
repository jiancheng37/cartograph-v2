import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export function openDatabase(path = process.env.CARTOGRAPH_DB ?? resolve(".cartograph/cartograph.db")) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS repositories (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL UNIQUE,
      added_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS views (
      id TEXT PRIMARY KEY, repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      title TEXT NOT NULL, description TEXT NOT NULL, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, archived_at TEXT,
      parent_view_id TEXT REFERENCES views(id) ON DELETE CASCADE, parent_node_id TEXT
    );
    CREATE TABLE IF NOT EXISTS view_nodes (
      id TEXT NOT NULL, view_id TEXT NOT NULL REFERENCES views(id) ON DELETE CASCADE,
      label TEXT NOT NULL, kind TEXT NOT NULL, summary TEXT NOT NULL, confidence TEXT NOT NULL,
      symbol_id TEXT, evidence_json TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL,
      PRIMARY KEY(view_id, id)
    );
    CREATE TABLE IF NOT EXISTS view_edges (
      id TEXT NOT NULL, view_id TEXT NOT NULL REFERENCES views(id) ON DELETE CASCADE,
      source TEXT NOT NULL, target TEXT NOT NULL, kind TEXT NOT NULL, label TEXT,
      summary TEXT, confidence TEXT NOT NULL, evidence_json TEXT NOT NULL,
      PRIMARY KEY(view_id, id)
    );
    CREATE TABLE IF NOT EXISTS traces (
      id TEXT PRIMARY KEY, view_id TEXT NOT NULL REFERENCES views(id) ON DELETE CASCADE,
      title TEXT NOT NULL, description TEXT NOT NULL, steps_json TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_traces_view ON traces(view_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS mcp_presence (
      id INTEGER PRIMARY KEY CHECK(id=1), connected INTEGER NOT NULL DEFAULT 0,
      connected_at TEXT, heartbeat_at TEXT, last_activity_at TEXT
    );
  `);
  ensureRepositoryAddedAtColumn(db);
  ensureViewArchiveColumn(db);
  ensureViewHierarchyColumns(db);
  ensureEdgeRouteColumn(db);
  migrateViewGraphKeys(db);
  removeLegacyIndexData(db);
  return db;
}

function removeLegacyIndexData(db: DatabaseSync) {
  const nodeColumns = db.prepare("PRAGMA table_info(view_nodes)").all() as unknown as TableColumn[];
  if (nodeColumns.some(column => column.name === "symbol_id")) db.exec("UPDATE view_nodes SET symbol_id=NULL WHERE symbol_id IS NOT NULL");
  db.exec("DROP TABLE IF EXISTS index_jobs; DROP TABLE IF EXISTS imports; DROP TABLE IF EXISTS symbols; DROP TABLE IF EXISTS files;");
}

function ensureEdgeRouteColumn(db: DatabaseSync) {
  const columns = db.prepare("PRAGMA table_info(view_edges)").all() as unknown as TableColumn[];
  if (!columns.some(column => column.name === "route_json")) db.exec("ALTER TABLE view_edges ADD COLUMN route_json TEXT");
}

function ensureViewHierarchyColumns(db: DatabaseSync) {
  const columns = db.prepare("PRAGMA table_info(views)").all() as unknown as TableColumn[];
  if (!columns.some(column => column.name === "parent_view_id")) db.exec("ALTER TABLE views ADD COLUMN parent_view_id TEXT REFERENCES views(id) ON DELETE CASCADE");
  if (!columns.some(column => column.name === "parent_node_id")) db.exec("ALTER TABLE views ADD COLUMN parent_node_id TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_views_parent_node ON views(parent_view_id,parent_node_id) WHERE parent_view_id IS NOT NULL AND archived_at IS NULL");
}

export type CartographDb = ReturnType<typeof openDatabase>;

type TableColumn = { name: string; pk: number };

function ensureRepositoryAddedAtColumn(db: DatabaseSync) {
  const columns = db.prepare("PRAGMA table_info(repositories)").all() as unknown as TableColumn[];
  if (!columns.some(column => column.name === "added_at")) db.exec("ALTER TABLE repositories ADD COLUMN added_at TEXT");
  if (columns.some(column => column.name === "indexed_at")) db.exec("UPDATE repositories SET added_at=indexed_at WHERE added_at IS NULL");
}

function ensureViewArchiveColumn(db: DatabaseSync) {
  const columns = db.prepare("PRAGMA table_info(views)").all() as unknown as TableColumn[];
  if (!columns.some(column => column.name === "archived_at")) db.exec("ALTER TABLE views ADD COLUMN archived_at TEXT");
}

function migrateViewGraphKeys(db: DatabaseSync) {
  const primaryKey = (table: "view_nodes" | "view_edges") =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as unknown as TableColumn[])
      .filter(column => column.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map(column => column.name)
      .join(",");

  if (primaryKey("view_nodes") === "view_id,id" && primaryKey("view_edges") === "view_id,id") return;

  db.exec(`
    BEGIN IMMEDIATE;
    ALTER TABLE view_nodes RENAME TO view_nodes_legacy;
    ALTER TABLE view_edges RENAME TO view_edges_legacy;
    CREATE TABLE view_nodes (
      id TEXT NOT NULL, view_id TEXT NOT NULL REFERENCES views(id) ON DELETE CASCADE,
      label TEXT NOT NULL, kind TEXT NOT NULL, summary TEXT NOT NULL, confidence TEXT NOT NULL,
      symbol_id TEXT, evidence_json TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL,
      PRIMARY KEY(view_id, id)
    );
    CREATE TABLE view_edges (
      id TEXT NOT NULL, view_id TEXT NOT NULL REFERENCES views(id) ON DELETE CASCADE,
      source TEXT NOT NULL, target TEXT NOT NULL, kind TEXT NOT NULL, label TEXT,
      summary TEXT, confidence TEXT NOT NULL, evidence_json TEXT NOT NULL,
      route_json TEXT, PRIMARY KEY(view_id, id)
    );
    INSERT INTO view_nodes SELECT * FROM view_nodes_legacy;
    INSERT INTO view_edges(id,view_id,source,target,kind,label,summary,confidence,evidence_json,route_json)
      SELECT id,view_id,source,target,kind,label,summary,confidence,evidence_json,route_json FROM view_edges_legacy;
    DROP TABLE view_nodes_legacy;
    DROP TABLE view_edges_legacy;
    COMMIT;
  `);
}
