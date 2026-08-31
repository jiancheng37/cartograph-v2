import { createHash, randomBytes } from "node:crypto";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { isAbsolute } from "node:path";
import { nanoid } from "nanoid";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { CreateTraceSchema, CreateViewSchema, UpdateViewSchema, ViewEdgeInputSchema, ViewNodeInputSchema, ViewPositionsSchema } from "@cartograph/shared";
import { requireUser, userId } from "./auth.js";
import { openDatabase } from "./db.js";
import { mcpStatus } from "./presence.js";
import { createCartographMcp } from "./mcp-server.js";
import { PostgresStore } from "./postgres-store.js";
import { ScopedStore } from "./scoped-store.js";
import { Store } from "./store.js";

export function createApp(databasePath?: string) {
  const app = express();
  const cloud = process.env.DATABASE_URL ? new PostgresStore(process.env.DATABASE_URL) : undefined;
  const local = cloud ? undefined : new Store(openDatabase(databasePath));
  const tenant = (req: express.Request): any => cloud ? cloud.forUser(userId(req)) : new ScopedStore(local!, userId(req));
  app.set("trust proxy", 1);
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(cors({ origin: (process.env.CARTOGRAPH_WEB_ORIGIN ?? "http://localhost:5173").split(","), credentials: true }));
  app.use(express.json({ limit: "2mb" }));
  app.use(rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: "draft-8", legacyHeaders: false }));
  app.get("/health", (_req, res) => res.json({ status: "ok", storage: cloud ? "postgres" : "sqlite" }));
  app.all("/mcp", async (req, res) => {
    if (req.method !== "POST") return res.status(405).set("Allow", "POST").json({ error: "Use POST for stateless MCP requests" });
    const secret = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!secret) return res.status(401).set("WWW-Authenticate", "Bearer").json({ error: "MCP token required" });
    const identity = cloud ? await cloud.resolveMcpToken(hashToken(secret)) : local!.resolveMcpToken(hashToken(secret));
    if (!identity) return res.status(401).set("WWW-Authenticate", "Bearer error=\"invalid_token\"").json({ error: "Invalid MCP token" });
    const scoped = cloud ? cloud.forUser(identity.userId) : new ScopedStore(local!, identity.userId);
    const server = createCartographMcp(scoped, { hosted: Boolean(cloud) });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
    catch (error) { if (!res.headersSent) res.status(500).json({ error: error instanceof Error ? error.message : "MCP request failed" }); }
  });
  app.use("/api", requireUser);
  app.get("/api/mcp/status", async (req, res) => { if (cloud) { const used = (await tenant(req).mcpTokens()).map((token: { lastUsedAt?: string }) => token.lastUsedAt).filter(Boolean).sort().at(-1); const connected = Boolean(used && Date.now() - new Date(used).getTime() < 5 * 60_000); return res.json({ connected, state: connected ? "connected" : "waiting", lastSeenAt: used }); } res.json(mcpStatus(local!.database)); });
  app.get("/api/setup", (_req, res) => res.json({ projectRoot: process.cwd(), mcpUrl: process.env.CARTOGRAPH_MCP_URL ?? "http://localhost:4310/mcp", hosted: Boolean(cloud) }));
  app.get("/api/repositories", async (req, res, next) => { try { res.json(await tenant(req).repositories()); } catch (error) { next(error); } });
  app.post("/api/repositories", async (req, res, next) => {
    try {
      if (cloud) { const body = z.object({ name: z.string().min(1).max(120), externalId: z.string().min(1).max(300).optional() }).parse(req.body); return res.status(201).json(await tenant(req).registerRepository(body)); }
      const { path } = z.object({ path: z.string().min(1).refine(isAbsolute, "Repository path must be absolute") }).parse(req.body); res.status(201).json(await tenant(req).registerRepository(path));
    } catch (error) { next(error); }
  });
  app.delete("/api/repositories/:id", async (req, res, next) => { try { (await tenant(req).deleteRepository(req.params.id)) ? res.status(204).end() : res.status(404).json({ error: "Repository not found" }); } catch (error) { next(error); } });
  app.get("/api/repositories/:id/search", async (req, res, next) => { try { res.json(await tenant(req).searchKnowledge(req.params.id, String(req.query.q ?? ""), Number(req.query.limit ?? 40))); } catch (error) { next(error); } });
  app.get("/api/views", async (req, res, next) => { try { res.json(await tenant(req).views(req.query.repositoryId ? String(req.query.repositoryId) : undefined, req.query.archived === "true")); } catch (error) { next(error); } });
  app.get("/api/views/:id", async (req, res, next) => { try { const view = await tenant(req).view(req.params.id); view ? res.json(view) : res.status(404).json({ error: "View not found" }); } catch (error) { next(error); } });
  app.post("/api/views", async (req, res, next) => { try { res.status(201).json(await tenant(req).createView(CreateViewSchema.parse(req.body))); } catch (error) { next(error); } });
  app.patch("/api/views/:id", async (req, res, next) => { try { res.json(await tenant(req).updateView(req.params.id, UpdateViewSchema.parse(req.body))); } catch (error) { next(error); } });
  app.patch("/api/views/:id/positions", async (req, res, next) => { try { const body = ViewPositionsSchema.parse(req.body); res.json(await tenant(req).updateNodePositions(req.params.id, body.positions, body.expectedRevision, body.routes, body.clearRoutes)); } catch (error) { next(error); } });
  app.post("/api/views/:id/duplicate", async (req, res, next) => { try { res.status(201).json(await tenant(req).duplicateView(req.params.id)); } catch (error) { next(error); } });
  app.post("/api/views/:id/archive", async (req, res, next) => { try { const body = z.object({ expectedRevision: z.number().int().positive().optional() }).parse(req.body); res.json(await tenant(req).archiveView(req.params.id, body.expectedRevision)); } catch (error) { next(error); } });
  app.delete("/api/views/:id", async (req, res, next) => { try { (await tenant(req).deleteView(req.params.id)) ? res.status(204).end() : res.status(404).json({ error: "View not found" }); } catch (error) { next(error); } });
  app.post("/api/views/:id/extend", async (req, res, next) => { try { const body = z.object({ nodes: z.array(ViewNodeInputSchema).default([]), edges: z.array(ViewEdgeInputSchema).default([]), expectedRevision: z.number().int().positive().optional() }).parse(req.body); res.json(await tenant(req).extendView(req.params.id, body.nodes, body.edges, body.expectedRevision)); } catch (error) { next(error); } });
  app.post("/api/views/:id/nodes/:nodeId/drilldown", async (req, res, next) => { try { res.status(201).json(await tenant(req).createNodeDrilldown(req.params.id, req.params.nodeId)); } catch (error) { next(error); } });
  app.get("/api/views/:id/traces", async (req, res, next) => { try { res.json(await tenant(req).traces(req.params.id)); } catch (error) { next(error); } });
  app.post("/api/views/:id/traces", async (req, res, next) => { try { res.status(201).json(await tenant(req).createTrace(CreateTraceSchema.parse({ ...req.body, viewId: req.params.id }))); } catch (error) { next(error); } });
  app.get("/api/traces/:id", async (req, res, next) => { try { const trace = await tenant(req).trace(req.params.id); trace ? res.json(trace) : res.status(404).json({ error: "Trace not found" }); } catch (error) { next(error); } });
  app.delete("/api/traces/:id", async (req, res, next) => { try { (await tenant(req).deleteTrace(req.params.id)) ? res.status(204).end() : res.status(404).json({ error: "Trace not found" }); } catch (error) { next(error); } });
  app.get("/api/mcp/tokens", async (req, res, next) => { try { res.json(await tenant(req).mcpTokens()); } catch (error) { next(error); } });
  app.post("/api/mcp/tokens", async (req, res, next) => { try { const { name } = z.object({ name: z.string().min(1).max(80).default("My coding agent") }).parse(req.body); const secret = `ctg_${randomBytes(32).toString("base64url")}`; const prefix = secret.slice(0, 12); const token = await tenant(req).createMcpToken({ id: nanoid(12), name, prefix, tokenHash: hashToken(secret) }); res.status(201).json({ ...token, secret }); } catch (error) { next(error); } });
  app.delete("/api/mcp/tokens/:id", async (req, res, next) => { try { (await tenant(req).deleteMcpToken(req.params.id)) ? res.status(204).end() : res.status(404).json({ error: "Token not found" }); } catch (error) { next(error); } });
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { const message = error instanceof z.ZodError ? error.issues[0]?.message ?? "Invalid request" : error instanceof Error ? error.message : "Unexpected error"; res.status(message.includes("conflict") ? 409 : message.endsWith("not found") ? 404 : 400).json({ error: message }); });
  return { app, store: local, cloud };
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
