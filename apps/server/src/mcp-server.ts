import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Confidence, CreateTraceSchema, CreateViewSchema, EdgeKind, EvidenceSchema, NodeKind, TraceStepSchema } from "@cartograph/shared";

export function createCartographMcp(store: any, options: { hosted: boolean; activity?: () => void }) {
  const server = new McpServer({ name: "cartograph", version: "0.2.0" });
  const result = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
  const active = () => options.activity?.();
  const nodeSchema = z.object({ id: z.string().optional(), label: z.string(), kind: NodeKind, summary: z.string(), confidence: Confidence.default("inferred"), evidence: z.array(EvidenceSchema).default([]), position: z.object({ x: z.number(), y: z.number() }).optional() });
  const edgeSchema = z.object({ id: z.string().optional(), source: z.string(), target: z.string(), kind: EdgeKind, label: z.string().optional(), summary: z.string().optional(), confidence: Confidence.default("inferred"), evidence: z.array(EvidenceSchema).default([]) });

  server.tool("list_repositories", "List repositories registered in this Cartograph account. Call this before creating a view.", {}, async () => { active(); return result(await store.repositories()); });
  server.tool("register_repository", "Register the current repository as a logical Cartograph workspace. Cartograph does not read its source. In hosted mode, provide a portable name and optional Git remote or other stable identifier; do not send an absolute local path.", { name: z.string().min(1).max(120).optional(), externalId: z.string().min(1).max(300).optional(), repositoryPath: z.string().min(1).optional() }, async ({ name, externalId, repositoryPath }) => {
    active();
    try {
      if (options.hosted) { const repositoryName = name ?? (repositoryPath ? basename(repositoryPath) : undefined); if (!repositoryName) return { isError: true, ...result({ error: "Provide the repository name" }) }; return result(await store.registerRepository({ name: repositoryName, externalId: externalId ?? repositoryName.toLowerCase() })); }
      let path = repositoryPath;
      if (!path) { const roots = (await server.server.listRoots()).roots.filter((root: { uri: string }) => root.uri.startsWith("file:")); if (roots.length !== 1) return { isError: true, ...result({ error: "Pass repositoryPath or open exactly one project root" }) }; path = fileURLToPath(roots[0]!.uri); }
      return result(await store.registerRepository(path));
    } catch (error) { return { isError: true, ...result({ error: error instanceof Error ? error.message : "Could not register repository" }) }; }
  });
  server.tool("create_node_drilldown", "Create or retrieve a focused child map for a node.", { viewId: z.string(), nodeId: z.string() }, async ({ viewId, nodeId }) => { active(); try { return result(await store.createNodeDrilldown(viewId, nodeId)); } catch (error) { return { isError: true, ...result({ error: error instanceof Error ? error.message : "Could not create drill-down" }) }; } });
  server.tool("create_trace", "Save a step-by-step journey through an existing view. Steps must reference nodes in that view. Use repository-relative source references and synthetic payloads without secrets or personal data.", { viewId: z.string(), title: z.string(), description: z.string().default(""), steps: z.array(TraceStepSchema).min(2).max(24) }, async input => { active(); try { return result(await store.createTrace(CreateTraceSchema.parse(input))); } catch (error) { return { isError: true, ...result({ error: error instanceof Error ? error.message : "Could not create trace" }) }; } });
  server.tool("list_traces", "List saved journeys for a view.", { viewId: z.string() }, async ({ viewId }) => { active(); return result(await store.traces(viewId)); });
  server.tool("find_views", "Find existing visual knowledge before creating another view.", { repositoryId: z.string().optional(), query: z.string().default("") }, async ({ repositoryId, query }) => { active(); return result((await store.views(repositoryId)).filter((view: { title: string; description: string }) => `${view.title} ${view.description}`.toLowerCase().includes(query.toLowerCase()))); });
  server.tool("get_view", "Retrieve a complete saved view including nodes, relationships, source references, and confidence.", { viewId: z.string() }, async ({ viewId }) => { active(); const view = await store.view(viewId); return view ? result(view) : { isError: true, ...result({ error: "View not found" }) }; });
  server.tool("create_view", "Create a compact visual explanation. Prefer 5-12 semantic nodes, stable IDs, concise summaries, and repository-relative source references.", { title: z.string(), description: z.string().default(""), repositoryId: z.string(), parentViewId: z.string().optional(), parentNodeId: z.string().optional(), nodes: z.array(nodeSchema).max(80), edges: z.array(edgeSchema).max(160) }, async input => { active(); return result(await store.createView(CreateViewSchema.parse(input))); });
  server.tool("extend_view", "Extend an existing view. Pass the revision read by get_view to prevent lost updates.", { viewId: z.string(), expectedRevision: z.number().int().positive().optional(), nodes: z.array(nodeSchema).max(80).default([]), edges: z.array(edgeSchema).max(160).default([]) }, async ({ viewId, expectedRevision, nodes, edges }) => { active(); try { return result(await store.extendView(viewId, nodes, edges, expectedRevision)); } catch (error) { return { isError: true, ...result({ error: error instanceof Error ? error.message : "Could not extend view" }) }; } });
  return server;
}
