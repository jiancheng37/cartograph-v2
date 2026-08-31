import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import type { EdgeRoute } from "./layout";

type RoutedData = { route?: EdgeRoute; color?: string };

export function RoutedEdge(props: EdgeProps) {
  const data = props.data as RoutedData | undefined; const route = data?.route;
  const fallback = getSmoothStepPath(props);
  const path = route?.points.length ? route.points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ") : fallback[0];
  const labelX = route?.label?.x ?? fallback[1]; const labelY = route?.label?.y ?? fallback[2];
  return <>
    <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} style={props.style} />
    {props.label && <EdgeLabelRenderer><div className="routed-edge-label" style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`, color: data?.color, borderColor: data?.color ? `${data.color}55` : undefined }}>{props.label}</div></EdgeLabelRenderer>}
  </>;
}
