import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Box, Braces, ChevronRight, CircleDot, Cloud, Database, FunctionSquare, Layers3, Route, Server } from "lucide-react";
import type { ViewNode } from "@cartograph/shared";

const icons = { system: Layers3, service: Server, module: Box, route: Route, function: FunctionSquare, class: Braces, database: Database, external: Cloud, queue: CircleDot, concept: Box };
export function FlowNode({ data, selected }: NodeProps) {
  const item = data.item as ViewNode; const drilldown = data.onDrilldown as (() => void) | undefined; const Icon = icons[item.kind] ?? Box;
  return <div className={`flow-node kind-${item.kind} ${selected ? "selected" : ""}`}>
    <Handle type="target" position={Position.Left} />
    <div className="node-icon"><Icon size={15} /></div>
    <div className="node-copy"><span>{item.kind}</span><strong>{item.label}</strong><p>{item.summary}</p></div>
    <button className={`node-depth ${item.childViewId ? "ready" : ""}`} title={item.childViewId ? "Open detailed map" : "Create a detailed map"} onClick={event => { event.stopPropagation(); drilldown?.(); }}><span>{item.childViewId ? "Inside" : "Explore"}</span><ChevronRight size={12}/></button>
    <Handle type="source" position={Position.Right} />
  </div>;
}
