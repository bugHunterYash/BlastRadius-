import { Background, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { useMemo } from "react";
import type { Design, Event, Issue } from "../api";

type AgentData = { name: string; reads: number; writes: number; state: "idle" | "ok" | "bad"; issues: number };

const RING = { idle: "border-white/10", ok: "border-ok/60", bad: "border-bad/80" };
const DOT = { idle: "bg-ink-600", ok: "bg-ok", bad: "bg-bad" };

function AgentNode({ data }: NodeProps<Node<AgentData>>) {
  return (
    <div className={`w-[150px] rounded-xl border-2 bg-ink-850 px-3 py-2.5 shadow-lg ${RING[data.state]}`}>
      <Handle type="target" position={Position.Left} className="!border-0 !bg-ink-500" />
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${DOT[data.state]}`} />
        <span className="font-semibold capitalize text-white">{data.name}</span>
      </div>
      <div className="mt-1.5 flex gap-3 font-mono text-[11px] text-ink-400">
        <span>R {data.reads}</span>
        <span>W {data.writes}</span>
        {data.issues > 0 && <span className="text-bad">{data.issues} issue{data.issues > 1 ? "s" : ""}</span>}
      </div>
      <Handle type="source" position={Position.Right} className="!border-0 !bg-ink-500" />
    </div>
  );
}

const nodeTypes = { agent: AgentNode };

/** Intended design (from the design tool) with the selected run drawn on top of it. */
export function DesignGraph({ design, events, issues }: { design: Design; events: Event[]; issues: Issue[] }) {
  const { nodes, edges } = useMemo(() => {
    const ran = events.length > 0;
    const actual = new Set(events.filter((e) => e.op === "handoff").map((e) => `${e.agent}>${e.target_agent}`));
    const designed = new Set(design.handoffs.map(([a, b]) => `${a}>${b}`));
    const openIssues = issues.filter((i) => i.status !== "resolved");
    const agents = [...design.agents, ...new Set(events.map((e) => e.agent).filter((a) => a !== "system" && !design.agents.includes(a)))];

    const nodes: Node<AgentData>[] = agents.map((name, i) => {
      const mine = events.filter((e) => e.agent === name);
      const n = openIssues.filter((x) => x.agent === name).length;
      const offDesign = !design.agents.includes(name);
      return {
        id: name, type: "agent", position: { x: i * 210, y: offDesign ? 150 : i % 2 ? 40 : 0 },
        data: {
          name, reads: mine.filter((e) => e.op === "read").length, writes: mine.filter((e) => e.op === "write").length,
          issues: n, state: n > 0 || offDesign ? "bad" : mine.length ? "ok" : "idle",
        },
      };
    });

    const edges: Edge[] = design.handoffs.map(([a, b]) => {
      const k = `${a}>${b}`;
      const followed = actual.has(k);
      const color = !ran ? "#6a6a76" : followed ? "#34d399" : "#f87171";
      return {
        id: `d-${k}`, source: a, target: b, animated: ran && followed,
        label: ran && !followed ? "skipped" : undefined,
        style: { stroke: color, strokeWidth: 2, strokeDasharray: ran && !followed ? "6 5" : undefined },
        labelStyle: { fill: "#f87171", fontWeight: 600, fontSize: 11 },
        labelBgStyle: { fill: "#0d0d11" },
        markerEnd: { type: MarkerType.ArrowClosed, color },
      };
    });
    actual.forEach((k) => {
      if (designed.has(k)) return;
      const [a, b] = k.split(">");
      edges.push({
        id: `x-${k}`, source: a, target: b, type: "smoothstep", animated: true, label: "off-design",
        style: { stroke: "#ff6a3d", strokeWidth: 2 },
        labelStyle: { fill: "#ff6a3d", fontWeight: 600, fontSize: 11 }, labelBgStyle: { fill: "#0d0d11" },
        markerEnd: { type: MarkerType.ArrowClosed, color: "#ff6a3d" },
      });
    });
    return { nodes, edges };
  }, [design, events, issues]);

  return (
    <div className="h-[300px] w-full">
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.25 }}
        nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
        panOnDrag={false} zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#22222b" gap={22} />
      </ReactFlow>
    </div>
  );
}
