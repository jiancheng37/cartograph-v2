import { z } from "zod";

export const NodeKind = z.enum(["system", "service", "module", "route", "function", "class", "database", "external", "queue", "concept"]);
export const EdgeKind = z.enum(["calls", "imports", "reads", "writes", "publishes", "consumes", "contains", "depends_on", "transforms", "returns"]);
export const Confidence = z.enum(["source_cited", "inferred", "user_confirmed"]);

export const EvidenceSchema = z.object({
  path: z.string().min(1),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
});

export const ViewNodeInputSchema = z.object({
  id: z.string().min(1).optional(),
  label: z.string().min(1).max(120),
  kind: NodeKind,
  summary: z.string().max(600),
  confidence: Confidence.default("inferred"),
  evidence: z.array(EvidenceSchema).default([]),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
});

export const ViewEdgeInputSchema = z.object({
  id: z.string().min(1).optional(),
  source: z.string().min(1),
  target: z.string().min(1),
  kind: EdgeKind,
  label: z.string().max(120).optional(),
  summary: z.string().max(600).optional(),
  confidence: Confidence.default("inferred"),
  evidence: z.array(EvidenceSchema).default([]),
});

export const EdgeRouteSchema = z.object({
  points: z.array(z.object({ x: z.number(), y: z.number() })).min(2).max(40),
  label: z.object({ x: z.number(), y: z.number() }).optional(),
});

export const CreateViewSchema = z.object({
  title: z.string().min(2).max(120),
  description: z.string().max(600).default(""),
  repositoryId: z.string().min(1),
  parentViewId: z.string().min(1).optional(),
  parentNodeId: z.string().min(1).optional(),
  nodes: z.array(ViewNodeInputSchema).max(80).default([]),
  edges: z.array(ViewEdgeInputSchema).max(160).default([]),
}).refine(input => Boolean(input.parentViewId) === Boolean(input.parentNodeId), { message: "parentViewId and parentNodeId must be provided together" });

export const PatchViewSchema = z.object({
  title: z.string().min(2).max(120).optional(),
  description: z.string().max(600).optional(),
  nodes: z.array(ViewNodeInputSchema).max(80).optional(),
  edges: z.array(ViewEdgeInputSchema).max(160).optional(),
});

export const UpdateViewSchema = z.object({
  title: z.string().min(2).max(120).optional(),
  description: z.string().max(600).optional(),
  expectedRevision: z.number().int().positive().optional(),
});

export const ViewPositionsSchema = z.object({
  expectedRevision: z.number().int().positive().optional(),
  positions: z.array(z.object({ id: z.string().min(1), x: z.number(), y: z.number() })).min(1).max(80),
  routes: z.array(z.object({ id: z.string().min(1), route: EdgeRouteSchema })).max(160).optional(),
  clearRoutes: z.boolean().optional(),
});

export const TraceBoundarySchema = z.object({
  nodeId: z.string().min(1).optional(),
  endpoint: z.string().min(1).max(160),
  kind: z.enum(["function", "route", "queue", "database", "event", "service", "external", "file", "unknown"]),
  via: z.enum(["function_call", "http", "queue_message", "database_read", "database_write", "event", "return", "transform", "file_read", "file_write", "unknown"]),
  data: z.string().min(1).max(300),
  evidence: z.array(EvidenceSchema).max(8).default([]),
});

export const TraceStepSchema = z.object({
  id: z.string().min(1).optional(),
  nodeId: z.string().min(1),
  edgeId: z.string().min(1).optional(),
  label: z.string().min(1).max(120),
  action: z.string().min(1).max(600),
  input: z.string().max(1200).default(""),
  output: z.string().max(1200).default(""),
  receives: TraceBoundarySchema.optional(),
  produces: TraceBoundarySchema.optional(),
  payload: z.object({
    format: z.enum(["json", "event", "record"]),
    before: z.json(),
    after: z.json(),
    fields: z.array(z.object({
      path: z.string().min(1).max(200),
      operation: z.enum(["added", "modified", "read", "removed", "persisted", "redacted"]),
      explanation: z.string().min(1).max(500),
      before: z.json().optional(),
      after: z.json().optional(),
      evidence: z.array(EvidenceSchema).max(8).default([]),
    })).max(40).default([]),
  }).optional(),
  evidence: z.array(EvidenceSchema).max(12).default([]),
});

export const CreateTraceSchema = z.object({
  viewId: z.string().min(1),
  title: z.string().min(2).max(120),
  description: z.string().max(600).default(""),
  steps: z.array(TraceStepSchema).min(2).max(24),
});

export type Evidence = z.infer<typeof EvidenceSchema>;
export type ViewNodeInput = z.infer<typeof ViewNodeInputSchema>;
export type ViewEdgeInput = z.infer<typeof ViewEdgeInputSchema>;
export type CreateViewInput = z.infer<typeof CreateViewSchema>;
export type CreateTraceInput = z.infer<typeof CreateTraceSchema>;
export type TraceStepInput = z.infer<typeof TraceStepSchema>;

export interface Repository { id: string; name: string; rootPath?: string; externalId?: string; addedAt: string; }
export interface McpToken { id: string; name: string; prefix: string; createdAt: string; lastUsedAt?: string; }
export interface McpConnectionStatus { connected: boolean; state: "connected" | "waiting"; connectedAt?: string; lastSeenAt?: string; lastActivityAt?: string; }
export interface AppSetup { projectRoot: string; mcpUrl: string; hosted: boolean; }
export interface KnowledgeSearchResult { id: string; type: "view" | "node"; label: string; detail: string; viewId?: string; nodeId?: string; }
export interface ViewNode extends ViewNodeInput { id: string; position: { x: number; y: number }; childViewId?: string; }
export interface ViewEdge extends ViewEdgeInput { id: string; route?: z.infer<typeof EdgeRouteSchema>; }
export interface ViewAncestor { viewId: string; title: string; nodeId: string; nodeLabel: string; }
export interface KnowledgeView { id: string; title: string; description: string; repositoryId: string; parentViewId?: string; parentNodeId?: string; ancestors: ViewAncestor[]; createdAt: string; updatedAt: string; revision: number; archivedAt?: string; nodes: ViewNode[]; edges: ViewEdge[]; }
export interface TraceStep extends TraceStepInput { id: string; }
export interface KnowledgeTrace { id: string; viewId: string; title: string; description: string; createdAt: string; updatedAt: string; steps: TraceStep[]; }
