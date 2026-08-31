import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { layoutGraph } from "./layout";

describe("ELK graph layout", () => {
  it("produces persisted orthogonal routes with label positions", async () => {
    const nodes: Node[] = ["source", "worker", "store"].map((id, index) => ({ id, position: { x: index * 10, y: 0 }, data: {} }));
    const edges: Edge[] = [
      { id: "request", source: "source", target: "worker", label: "authenticated HTTP request" },
      { id: "persist", source: "worker", target: "store", label: "validated payload" },
    ];
    const arranged = await layoutGraph(nodes, edges);
    expect(arranged.nodes[1]!.position.x).toBeGreaterThan(arranged.nodes[0]!.position.x);
    expect(arranged.routes).toHaveLength(2);
    expect(arranged.routes[0]!.route.points.length).toBeGreaterThanOrEqual(2);
    expect(arranged.routes[0]!.route.label).toEqual({ x: expect.any(Number), y: expect.any(Number) });
  });
});
