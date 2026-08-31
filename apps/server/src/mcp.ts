import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { z } from "zod";
import { Confidence, CreateTraceSchema, CreateViewSchema, EdgeKind, EvidenceSchema, NodeKind, TraceStepSchema } from "@cartograph/shared";
import { openDatabase } from "./db.js";
import { Store } from "./store.js";
import { registerRepository } from "./repository.js";

const databasePath = resolve(process.env.CARTOGRAPH_DB ?? ".cartograph/cartograph.db");
const store = new Store(openDatabase(databasePath));
const server = new McpServer({ name: "cartograph", version: "0.1.0" });
const result = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const nodeSchema = z.object({ id: z.string().optional(), label: z.string(), kind: NodeKind, summary: z.string(), confidence: Confidence.default("inferred"), evidence: z.array(EvidenceSchema).default([]), position: z.object({ x: z.number(), y: z.number() }).optional() });
const edgeSchema = z.object({ id: z.string().optional(), source: z.string(), target: z.string(), kind: EdgeKind, label: z.string().optional(), summary: z.string().optional(), confidence: Confidence.default("inferred"), evidence: z.array(EvidenceSchema).default([]) });

server.tool("list_repositories", "List repositories registered with Cartograph. Call this before creating a view. If the current repository is absent, call register_repository.", {}, async () => result(store.repositories()));
server.tool("register_repository", "Register a project root with Cartograph so agent-authored maps and source paths can be saved against it. This does not scan or parse the repository.", { repositoryPath: z.string().min(1).optional() }, async ({ repositoryPath }) => {
  try {
    let path = repositoryPath;
    if (!path) {
      const roots = (await server.server.listRoots()).roots.filter(root => root.uri.startsWith("file:"));
      if (roots.length !== 1) return { isError: true, ...result({ error: roots.length ? "Multiple project roots are open; pass repositoryPath explicitly." : "The MCP client did not provide a project root; pass repositoryPath explicitly." }) };
      path = fileURLToPath(roots[0]!.uri);
    }
    return result(registerRepository(store, path));
  } catch (error) { return { isError: true, ...result({ error: error instanceof Error ? error.message : "Could not register repository" }) }; }
});
server.tool("create_node_drilldown", "Explain a component inside its own detailed map while preserving the parent diagram. Use this when the user asks to explain, open, or go inside a node. Reuses an existing child map when one is already linked.", { viewId: z.string(), nodeId: z.string() }, async ({ viewId, nodeId }) => {
  try { return result(store.createNodeDrilldown(viewId, nodeId)); } catch (error) { return { isError: true, ...result({ error: error instanceof Error ? error.message : "Could not create node drill-down" }) }; }
});
server.tool("create_trace", "Create a step-by-step journey through an existing view. Use this when the user asks what happens when an event enters the system or how data moves through a pipeline. Each step must reference a node in the view; edgeId identifies the connection used to reach that step. Use receives and produces to identify the exact runtime boundary, data contract, transport, and source/destination; source files belong in boundary evidence, not as runtime endpoints unless the code actually reads or writes a file. When source evidence supports a data shape, include an optional payload with synthetic before/after examples and field operations. Never place real credentials, secrets, or personal data in examples.", { viewId: z.string(), title: z.string(), description: z.string().default(""), steps: z.array(TraceStepSchema).min(2).max(24) }, async input => {
  try { return result(store.createTrace(CreateTraceSchema.parse(input))); } catch (error) { return { isError: true, ...result({ error: error instanceof Error ? error.message : "Could not create trace" }) }; }
});
server.tool("list_traces", "List saved step-by-step journeys for a view.", { viewId: z.string() }, async ({ viewId }) => result(store.traces(viewId)));
server.tool("find_views", "Find existing visual knowledge. Use this before answering so prior understanding can be reused.", { repositoryId: z.string().optional(), query: z.string().default("") }, async ({ repositoryId, query }) => result(store.views(repositoryId).filter(view => `${view.title} ${view.description}`.toLowerCase().includes(query.toLowerCase()))));
server.tool("get_view", "Retrieve a complete saved view including nodes, relationships, evidence and freshness.", { viewId: z.string() }, async ({ viewId }) => { const view = store.view(viewId); return view ? result(view) : { isError: true, ...result({ error: "View not found" }) }; });
server.tool("create_view", "Create a compact visual explanation. To explain a node in more detail without changing its diagram, pass parentViewId and parentNodeId to create a drill-down view. Prefer 5-12 semantic nodes, stable IDs, concise summaries, and source evidence.", { title: z.string(), description: z.string().default(""), repositoryId: z.string(), parentViewId: z.string().optional(), parentNodeId: z.string().optional(), nodes: z.array(nodeSchema).max(80), edges: z.array(edgeSchema).max(160) }, async input => result(store.createView(CreateViewSchema.parse(input))));
server.tool("extend_view", "Extend an existing view instead of recreating prior understanding. Pass the revision read by get_view to prevent lost updates.", { viewId: z.string(), expectedRevision: z.number().int().positive().optional(), nodes: z.array(nodeSchema).max(80).default([]), edges: z.array(edgeSchema).max(160).default([]) }, async ({ viewId, expectedRevision, nodes, edges }) => {
  try { return result(store.extendView(viewId, nodes, edges, expectedRevision)); } catch (error) { return { isError: true, ...result({ error: error instanceof Error ? error.message : "Could not extend view" }) }; }
});

await server.connect(new StdioServerTransport());
