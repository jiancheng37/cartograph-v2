import { nanoid } from "nanoid";
import type { CartographDb } from "./db.js";
import { childViewType, viewNodeKindErrors, type CreateTraceInput, type CreateViewInput, type Evidence, type KnowledgeSearchResult, type KnowledgeTrace, type KnowledgeView, type McpToken, type Repository, type TraceStep, type ViewEdgeInput, type ViewNodeInput } from "@cartograph/shared";
import { validateTrace } from "./trace-validation.js";

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const parse = <T>(value: unknown): T => JSON.parse(String(value)) as T;

export class Store {
  constructor(private db: CartographDb) {}
  get database() { return this.db; }

  repositories(ownerId?: string): Repository[] {
    const rows = ownerId ? this.db.prepare("SELECT * FROM repositories WHERE owner_id=? ORDER BY added_at DESC").all(ownerId) : this.db.prepare("SELECT * FROM repositories ORDER BY added_at DESC").all();
    return (rows as Row[]).map(repositoryFromRow);
  }

  repository(id: string, ownerId?: string): Repository | null {
    const row = (ownerId ? this.db.prepare("SELECT * FROM repositories WHERE id=? AND owner_id=?").get(id, ownerId) : this.db.prepare("SELECT * FROM repositories WHERE id=?").get(id)) as Row | undefined;
    return row ? repositoryFromRow(row) : null;
  }

  deleteRepository(id: string, ownerId?: string): boolean {
    return (ownerId ? this.db.prepare("DELETE FROM repositories WHERE id=? AND owner_id=?").run(id, ownerId) : this.db.prepare("DELETE FROM repositories WHERE id=?").run(id)).changes > 0;
  }

  upsertRepository(input: Repository, ownerId = "local-user") {
    const legacy = (this.db.prepare("PRAGMA table_info(repositories)").all() as unknown as { name: string }[]).some(column => column.name === "indexed_at");
    if (legacy) this.db.prepare(`INSERT INTO repositories(id,name,root_path,added_at,owner_id,indexed_at,file_count,symbol_count) VALUES(?,?,?,?,?,?,0,0)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,root_path=excluded.root_path`).run(input.id, input.name, input.rootPath ?? "", input.addedAt, ownerId, input.addedAt);
    else this.db.prepare(`INSERT INTO repositories(id,name,root_path,added_at,owner_id) VALUES(?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,root_path=excluded.root_path`).run(input.id, input.name, input.rootPath ?? "", input.addedAt, ownerId);
  }

  mcpTokens(ownerId: string): McpToken[] { return (this.db.prepare("SELECT * FROM mcp_tokens WHERE owner_id=? ORDER BY created_at DESC").all(ownerId) as Row[]).map(tokenFromRow); }
  createMcpToken(ownerId: string, input: { id: string; name: string; prefix: string; tokenHash: string }): McpToken { const timestamp = now(); this.db.prepare("INSERT INTO mcp_tokens(id,owner_id,name,prefix,token_hash,created_at) VALUES(?,?,?,?,?,?)").run(input.id, ownerId, input.name, input.prefix, input.tokenHash, timestamp); return this.mcpTokens(ownerId).find(token => token.id === input.id)!; }
  deleteMcpToken(ownerId: string, id: string): boolean { return this.db.prepare("DELETE FROM mcp_tokens WHERE id=? AND owner_id=?").run(id, ownerId).changes > 0; }
  resolveMcpToken(tokenHash: string): { userId: string; tokenId: string } | undefined { const row = this.db.prepare("SELECT id,owner_id FROM mcp_tokens WHERE token_hash=?").get(tokenHash) as Row | undefined; if (!row) return undefined; this.db.prepare("UPDATE mcp_tokens SET last_used_at=? WHERE id=?").run(now(), String(row.id)); return { userId: String(row.owner_id), tokenId: String(row.id) }; }

  views(repositoryId?: string, includeArchived = false): KnowledgeView[] {
    const rows = (repositoryId
      ? this.db.prepare(`SELECT id FROM views WHERE repository_id=? ${includeArchived ? "" : "AND archived_at IS NULL"} ORDER BY updated_at DESC`).all(repositoryId)
      : this.db.prepare(`SELECT id FROM views ${includeArchived ? "" : "WHERE archived_at IS NULL"} ORDER BY updated_at DESC`).all()) as Row[];
    return rows.map(row => this.view(String(row.id))).filter((view): view is KnowledgeView => Boolean(view));
  }

  searchKnowledge(repositoryId: string, query: string, limit = 40): KnowledgeSearchResult[] {
    const normalized = query.trim().toLowerCase(); if (!normalized) return [];
    const results: KnowledgeSearchResult[] = [];
    for (const view of this.views(repositoryId)) {
      if (`${view.title} ${view.description}`.toLowerCase().includes(normalized)) results.push({ id: `view:${view.id}`, type: "view", label: view.title, detail: view.description || `${view.nodes.length} entities`, viewId: view.id });
      for (const node of view.nodes) if (`${node.label} ${node.summary} ${node.kind}`.toLowerCase().includes(normalized)) results.push({ id: `node:${view.id}:${node.id}`, type: "node", label: node.label, detail: `${view.title} · ${node.kind}`, viewId: view.id, nodeId: node.id });
    }
    return results.slice(0, Math.min(limit, 100));
  }

  view(id: string): KnowledgeView | null {
    const row = this.db.prepare("SELECT * FROM views WHERE id=?").get(id) as Row | undefined;
    if (!row) return null;
    const nodes = this.db.prepare("SELECT * FROM view_nodes WHERE view_id=?").all(id) as Row[];
    const edges = this.db.prepare("SELECT * FROM view_edges WHERE view_id=?").all(id) as Row[];
    const children = this.db.prepare("SELECT id,parent_node_id FROM views WHERE parent_view_id=? AND archived_at IS NULL").all(id) as Row[];
    const childByNode = new Map(children.map(child => [String(child.parent_node_id), String(child.id)]));
    return {
      id: String(row.id), repositoryId: String(row.repository_id), title: String(row.title), description: String(row.description), viewType: String(row.view_type ?? "custom") as KnowledgeView["viewType"], scope: String(row.scope ?? ""),
      parentViewId: row.parent_view_id ? String(row.parent_view_id) : undefined, parentNodeId: row.parent_node_id ? String(row.parent_node_id) : undefined,
      ancestors: this.viewAncestors(id),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at), revision: Number(row.revision), archivedAt: row.archived_at ? String(row.archived_at) : undefined,
      nodes: nodes.map(n => ({ id: String(n.id), label: String(n.label), kind: String(n.kind) as never, summary: String(n.summary), confidence: normalizeConfidence(String(n.confidence)), evidence: parse<Evidence[]>(n.evidence_json), position: { x: Number(n.x), y: Number(n.y) }, childViewId: childByNode.get(String(n.id)) })),
      edges: edges.map(e => ({ id: String(e.id), source: String(e.source), target: String(e.target), kind: String(e.kind) as never, label: e.label ? String(e.label) : undefined, summary: e.summary ? String(e.summary) : undefined, confidence: normalizeConfidence(String(e.confidence)), evidence: parse<Evidence[]>(e.evidence_json), route: e.route_json ? parse(String(e.route_json)) : undefined }))
    };
  }

  createView(input: CreateViewInput): KnowledgeView {
    const id = nanoid(12); const timestamp = now();
    if (input.parentViewId) {
      const parent = this.view(input.parentViewId); if (!parent) throw new Error("Parent view not found");
      if (parent.repositoryId !== input.repositoryId) throw new Error("Child view must belong to the same repository");
      if (!parent.nodes.some(node => node.id === input.parentNodeId)) throw new Error("Parent node not found");
    }
    this.db.prepare("INSERT INTO views(id,repository_id,title,description,created_at,updated_at,revision,archived_at,parent_view_id,parent_node_id,view_type,scope) VALUES(?,?,?,?,?,?,?,NULL,?,?,?,?)").run(id, input.repositoryId, input.title, input.description, timestamp, timestamp, 1, input.parentViewId ?? null, input.parentNodeId ?? null, input.viewType, input.scope);
    this.addGraph(id, input.nodes, input.edges);
    return this.view(id)!;
  }

  extendView(id: string, nodes: ViewNodeInput[], edges: ViewEdgeInput[], expectedRevision?: number): KnowledgeView {
    const current = this.view(id); if (!current) throw new Error("View not found");
    if (expectedRevision && current.revision !== expectedRevision) throw new Error(`Revision conflict: expected ${expectedRevision}, found ${current.revision}`);
    const semanticErrors = viewNodeKindErrors(current.viewType, nodes); if (semanticErrors.length) throw new Error(semanticErrors.join("\n"));
    this.addGraph(id, nodes, edges);
    this.db.prepare("UPDATE views SET updated_at=?,revision=revision+1 WHERE id=?").run(now(), id);
    return this.view(id)!;
  }

  updateView(id: string, input: { title?: string; description?: string; expectedRevision?: number }): KnowledgeView {
    const current = this.view(id); if (!current) throw new Error("View not found");
    this.assertRevision(current, input.expectedRevision);
    this.db.prepare("UPDATE views SET title=?,description=?,updated_at=?,revision=revision+1 WHERE id=?").run(input.title ?? current.title, input.description ?? current.description, now(), id);
    return this.view(id)!;
  }

  updateNodePositions(id: string, positions: { id: string; x: number; y: number }[], expectedRevision?: number, routes?: { id: string; route: unknown }[], clearRoutes = false): KnowledgeView {
    const current = this.view(id); if (!current) throw new Error("View not found");
    this.assertRevision(current, expectedRevision);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const statement = this.db.prepare("UPDATE view_nodes SET x=?,y=? WHERE view_id=? AND id=?");
      for (const position of positions) statement.run(position.x, position.y, id, position.id);
      if (clearRoutes) this.db.prepare("UPDATE view_edges SET route_json=NULL WHERE view_id=?").run(id);
      if (routes) { const routeStatement = this.db.prepare("UPDATE view_edges SET route_json=? WHERE view_id=? AND id=?"); for (const item of routes) routeStatement.run(JSON.stringify(item.route), id, item.id); }
      this.db.prepare("UPDATE views SET updated_at=?,revision=revision+1 WHERE id=?").run(now(), id);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.view(id)!;
  }

  duplicateView(id: string): KnowledgeView {
    const current = this.view(id); if (!current) throw new Error("View not found");
    return this.createView({ repositoryId: current.repositoryId, title: `${current.title} copy`, description: current.description, viewType: current.viewType, scope: current.scope, nodes: current.nodes, edges: current.edges });
  }

  createNodeDrilldown(viewId: string, nodeId: string): KnowledgeView {
    const parent = this.view(viewId); if (!parent) throw new Error("View not found");
    const node = parent.nodes.find(item => item.id === nodeId); if (!node) throw new Error("Node not found");
    if (node.childViewId) return this.view(node.childViewId)!;
    return this.createView({ repositoryId: parent.repositoryId, parentViewId: viewId, parentNodeId: nodeId, title: node.label, description: `Inside ${node.label}`, viewType: childViewType(parent.viewType, node.kind), scope: node.label, nodes: [], edges: [] });
  }

  traces(viewId: string): KnowledgeTrace[] {
    return (this.db.prepare("SELECT * FROM traces WHERE view_id=? ORDER BY updated_at DESC").all(viewId) as Row[]).map(traceFromRow);
  }

  trace(id: string): KnowledgeTrace | null {
    const row = this.db.prepare("SELECT * FROM traces WHERE id=?").get(id) as Row | undefined;
    return row ? traceFromRow(row) : null;
  }

  createTrace(input: CreateTraceInput): KnowledgeTrace {
    const view = this.view(input.viewId); if (!view) throw new Error("View not found");
    validateTrace(view, input);
    const id = nanoid(12); const timestamp = now();
    const steps: TraceStep[] = input.steps.map((step, index) => ({
      ...step,
      id: step.id ?? `step-${index + 1}`,
      payload: step.payload ? { ...step.payload, before: redactSecrets(step.payload.before), after: redactSecrets(step.payload.after), fields: step.payload.fields.map(field => ({ ...field, before: redactSecrets(field.before), after: redactSecrets(field.after) })) } : undefined,
    }));
    this.db.prepare("INSERT INTO traces(id,view_id,title,description,steps_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
      .run(id, input.viewId, input.title, input.description, JSON.stringify(steps), timestamp, timestamp);
    return this.trace(id)!;
  }

  deleteTrace(id: string): boolean { return this.db.prepare("DELETE FROM traces WHERE id=?").run(id).changes > 0; }

  private viewAncestors(id: string): KnowledgeView["ancestors"] {
    const chain: KnowledgeView["ancestors"] = []; let currentId = id; const seen = new Set<string>();
    while (!seen.has(currentId)) {
      seen.add(currentId);
      const current = this.db.prepare("SELECT parent_view_id,parent_node_id FROM views WHERE id=?").get(currentId) as Row | undefined;
      if (!current?.parent_view_id || !current.parent_node_id) break;
      const parent = this.db.prepare("SELECT title FROM views WHERE id=?").get(String(current.parent_view_id)) as Row | undefined;
      const node = this.db.prepare("SELECT label FROM view_nodes WHERE view_id=? AND id=?").get(String(current.parent_view_id), String(current.parent_node_id)) as Row | undefined;
      if (!parent || !node) break;
      chain.unshift({ viewId: String(current.parent_view_id), title: String(parent.title), nodeId: String(current.parent_node_id), nodeLabel: String(node.label) });
      currentId = String(current.parent_view_id);
    }
    return chain;
  }

  archiveView(id: string, expectedRevision?: number): KnowledgeView {
    const current = this.view(id); if (!current) throw new Error("View not found");
    this.assertRevision(current, expectedRevision);
    this.db.prepare("UPDATE views SET archived_at=?,updated_at=?,revision=revision+1 WHERE id=?").run(now(), now(), id);
    return this.view(id)!;
  }

  deleteView(id: string): boolean { return this.db.prepare("DELETE FROM views WHERE id=?").run(id).changes > 0; }

  private assertRevision(view: KnowledgeView, expectedRevision?: number) {
    if (expectedRevision && view.revision !== expectedRevision) throw new Error(`Revision conflict: expected ${expectedRevision}, found ${view.revision}`);
  }

  private addGraph(viewId: string, nodes: ViewNodeInput[], edges: ViewEdgeInput[]) {
    const nodeStmt = this.db.prepare(`INSERT INTO view_nodes(id,view_id,label,kind,summary,confidence,symbol_id,evidence_json,x,y)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(view_id,id) DO UPDATE SET label=excluded.label,kind=excluded.kind,
      summary=excluded.summary,confidence=excluded.confidence,symbol_id=NULL,
      evidence_json=excluded.evidence_json,x=excluded.x,y=excluded.y`);
    nodes.forEach((node, index) => {
      const id = node.id ?? nanoid(10); const p = node.position ?? { x: 120 + (index % 3) * 280, y: 100 + Math.floor(index / 3) * 180 };
      nodeStmt.run(id, viewId, node.label, node.kind, node.summary, node.confidence, null, JSON.stringify(node.evidence), p.x, p.y);
    });
    const edgeStmt = this.db.prepare(`INSERT INTO view_edges(id,view_id,source,target,kind,label,summary,confidence,evidence_json)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(view_id,id) DO UPDATE SET source=excluded.source,target=excluded.target,
      kind=excluded.kind,label=excluded.label,summary=excluded.summary,confidence=excluded.confidence,
      evidence_json=excluded.evidence_json`);
    edges.forEach(edge => edgeStmt.run(edge.id ?? nanoid(10), viewId, edge.source, edge.target, edge.kind, edge.label ?? null, edge.summary ?? null, edge.confidence, JSON.stringify(edge.evidence)));
  }
}

function repositoryFromRow(row: Row): Repository {
  return { id: String(row.id), name: String(row.name), rootPath: String(row.root_path), addedAt: String(row.added_at ?? row.indexed_at) };
}

function normalizeConfidence(value: string): KnowledgeView["nodes"][number]["confidence"] { return value === "verified" ? "source_cited" : value as KnowledgeView["nodes"][number]["confidence"]; }

function traceFromRow(row: Row): KnowledgeTrace {
  return { id: String(row.id), viewId: String(row.view_id), title: String(row.title), description: String(row.description), createdAt: String(row.created_at), updatedAt: String(row.updated_at), steps: parse<TraceStep[]>(row.steps_json) };
}
function tokenFromRow(row: Row): McpToken { return { id: String(row.id), name: String(row.name), prefix: String(row.prefix), createdAt: String(row.created_at), lastUsedAt: row.last_used_at ? String(row.last_used_at) : undefined }; }

const secretField = /(^|[_-])(password|passwd|secret|token|api[_-]?key|authorization|cookie|private[_-]?key)($|[_-])/i;
function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactSecrets) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, secretField.test(key) ? "[REDACTED]" : redactSecrets(item)])) as T;
  return value;
}
