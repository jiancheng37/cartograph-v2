import type { ELK, ElkNode } from "elkjs/lib/elk-api";
import type { Edge, Node } from "@xyflow/react";

let engine: Promise<ELK> | undefined;
async function layoutEngine() {
  engine ??= import("elkjs/lib/elk.bundled.js").then(({ default: ELK }) => new ELK());
  return engine;
}
const nodeWidth = 230;
const nodeHeight = 94;
export type EdgeRoute = { points: { x: number; y: number }[]; label?: { x: number; y: number } };
export type ArrangedGraph = { nodes: Node[]; routes: { id: string; route: EdgeRoute }[] };

export async function layoutGraph(nodes: Node[], edges: Edge[]): Promise<ArrangedGraph> {
  const elk = await layoutEngine();
  const input: ElkNode = { id: "root", layoutOptions: {
    "elk.algorithm": "layered", "elk.direction": "RIGHT", "elk.edgeRouting": "ORTHOGONAL",
    "elk.spacing.nodeNode": "72", "elk.spacing.edgeEdge": "28", "elk.spacing.edgeNode": "38",
    "elk.layered.spacing.nodeNodeBetweenLayers": "120", "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX", "elk.layered.mergeEdges": "false",
  }, children: nodes.map(node => ({ id: node.id, width: nodeWidth, height: nodeHeight })), edges: edges.map(edge => ({
    id: edge.id, sources: [edge.source], targets: [edge.target],
    labels: edge.label ? [{ text: String(edge.label), width: Math.min(280, Math.max(70, String(edge.label).length * 6.5 + 18)), height: 22 }] : undefined,
  })) };
  const graph = await elk.layout(input);
  const positions = new Map(graph.children?.map(node => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }]));
  const routes = (graph.edges ?? []).flatMap(edge => {
    const section = edge.sections?.[0]; if (!section) return [];
    const label = edge.labels?.[0];
    return [{ id: edge.id, route: { points: [section.startPoint, ...(section.bendPoints ?? []), section.endPoint], label: label?.x === undefined || label.y === undefined ? undefined : { x: label.x + (label.width ?? 0) / 2, y: label.y + (label.height ?? 0) / 2 } } }];
  });
  return { nodes: nodes.map(node => ({ ...node, position: positions.get(node.id) ?? node.position })), routes };
}

export function usesDefaultGrid(nodes: Node[]) {
  return nodes.every((node, index) => node.position.x === 120 + (index % 3) * 280 && node.position.y === 100 + Math.floor(index / 3) * 180);
}
