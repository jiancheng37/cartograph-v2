import cors from "cors";
import express from "express";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { CreateTraceSchema, CreateViewSchema, UpdateViewSchema, ViewEdgeInputSchema, ViewNodeInputSchema, ViewPositionsSchema } from "@cartograph/shared";
import { openDatabase } from "./db.js";
import { Store } from "./store.js";
import { registerRepository } from "./repository.js";

export function createApp(databasePath?: string) {
  const app = express(); const store = new Store(openDatabase(databasePath));
  app.use(cors({ origin: process.env.CARTOGRAPH_WEB_ORIGIN ?? "http://localhost:5173" }));
  app.use(express.json({ limit: "2mb" }));
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/repositories", (_req, res) => res.json(store.repositories()));
  app.post("/api/repositories", (req, res, next) => {
    try { const { path } = z.object({ path: z.string().min(1).refine(isAbsolute, "Repository path must be absolute") }).parse(req.body); res.status(201).json(registerRepository(store, path)); } catch (error) { next(error); }
  });
  app.delete("/api/repositories/:id", (req, res) => store.deleteRepository(req.params.id) ? res.status(204).end() : res.status(404).json({ error: "Repository not found" }));
  app.get("/api/repositories/:id/search", (req, res) => res.json(store.searchKnowledge(req.params.id, String(req.query.q ?? ""), Number(req.query.limit ?? 40))));
  app.get("/api/views", (req, res) => res.json(store.views(req.query.repositoryId ? String(req.query.repositoryId) : undefined, req.query.archived === "true")));
  app.get("/api/views/:id", (req, res) => { const view = store.view(req.params.id); view ? res.json(view) : res.status(404).json({ error: "View not found" }); });
  app.post("/api/views", (req, res, next) => { try { res.status(201).json(store.createView(CreateViewSchema.parse(req.body))); } catch (error) { next(error); } });
  app.patch("/api/views/:id", (req, res, next) => { try { res.json(store.updateView(req.params.id, UpdateViewSchema.parse(req.body))); } catch (error) { next(error); } });
  app.patch("/api/views/:id/positions", (req, res, next) => { try { const body = ViewPositionsSchema.parse(req.body); res.json(store.updateNodePositions(req.params.id, body.positions, body.expectedRevision, body.routes, body.clearRoutes)); } catch (error) { next(error); } });
  app.post("/api/views/:id/duplicate", (req, res, next) => { try { res.status(201).json(store.duplicateView(req.params.id)); } catch (error) { next(error); } });
  app.post("/api/views/:id/archive", (req, res, next) => { try { const body = z.object({ expectedRevision: z.number().int().positive().optional() }).parse(req.body); res.json(store.archiveView(req.params.id, body.expectedRevision)); } catch (error) { next(error); } });
  app.delete("/api/views/:id", (req, res) => store.deleteView(req.params.id) ? res.status(204).end() : res.status(404).json({ error: "View not found" }));
  app.post("/api/views/:id/extend", (req, res, next) => {
    try {
      const body = z.object({ nodes: z.array(ViewNodeInputSchema).default([]), edges: z.array(ViewEdgeInputSchema).default([]), expectedRevision: z.number().int().positive().optional() }).parse(req.body);
      res.json(store.extendView(req.params.id, body.nodes, body.edges, body.expectedRevision));
    } catch (error) { next(error); }
  });
  app.post("/api/views/:id/nodes/:nodeId/drilldown", (req, res, next) => { try { res.status(201).json(store.createNodeDrilldown(req.params.id, req.params.nodeId)); } catch (error) { next(error); } });
  app.get("/api/views/:id/traces", (req, res) => res.json(store.traces(req.params.id)));
  app.post("/api/views/:id/traces", (req, res, next) => { try { res.status(201).json(store.createTrace(CreateTraceSchema.parse({ ...req.body, viewId: req.params.id }))); } catch (error) { next(error); } });
  app.get("/api/traces/:id", (req, res) => { const trace = store.trace(req.params.id); trace ? res.json(trace) : res.status(404).json({ error: "Trace not found" }); });
  app.delete("/api/traces/:id", (req, res) => store.deleteTrace(req.params.id) ? res.status(204).end() : res.status(404).json({ error: "Trace not found" }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof z.ZodError ? error.issues[0]?.message ?? "Invalid request" : error instanceof Error ? error.message : "Unexpected error";
    res.status(message.includes("conflict") ? 409 : 400).json({ error: message });
  });
  return { app, store };
}
