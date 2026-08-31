import { tracePayloadConsistencyErrors, type CreateTraceInput, type KnowledgeView } from "@cartograph/shared";

export function validateTrace(view: KnowledgeView, input: CreateTraceInput) {
  const nodes = new Set(view.nodes.map(node => node.id));
  const edges = new Set(view.edges.map(edge => edge.id));
  input.steps.forEach((step, index) => {
    if (!nodes.has(step.nodeId)) throw new Error(`Trace step ${index + 1} references a node outside this view`);
    if (step.edgeId && !edges.has(step.edgeId)) throw new Error(`Trace step ${index + 1} references an edge outside this view`);
    if (step.receives?.nodeId && !nodes.has(step.receives.nodeId)) throw new Error(`Trace step ${index + 1} receives from a node outside this view`);
    if (step.produces?.nodeId && !nodes.has(step.produces.nodeId)) throw new Error(`Trace step ${index + 1} produces to a node outside this view`);
  });
  const errors = tracePayloadConsistencyErrors(input.steps);
  if (errors.length) throw new Error(`Inconsistent payload modifiers:\n${errors.join("\n")}`);
}
