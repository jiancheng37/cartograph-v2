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

type TracePayload = NonNullable<TraceStepInput["payload"]>;
type TracePayloadField = TracePayload["fields"][number];

export function payloadFieldConsistencyError(payload: TracePayload, field: TracePayloadField): string | undefined {
  const before = resolveJsonPath(payload.before, field.path);
  const after = resolveJsonPath(payload.after, field.path);
  const mismatch = (side: "before" | "after", actual: { exists: boolean; value?: unknown }) => {
    const declared = field[side];
    return declared !== undefined && (!actual.exists || !jsonEqual(declared, actual.value))
      ? `${side} value does not match payload.${side}`
      : undefined;
  };

  if (field.operation === "added" && (before.exists || !after.exists)) return "marked added, but the path must be absent before and present after";
  if (field.operation === "removed" && (!before.exists || after.exists)) return "marked removed, but the path must be present before and absent after";
  if (field.operation === "modified" && (!before.exists || !after.exists || jsonEqual(before.value, after.value))) return "marked modified, but the path must exist on both sides with different values";
  if (field.operation === "read" && !before.exists) return "marked read, but the path does not exist in payload.before";
  if (field.operation === "persisted" && !after.exists) return "marked persisted, but the path does not exist in payload.after";
  if (field.operation === "redacted" && !((before.exists && before.value === "[REDACTED]") || (after.exists && after.value === "[REDACTED]"))) return "marked redacted, but neither side contains [REDACTED] at that path";
  return mismatch("before", before) ?? mismatch("after", after);
}

export function tracePayloadConsistencyErrors(steps: TraceStepInput[]): string[] {
  return steps.flatMap((step, stepIndex) => step.payload?.fields.flatMap((field, fieldIndex) => {
    const error = payloadFieldConsistencyError(step.payload!, field);
    return error ? [`Trace step ${stepIndex + 1}, field ${fieldIndex + 1} (${JSON.stringify(field.path)}): ${error}. Use a real payload path, remove the modifier, or describe an external output with produces.`] : [];
  }) ?? []);
}

function resolveJsonPath(root: unknown, path: string): { exists: boolean; value?: unknown } {
  const normalized = path.trim().replace(/^\$\.?/, "");
  if (!normalized) return { exists: true, value: root };
  const segments = normalized.replace(/\[(?:"([^"]+)"|'([^']+)'|(\d+))\]/g, (_match, double, single, index) => `.${double ?? single ?? index}`).split(".").filter(Boolean);
  let current = root;
  for (const segment of segments) {
    if (current === null || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, segment)) return { exists: false };
    current = (current as Record<string, unknown>)[segment];
  }
  return { exists: true, value: current };
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, index) => jsonEqual(value, right[index]));
  if (left && right && typeof left === "object" && typeof right === "object" && !Array.isArray(left) && !Array.isArray(right)) {
    const leftKeys = Object.keys(left as object).sort(); const rightKeys = Object.keys(right as object).sort();
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && jsonEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
  }
  return false;
}

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
