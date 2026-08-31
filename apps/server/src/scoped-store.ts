import type { CreateTraceInput, CreateViewInput, KnowledgeTrace, KnowledgeView, ViewEdgeInput, ViewNodeInput } from "@cartograph/shared";
import { registerRepository } from "./repository.js";
import type { Store } from "./store.js";

export class ScopedStore {
  constructor(readonly base: Store, readonly userId: string) {}
  repositories() { return this.base.repositories(this.userId); }
  repository(id: string) { return this.base.repository(id, this.userId); }
  registerRepository(path: string) { return registerRepository(this.base, path, this.userId); }
  deleteRepository(id: string) { return this.base.deleteRepository(id, this.userId); }
  views(repositoryId?: string, includeArchived = false) { if (repositoryId) this.requireRepository(repositoryId); return this.base.views(repositoryId, includeArchived).filter(view => Boolean(this.repository(view.repositoryId))); }
  searchKnowledge(repositoryId: string, query: string, limit = 40) { this.requireRepository(repositoryId); return this.base.searchKnowledge(repositoryId, query, limit); }
  view(id: string): KnowledgeView | null { const view = this.base.view(id); return view && this.repository(view.repositoryId) ? view : null; }
  createView(input: CreateViewInput) { this.requireRepository(input.repositoryId); return this.base.createView(input); }
  extendView(id: string, nodes: ViewNodeInput[], edges: ViewEdgeInput[], expectedRevision?: number) { this.requireView(id); return this.base.extendView(id, nodes, edges, expectedRevision); }
  updateView(id: string, input: { title?: string; description?: string; expectedRevision?: number }) { this.requireView(id); return this.base.updateView(id, input); }
  updateNodePositions(id: string, positions: { id: string; x: number; y: number }[], expectedRevision?: number, routes?: { id: string; route: unknown }[], clearRoutes = false) { this.requireView(id); return this.base.updateNodePositions(id, positions, expectedRevision, routes, clearRoutes); }
  duplicateView(id: string) { this.requireView(id); return this.base.duplicateView(id); }
  createNodeDrilldown(viewId: string, nodeId: string) { this.requireView(viewId); return this.base.createNodeDrilldown(viewId, nodeId); }
  traces(viewId: string): KnowledgeTrace[] { this.requireView(viewId); return this.base.traces(viewId); }
  trace(id: string) { const trace = this.base.trace(id); return trace && this.view(trace.viewId) ? trace : null; }
  createTrace(input: CreateTraceInput) { this.requireView(input.viewId); return this.base.createTrace(input); }
  deleteTrace(id: string) { if (!this.trace(id)) return false; return this.base.deleteTrace(id); }
  archiveView(id: string, expectedRevision?: number) { this.requireView(id); return this.base.archiveView(id, expectedRevision); }
  deleteView(id: string) { if (!this.view(id)) return false; return this.base.deleteView(id); }
  mcpTokens() { return this.base.mcpTokens(this.userId); }
  createMcpToken(input: { id: string; name: string; prefix: string; tokenHash: string }) { return this.base.createMcpToken(this.userId, input); }
  deleteMcpToken(id: string) { return this.base.deleteMcpToken(this.userId, id); }
  private requireRepository(id: string) { const repository = this.repository(id); if (!repository) throw new Error("Repository not found"); return repository; }
  private requireView(id: string) { const view = this.view(id); if (!view) throw new Error("View not found"); return view; }
}
