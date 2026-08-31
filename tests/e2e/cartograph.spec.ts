import { expect, test, type Page, type Route } from "@playwright/test";

const repository = { id: "repo_demo", name: "cartograph-demo", rootPath: "/code/cartograph-demo", addedAt: new Date().toISOString() };
const architecture = { id: "view_arch", repositoryId: repository.id, title: "Repository architecture", description: "System boundaries", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), revision: 1, ancestors: [], nodes: [
  { id: "source", label: "Source repository", kind: "external", summary: "Supplies source files to the coding agent.", confidence: "source_cited", evidence: [{ path: "src/repository.ts", startLine: 12, endLine: 30 }], position: { x: 120, y: 100 } },
  { id: "store", label: "Semantic store", kind: "class", summary: "Persists agent-authored knowledge views.", confidence: "source_cited", evidence: [{ path: "src/store.ts", startLine: 9 }], position: { x: 400, y: 100 } },
], edges: [{ id: "writes", source: "source", target: "store", kind: "writes", label: "saved maps", confidence: "source_cited", evidence: [] }] };

async function mockApi(page: Page) {
  let views: any[] = [structuredClone(architecture)];
  await page.route("**/api/**", async (route: Route) => {
    const request = route.request(); const url = new URL(request.url()); const method = request.method(); const path = url.pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/repositories" && method === "GET") return json([repository]);
    if (path === "/api/mcp/status" && method === "GET") return json({ connected: false, state: "waiting" });
    if (path === "/api/setup" && method === "GET") return json({ projectRoot: "/code/cartograph" });
    if (path.endsWith("/search")) return json([{ id: "node:view_arch:store", type: "node", label: "Semantic store", detail: "Repository architecture · class", viewId: "view_arch", nodeId: "store" }]);
    if (path === "/api/views" && method === "GET") return json(views.filter(view => !view.archivedAt));
    if (path.endsWith("/traces") && method === "GET") return json([]);
    if (path === "/api/views" && method === "POST") { const input = request.postDataJSON(); const created = { ...architecture, id: `view_${views.length}`, title: input.title, description: input.description, nodes: [], edges: [], revision: 1 }; views.unshift(created); return json(created, 201); }
    const id = path.split("/")[3]; const index = views.findIndex(view => view.id === id); const current = views[index];
    if (path.endsWith("/positions") && method === "PATCH") { const input = request.postDataJSON(); current.nodes = current.nodes.map((node: any) => ({ ...node, position: input.positions.find((item: any) => item.id === node.id) ?? node.position })); current.revision += 1; return json(current); }
    if (path.endsWith("/duplicate") && method === "POST") { const copy = { ...structuredClone(current), id: `${id}_copy`, title: `${current.title} copy`, revision: 1 }; views.unshift(copy); return json(copy, 201); }
    if (path.endsWith("/archive") && method === "POST") { current.archivedAt = new Date().toISOString(); current.revision += 1; return json(current); }
    if (path === `/api/views/${id}` && method === "PATCH") { Object.assign(current, request.postDataJSON()); current.revision += 1; return json(current); }
    if (path === `/api/views/${id}` && method === "DELETE") { views.splice(index, 1); return route.fulfill({ status: 204 }); }
    if (path === `/api/views/${id}` && method === "GET") return current ? json(current) : json({ error: "View not found" }, 404);
    return json({ error: `Unhandled ${method} ${path}` }, 404);
  });
}

test.beforeEach(async ({ page, context }) => { await context.grantPermissions(["clipboard-read", "clipboard-write"]); await mockApi(page); await page.goto("/"); await expect(page.getByRole("heading", { name: "Repository architecture" })).toBeVisible(); });

test("searches, focuses evidence, arranges, and manages views", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile");
  await page.getByRole("textbox", { name: "Search knowledge" }).fill("store");
  await page.getByRole("button", { name: /Semantic store/ }).click();
  await expect(page.getByRole("heading", { name: "Semantic store" })).toBeVisible();
  await page.getByLabel("Evidence editor").selectOption("copy");
  await page.getByRole("button", { name: /src\/store.ts/ }).first().click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("/code/cartograph-demo/src/store.ts:9");
  await page.getByRole("button", { name: "Close inspector" }).click();
  await page.getByRole("button", { name: "Arrange" }).click();
  await expect(page.getByText(/Revision [2-9]/)).toBeVisible();

  await page.getByRole("button", { name: "View actions" }).click(); await page.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("Title").fill("Platform map"); await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Platform map" })).toBeVisible();
  await page.getByRole("button", { name: "View actions" }).click(); await page.getByRole("button", { name: "Duplicate" }).click();
  await expect(page.getByRole("heading", { name: "Platform map copy" })).toBeVisible();
  await page.getByRole("button", { name: "View actions" }).click(); await page.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByRole("heading", { name: "Platform map", exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Connect an agent/ }).click();
  await expect(page.getByRole("heading", { name: "Connect Cartograph" })).toBeVisible();
  await expect(page.getByText(/codex mcp add cartograph/)).toBeVisible();
  await page.getByRole("button", { name: "Close setup" }).click();
});

test("mobile navigation and inspector use the full workspace without overflow", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("textbox", { name: "Search knowledge" })).toBeVisible();
  await page.getByRole("button", { name: /Repository architecture/ }).click();
  await expect(page.locator(".sidebar")).not.toHaveClass(/open/);
  await page.locator(".flow-node").filter({ hasText: "Semantic store" }).click();
  await expect(page.getByRole("heading", { name: "Semantic store" })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(dimensions.scroll).toBe(dimensions.client);
});

test("copies a repository-aware starter investigation", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop");
  await page.route("**/api/views**", route => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.reload();
  await page.getByRole("button", { name: /Map the architecture/ }).click();
  await expect(page.getByText(/Prompt copied/)).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("Use Cartograph for the repository at /code/cartograph-demo");
  await context.clearPermissions();
});
