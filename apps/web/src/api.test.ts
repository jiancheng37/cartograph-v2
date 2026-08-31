import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

afterEach(() => vi.unstubAllGlobals());
describe("web API client", () => {
  it("sends repository registration as validated JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "repo_1", name: "demo" }), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await api.register("/code/demo");
    expect(fetchMock).toHaveBeenCalledWith("/api/repositories", expect.objectContaining({ method: "POST", body: JSON.stringify({ path: "/code/demo" }) }));
  });

  it("surfaces API error messages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Repository does not exist" }), { status: 400, headers: { "Content-Type": "application/json" } })));
    await expect(api.register("/missing")).rejects.toThrow("Repository does not exist");
  });

  it("loads the saved traces for a view", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: "trace_1", title: "Lead intake" }]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await api.traces("view_1");
    expect(fetchMock).toHaveBeenCalledWith("/api/views/view_1/traces", expect.any(Object));
  });

  it("deletes a saved trace", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await api.deleteTrace("trace_1");
    expect(fetchMock).toHaveBeenCalledWith("/api/traces/trace_1", expect.objectContaining({ method: "DELETE" }));
  });

  it("loads live MCP status and setup metadata", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ connected: true, state: "connected" }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ projectRoot: "/code/cartograph" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(api.mcpStatus()).resolves.toMatchObject({ connected: true });
    await expect(api.setup()).resolves.toEqual({ projectRoot: "/code/cartograph" });
  });
});
