import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

const paths: string[] = [];
afterEach(() => { for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });

function workspace(name: string) {
  const root = mkdtempSync(join(tmpdir(), `cartograph-${name}-`)); paths.push(root);
  return { root, app: createApp(join(root, "cartograph.db")).app };
}

async function register(app: ReturnType<typeof createApp>["app"], root: string) {
  return (await request(app).post("/api/repositories").send({ path: root }).expect(201)).body;
}

describe("Cartograph knowledge lifecycle", () => {
  it("registers a repository without scanning its contents", async () => {
    const { root, app } = workspace("register"); mkdirSync(join(root, "src"));
    const repository = await register(app, root);
    expect(repository).toMatchObject({ name: expect.stringContaining("cartograph-register-"), rootPath: root, addedAt: expect.any(String) });
    expect(Object.keys(repository).sort()).toEqual(["addedAt", "id", "name", "rootPath"]);
    expect((await request(app).get("/api/repositories").expect(200)).body).toEqual([repository]);
    expect((await request(app).post("/api/repositories").send({ path: root }).expect(201)).body.id).toBe(repository.id);
  });

  it("validates repository paths", async () => {
    const { root, app } = workspace("paths");
    await request(app).post("/api/repositories").send({ path: "./relative" }).expect(400, { error: "Repository path must be absolute" });
    await request(app).post("/api/repositories").send({ path: join(root, "missing") }).expect(400);
  });

  it("reports setup metadata and waits for a real MCP heartbeat", async () => {
    const { app } = workspace("presence");
    expect((await request(app).get("/api/mcp/status").expect(200)).body).toEqual({ connected: false, state: "waiting" });
    expect((await request(app).get("/api/setup").expect(200)).body).toEqual({ projectRoot: process.cwd() });
  });

  it("creates, extends, searches, and manages agent-authored views", async () => {
    const { root, app } = workspace("views"); const repository = await register(app, root);
    const created = (await request(app).post("/api/views").send({ repositoryId: repository.id, title: "Authentication flow", description: "Sign-in path", nodes: [{ id: "auth", label: "Authenticate", kind: "function", summary: "Validates a user", confidence: "source_cited", evidence: [{ path: "src/auth.ts", startLine: 1 }] }], edges: [] }).expect(201)).body;
    expect(created).toMatchObject({ revision: 1, ancestors: [], nodes: [{ id: "auth", confidence: "source_cited" }] });
    const extended = (await request(app).post(`/api/views/${created.id}/extend`).send({ expectedRevision: 1, nodes: [{ id: "token", label: "Issue token", kind: "function", summary: "Creates a session", evidence: [] }], edges: [{ source: "auth", target: "token", kind: "calls", evidence: [] }] }).expect(200)).body;
    expect(extended.revision).toBe(2); expect(extended.nodes).toHaveLength(2); expect(extended.edges).toHaveLength(1);
    const search = (await request(app).get(`/api/repositories/${repository.id}/search?q=auth`).expect(200)).body;
    expect(search).toEqual(expect.arrayContaining([expect.objectContaining({ type: "view", viewId: created.id }), expect.objectContaining({ type: "node", nodeId: "auth" })]));
    const renamed = (await request(app).patch(`/api/views/${created.id}`).send({ title: "Identity map", expectedRevision: 2 }).expect(200)).body;
    const duplicate = (await request(app).post(`/api/views/${created.id}/duplicate`).expect(201)).body;
    expect(renamed.title).toBe("Identity map"); expect(duplicate.title).toBe("Identity map copy");
    await request(app).post(`/api/views/${created.id}/archive`).send({ expectedRevision: 3 }).expect(200);
    expect((await request(app).get(`/api/views?repositoryId=${repository.id}`).expect(200)).body.map((view: { id: string }) => view.id)).toEqual([duplicate.id]);
  });

  it("creates reusable drill-downs without deriving dependencies", async () => {
    const { root, app } = workspace("drilldown"); const repository = await register(app, root);
    const parent = (await request(app).post("/api/views").send({ repositoryId: repository.id, title: "System", nodes: [{ id: "api", label: "API", kind: "service", summary: "Handles requests", evidence: [] }], edges: [] }).expect(201)).body;
    const child = (await request(app).post(`/api/views/${parent.id}/nodes/api/drilldown`).expect(201)).body;
    expect(child).toMatchObject({ parentViewId: parent.id, parentNodeId: "api", title: "API" });
    expect(child.ancestors).toEqual([{ viewId: parent.id, title: "System", nodeId: "api", nodeLabel: "API" }]);
    expect(child.nodes).toHaveLength(1);
    expect((await request(app).post(`/api/views/${parent.id}/nodes/api/drilldown`).expect(201)).body.id).toBe(child.id);
  });

  it("persists traces and redacts secret-shaped payload fields", async () => {
    const { root, app } = workspace("traces"); const repository = await register(app, root);
    const view = (await request(app).post("/api/views").send({ repositoryId: repository.id, title: "Login", nodes: [{ id: "route", label: "Route", kind: "route", summary: "Receives login", evidence: [] }, { id: "session", label: "Session", kind: "service", summary: "Creates session", evidence: [] }], edges: [{ id: "call", source: "route", target: "session", kind: "calls", evidence: [] }] }).expect(201)).body;
    const trace = (await request(app).post(`/api/views/${view.id}/traces`).send({ title: "Sign in", steps: [{ nodeId: "route", label: "Receive", action: "Receive login", payload: { format: "json", before: { password: "secret" }, after: { token: "value" }, fields: [] } }, { nodeId: "session", edgeId: "call", label: "Create", action: "Create session" }] }).expect(201)).body;
    expect(trace.steps[0].payload).toMatchObject({ before: { password: "[REDACTED]" }, after: { token: "[REDACTED]" } });
    expect((await request(app).get(`/api/views/${view.id}/traces`).expect(200)).body).toHaveLength(1);
  });

  it("rejects concurrent updates and preserves arranged routes", async () => {
    const { root, app } = workspace("revision"); const repository = await register(app, root);
    const view = (await request(app).post("/api/views").send({ repositoryId: repository.id, title: "Map", nodes: [{ id: "a", label: "A", kind: "service", summary: "A", evidence: [] }, { id: "b", label: "B", kind: "service", summary: "B", evidence: [] }], edges: [{ id: "a-b", source: "a", target: "b", kind: "calls", evidence: [] }] }).expect(201)).body;
    const route = { points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] };
    const arranged = (await request(app).patch(`/api/views/${view.id}/positions`).send({ expectedRevision: 1, positions: [{ id: "a", x: 0, y: 0 }], routes: [{ id: "a-b", route }] }).expect(200)).body;
    expect(arranged.edges[0].route).toEqual(route);
    await request(app).post(`/api/views/${view.id}/extend`).send({ expectedRevision: 1 }).expect(409);
  });

  it("removes a repository and all saved knowledge without touching source files", async () => {
    const { root, app } = workspace("remove"); const repository = await register(app, root);
    const view = (await request(app).post("/api/views").send({ repositoryId: repository.id, title: "Map", nodes: [], edges: [] }).expect(201)).body;
    await request(app).delete(`/api/repositories/${repository.id}`).expect(204);
    expect((await request(app).get("/api/repositories").expect(200)).body).toEqual([]);
    await request(app).get(`/api/views/${view.id}`).expect(404);
  });
});
