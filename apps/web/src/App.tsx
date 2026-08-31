import { useCallback, useEffect, useRef, useState } from "react";
import { Background, Controls, MarkerType, MiniMap, ReactFlow, useEdgesState, useNodesState, type Edge, type Node, type ReactFlowInstance } from "@xyflow/react";
import { Archive, ArrowLeft, ArrowRight, Braces, Check, CheckCircle2, ChevronDown, ChevronRight, Clock3, Code2, Copy, ExternalLink, FolderGit2, GitBranch, LayoutTemplate, LoaderCircle, LogOut, Map, Menu, MoreHorizontal, PanelRightClose, Pause, Pencil, Play, Route, Search, Sparkles, Terminal, Trash2, Unplug, Workflow, X } from "lucide-react";
import { payloadFieldConsistencyError, type AppSetup, type Evidence, type KnowledgeSearchResult, type KnowledgeTrace, type KnowledgeView, type McpConnectionStatus, type Repository, type ViewNode } from "@cartograph/shared";
import { api } from "./api";
import { FlowNode } from "./FlowNode";
import { layoutGraph, usesDefaultGrid } from "./layout";
import { RoutedEdge } from "./RoutedEdge";
import { signOut } from "./auth";

const nodeTypes = { cartograph: FlowNode };
const edgeTypes = { routed: RoutedEdge };
type DialogState = { type: "rename" | "delete"; view: KnowledgeView };

export function App({ user }: { user?: { name: string; email: string } }) {
  const [repositories, setRepositories] = useState<Repository[]>([]); const [repo, setRepo] = useState<Repository>();
  const [views, setViews] = useState<KnowledgeView[]>([]); const [view, setView] = useState<KnowledgeView>();
  const [selected, setSelected] = useState<ViewNode>(); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]); const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [flow, setFlow] = useState<ReactFlowInstance<Node, Edge>>(); const [query, setQuery] = useState(""); const [results, setResults] = useState<KnowledgeSearchResult[]>([]);
  const [dialog, setDialog] = useState<DialogState>(); const [viewMenu, setViewMenu] = useState(false); const [repoMenu, setRepoMenu] = useState(false); const [mobileNav, setMobileNav] = useState(false);
  const [repositoryToDelete, setRepositoryToDelete] = useState<Repository>();
  const [accountOpen, setAccountOpen] = useState(false);
  const [connection, setConnection] = useState<McpConnectionStatus>({ connected: false, state: "waiting" }); const [setup, setSetup] = useState<AppSetup>(); const [setupOpen, setSetupOpen] = useState(false);
  const [traceToDelete, setTraceToDelete] = useState<KnowledgeTrace>();
  const [traces, setTraces] = useState<KnowledgeTrace[]>([]); const [trace, setTrace] = useState<KnowledgeTrace>(); const [traceStep, setTraceStep] = useState(0); const [playing, setPlaying] = useState(false);
  const viewportByView = useRef(new globalThis.Map<string, ReturnType<ReactFlowInstance<Node, Edge>["getViewport"]>>());
  const pendingViewport = useRef<ReturnType<ReactFlowInstance<Node, Edge>["getViewport"]> | undefined>(undefined);
  const mappedViewId = useRef<string | undefined>(undefined);
  const arrangingRevision = useRef<string | undefined>(undefined);

  const refreshRepositories = useCallback(async () => {
    try { const items = await api.repositories(); setRepositories(items); setRepo(current => items.find(item => item.id === current?.id) ?? items[0]); }
    catch (e) { setError(message(e)); }
  }, []);
  const refreshViews = useCallback(async (repository: Repository, preferredId?: string) => {
    const items = await api.views(repository.id); setViews(items); setView(current => items.find(item => item.id === (preferredId ?? current?.id)) ?? items[0]);
  }, []);

  useEffect(() => { void Promise.allSettled([refreshRepositories(), api.setup().then(setSetup)]).finally(() => setLoading(false)); }, [refreshRepositories]);
  useEffect(() => {
    const refresh = () => void api.mcpStatus().then(setConnection).catch(() => setConnection({ connected: false, state: "waiting" }));
    refresh(); const timer = window.setInterval(refresh, 5_000); return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { if (!repo) return; void refreshViews(repo).catch(e => setError(message(e))); }, [repo, refreshViews]);
  useEffect(() => {
    if (!view) { setNodes([]); setEdges([]); return; }
    let cancelled = false;
    const activeStep = trace?.viewId === view.id ? trace.steps[traceStep] : undefined;
    const visitedNodes = new Set(trace?.steps.slice(0, traceStep + 1).map(step => step.nodeId) ?? []);
    const visitedEdges = new Set(trace?.steps.slice(0, traceStep + 1).flatMap(step => step.edgeId ? [step.edgeId] : []) ?? []);
    const mappedEdges = mapEdges(view.edges, activeStep?.edgeId, trace ? visitedEdges : undefined);
    const mappedNodes = view.nodes.map(item => ({ id: item.id, type: "cartograph", position: item.position, className: trace ? item.id === activeStep?.nodeId ? "trace-active" : visitedNodes.has(item.id) ? "trace-visited" : "trace-dim" : undefined, data: { item, onDrilldown: () => void drillInto(item) } }));
    if ((view.revision === 1 || usesDefaultGrid(mappedNodes)) && mappedNodes.length) {
      const layoutKey = `${view.id}:${view.revision}`;
      const shouldPersist = arrangingRevision.current !== layoutKey;
      if (shouldPersist) arrangingRevision.current = layoutKey;
      void layoutGraph(mappedNodes, mappedEdges).then(async arranged => {
        if (!cancelled) {
          setNodes(arranged.nodes); setEdges(mappedEdges.map(edge => ({ ...edge, data: { ...edge.data, route: arranged.routes.find(item => item.id === edge.id)?.route } })));
          window.setTimeout(() => { if (!cancelled) void flow?.fitView({ padding: .2, duration: 360 }); }, 40);
        }
        if (!shouldPersist) return;
        const next = await api.updatePositions(view.id, view.revision, arranged.nodes.map(node => ({ id: node.id, ...node.position })), { routes: arranged.routes });
        setView(current => current?.id === view.id && current.revision === view.revision ? next : current);
      }).catch(e => { if (shouldPersist && arrangingRevision.current === layoutKey) arrangingRevision.current = undefined; if (!cancelled) setError(message(e)); });
    } else { setEdges(mappedEdges); setNodes(mappedNodes); }
    if (mappedViewId.current !== view.id) {
      mappedViewId.current = view.id;
      const restore = pendingViewport.current; pendingViewport.current = undefined;
      if (restore) window.setTimeout(() => flow?.setViewport(restore, { duration: 320 }), 40);
      else if (flow) window.setTimeout(() => void flow.fitView({ padding: .2, duration: 360 }), 40);
    }
    return () => { cancelled = true; };
  }, [view, trace, traceStep, flow, setNodes, setEdges]);
  useEffect(() => {
    if (!view) { setTraces([]); setTrace(undefined); return; }
    void api.traces(view.id).then(items => { setTraces(items); setTrace(current => current?.viewId === view.id ? items.find(item => item.id === current.id) : undefined); }).catch(e => setError(message(e)));
  }, [view?.id]);
  useEffect(() => {
    if (!trace || !playing) return;
    const timer = window.setInterval(() => setTraceStep(current => { if (current >= trace.steps.length - 1) { setPlaying(false); return current; } return current + 1; }), 2400);
    return () => window.clearInterval(timer);
  }, [trace, playing]);
  useEffect(() => {
    const step = trace?.steps[traceStep]; if (!step || !flow || !view) return;
    const node = view.nodes.find(item => item.id === step.nodeId); if (node) flow.setCenter(node.position.x + 115, node.position.y + 47, { zoom: 1, duration: 520 });
  }, [trace, traceStep, flow, view]);
  useEffect(() => { if (!view) return; const timer = window.setInterval(() => void api.view(view.id).then(next => { if (next.revision !== view.revision) setView(next); }).catch(() => undefined), 5000); return () => clearInterval(timer); }, [view]);
  useEffect(() => {
    if (!repo || query.trim().length < 2) { setResults([]); return; }
    const timer = window.setTimeout(() => void api.search(repo.id, query).then(setResults).catch(e => setError(message(e))), 180);
    return () => clearTimeout(timer);
  }, [repo, query]);

  async function chooseResult(result: KnowledgeSearchResult) {
    if (result.viewId) {
      const target = views.find(item => item.id === result.viewId) ?? await api.view(result.viewId);
      setView(target); setSelected(result.nodeId ? target.nodes.find(node => node.id === result.nodeId) : undefined); setQuery(""); setResults([]); setMobileNav(false);
      if (result.nodeId) window.setTimeout(() => { const node = target.nodes.find(item => item.id === result.nodeId); if (node) flow?.setCenter(node.position.x + 115, node.position.y + 47, { zoom: 1, duration: 450 }); }, 80);
    }
  }
  async function arrange() {
    if (!view || !nodes.length) return;
    try { const arranged = await layoutGraph(nodes, edges); setNodes(arranged.nodes); setEdges(current => current.map(edge => ({ ...edge, data: { ...edge.data, route: arranged.routes.find(item => item.id === edge.id)?.route } })));
      const next = await api.updatePositions(view.id, view.revision, arranged.nodes.map(node => ({ id: node.id, ...node.position })), { routes: arranged.routes }); setView(next); window.setTimeout(() => void flow?.fitView({ padding: .2, duration: 450 }), 50); }
    catch (e) { setError(message(e)); }
  }
  async function savePosition(_event: unknown, node: Node) {
    if (!view) return;
    try { const next = await api.updatePositions(view.id, view.revision, [{ id: node.id, ...node.position }], { clearRoutes: true }); setView(next); }
    catch (e) { setError(message(e)); }
  }
  async function duplicateCurrent() {
    if (!view || !repo) return; setViewMenu(false);
    try { const copy = await api.duplicateView(view.id); await refreshViews(repo, copy.id); }
    catch (e) { setError(message(e)); }
  }
  async function archiveCurrent() {
    if (!view || !repo) return; setViewMenu(false);
    try { await api.archiveView(view.id, view.revision); setSelected(undefined); await refreshViews(repo); }
    catch (e) { setError(message(e)); }
  }
  function openView(item: KnowledgeView) {
    if (view && flow) viewportByView.current.set(view.id, flow.getViewport());
    pendingViewport.current = viewportByView.current.get(item.id);
    setView(item); setSelected(undefined); setMobileNav(false);
  }
  function selectView(item: KnowledgeView) { openView(item); }
  async function openViewById(id: string) { openView(views.find(item => item.id === id) ?? await api.view(id)); }
  async function drillInto(item: ViewNode) {
    if (!view) return;
    try {
      const child = item.childViewId ? await api.view(item.childViewId) : await api.drilldown(view.id, item.id);
      setViews(current => current.some(saved => saved.id === child.id) ? current.map(saved => saved.id === child.id ? child : saved) : [child, ...current]);
      openView(child);
    } catch (e) { setError(message(e)); }
  }
  if (loading) return <div className="center-state"><LoaderCircle className="spin" /><span>Opening Cartograph</span></div>;
  if (!repositories.length) return <Onboarding onComplete={refreshRepositories} setup={setup} user={user} />;
  return <main className="shell">
    {mobileNav && <button className="nav-backdrop" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
      <div className="brand"><div className="brand-mark"><Map size={17} /></div><b>Cartograph</b>{user && <div className="account-control"><button aria-label="Account menu" onClick={() => setAccountOpen(value => !value)}>{initials(user.name)}</button>{accountOpen && <div className="account-menu"><span><b>{user.name}</b><small>{user.email}</small></span><button onClick={() => void signOut()}><LogOut size={12}/>Sign out</button></div>}</div>}<button className="mobile-close" aria-label="Close navigation" onClick={() => setMobileNav(false)}><X size={16}/></button></div>
      <div className="repo-control">
        <button className="repo-switcher" aria-expanded={repoMenu} onClick={() => setRepoMenu(value => !value)}><FolderGit2 size={15} /><span><small>Repository</small><b>{repo?.name}</b><em>{repo?.rootPath ?? repo?.externalId}</em></span><ChevronDown size={14} /></button>
        {repoMenu && <div className="repo-menu">{repositories.map(item => <div className="repo-menu-item" key={item.id}><button className={item.id === repo?.id ? "active" : ""} onClick={() => { setRepo(item); setRepoMenu(false); setSelected(undefined); }}><FolderGit2 size={13}/><span>{item.name}<small>{item.rootPath ?? item.externalId}</small></span></button><button className="repo-delete" aria-label={`Remove ${item.name}`} title={`Remove ${item.name}`} onClick={() => { setRepositoryToDelete(item); setRepoMenu(false); }}><Trash2 size={13}/></button></div>)}</div>}
      </div>
      <div className="search"><Search size={14} /><input aria-label="Search knowledge" placeholder="Search views and nodes" value={query} onChange={event => setQuery(event.target.value)} />{query && <button aria-label="Clear search" onClick={() => setQuery("")}><X size={12}/></button>}</div>
      {query.trim().length >= 2 && <div className="search-results">{results.length ? results.map(result => <button onClick={() => void chooseResult(result)} key={result.id}><i>{result.type}</i><span>{result.label}<small>{result.detail}</small></span></button>) : <p>No knowledge found</p>}</div>}
      <div className="nav-label"><span>Agent-created views</span></div>
      <nav className="view-list">{views.filter(item => !item.parentViewId).map(item => <button className={item.id === view?.id || Boolean(view?.ancestors.some(ancestor => ancestor.viewId === item.id)) ? "active" : ""} onClick={() => selectView(item)} key={item.id}><GitBranch size={14} /><span>{item.title}<small>{item.nodes.length} entities · v{item.revision}</small></span></button>)}</nav>
      {!views.length && <div className="empty-nav"><Unplug size={18} /><p>No views yet.</p><small>Ask your connected agent to map a feature.</small></div>}
      <button className={`connection ${connection.connected ? "connected" : ""}`} onClick={() => setSetupOpen(true)}><span className="live-dot" /><span><b>{connection.connected ? "Agent connected" : "Connect an agent"}</b><small>{connection.connected ? `Active ${connection.lastActivityAt ? relativeTime(connection.lastActivityAt) : "now"}` : "Set up Codex or Claude Code"}</small></span><ChevronRight size={12}/></button>
    </aside>
    <section className="workspace">
      <header className="topbar">
        {view && <label className={`trace-select ${trace ? "active" : ""}`}><Workflow size={14}/><select aria-label="Trace mode" value={trace?.id ?? ""} onChange={event => { const next = traces.find(item => item.id === event.target.value); setTrace(next); setTraceStep(0); setPlaying(false); }}><option value="">Trace mode</option>{traces.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select><ChevronDown size={11}/></label>}
        <button className="mobile-nav-button" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu size={18}/></button>
        <div className="title-block">{view?.ancestors.length ? <div className="map-path"><button aria-label="Go back one level" onClick={() => void openViewById(view.ancestors.at(-1)!.viewId)}><ArrowLeft size={12}/></button>{view.ancestors.map(ancestor => <span key={ancestor.viewId}><button onClick={() => void openViewById(ancestor.viewId)}>{ancestor.title}</button><ChevronRight size={10}/></span>)}<b>{view.title}</b></div> : <div className="eyebrow"><span>Knowledge map</span><ArrowRight size={11} /><span>{repo?.name}</span></div>}<h1>{view?.ancestors.length ? view.ancestors.at(-1)?.nodeLabel : view?.title ?? "No view selected"}</h1></div>
        <div className="topbar-actions">{view && <><button className="layout-button" onClick={() => void arrange()} disabled={!nodes.length}><LayoutTemplate size={14}/><span>Arrange</span></button><div className="view-actions"><button aria-label="View actions" onClick={() => setViewMenu(value => !value)}><MoreHorizontal size={17}/></button>{viewMenu && <div className="action-menu"><button onClick={() => { setDialog({ type: "rename", view }); setViewMenu(false); }}><Pencil size={13}/>Rename</button><button onClick={() => void duplicateCurrent()}><Copy size={13}/>Duplicate</button><button onClick={() => void archiveCurrent()}><Archive size={13}/>Archive</button><button className="danger" onClick={() => { setDialog({ type: "delete", view }); setViewMenu(false); }}><Trash2 size={13}/>Delete</button></div>}</div><div className="freshness"><CheckCircle2 size={14} /><span>Revision {view.revision}</span><i /><Clock3 size={13} /><span>{relativeTime(view.updatedAt)}</span></div></>}</div>
      </header>
      <div className="canvas-wrap">
        {view ? <ReactFlow nodes={nodes} edges={edges} onInit={setFlow} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onNodeDragStop={(event, node) => void savePosition(event, node)} onNodeClick={(_, node) => setSelected(node.data.item as ViewNode)} onNodeDoubleClick={(_, node) => void drillInto(node.data.item as ViewNode)} onPaneClick={() => setSelected(undefined)} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={{ padding: .2 }} minZoom={.3} maxZoom={1.8}>
          <Background color="#252925" gap={24} size={1} /><Controls position="bottom-left" showInteractive={false} /><MiniMap position="bottom-right" pannable zoomable nodeColor="#d2ff52" maskColor="rgba(13,15,14,.72)" />
        </ReactFlow> : <AgentStart repository={repo!} connected={connection.connected} openSetup={() => setSetupOpen(true)} />}
        {view && !trace && <div className="legend"><span><i className="source_cited" />Source cited</span><span><i className="inferred" />Inferred</span><span><i className="user_confirmed" />User confirmed</span></div>}
        {trace && <TraceRail trace={trace} index={traceStep} playing={playing} close={() => { setTrace(undefined); setPlaying(false); }} remove={() => { setPlaying(false); setTraceToDelete(trace); }} select={setTraceStep} toggle={() => setPlaying(value => !value)} />}
      </div>
    </section>
    {selected && repo && <Inspector item={selected} close={() => setSelected(undefined)} repository={repo} />}
    {dialog && repo && <ViewDialog state={dialog} close={() => setDialog(undefined)} complete={async next => { setDialog(undefined); await refreshViews(repo, next?.id); }} />}
    {repositoryToDelete && <RepositoryDeleteDialog repository={repositoryToDelete} close={() => setRepositoryToDelete(undefined)} complete={async () => { setRepositoryToDelete(undefined); setView(undefined); setSelected(undefined); setViews([]); await refreshRepositories(); }} />}
    {traceToDelete && <TraceDeleteDialog trace={traceToDelete} close={() => setTraceToDelete(undefined)} complete={() => { const deletedId = traceToDelete.id; setTraceToDelete(undefined); setTraces(current => current.filter(item => item.id !== deletedId)); setTrace(current => current?.id === deletedId ? undefined : current); setTraceStep(0); setPlaying(false); }} />}
    {setupOpen && setup && <SetupDrawer setup={setup} connected={connection.connected} close={() => setSetupOpen(false)} />}
    {error && <div className="toast"><span>{error}</span><button onClick={() => setError("")}><X size={14}/></button></div>}
  </main>;
}

const relationshipColors: Record<KnowledgeView["edges"][number]["kind"], string> = { calls: "#7f9db4", imports: "#778b9c", reads: "#63aaa8", writes: "#a486c4", publishes: "#d09a5f", consumes: "#68a9b6", contains: "#7d8780", depends_on: "#8494ae", transforms: "#bb7fa7", returns: "#7fa46d" };
function mapEdges(items: KnowledgeView["edges"], activeId?: string, visited?: Set<string>): Edge[] { return items.map(edge => { const active = edge.id === activeId; const seen = visited?.has(edge.id); const semanticColor = relationshipColors[edge.kind]; const color = active ? "#d2ff52" : seen ? semanticColor : visited ? "#343936" : semanticColor; return { id: edge.id, source: edge.source, target: edge.target, label: edge.label ?? edge.kind.replace("_", " "), type: "routed", data: { route: edge.route, color }, className: active ? "trace-edge-active" : seen ? "trace-edge-visited" : visited ? "trace-edge-dim" : undefined, markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color }, style: { stroke: color, strokeWidth: active ? 2.4 : undefined, strokeDasharray: edge.confidence === "inferred" && !active ? "5 5" : undefined } }; }); }

function TraceRail({ trace, index, playing, close, remove, select, toggle }: { trace: KnowledgeTrace; index: number; playing: boolean; close: () => void; remove: () => void; select: (index: number) => void; toggle: () => void }) {
  const step = trace.steps[index]!;
  const hasBoundary = Boolean(step.receives || step.produces);
  const journey = useRef<HTMLElement>(null);
  useEffect(() => { journey.current?.querySelector<HTMLElement>("[aria-current='step']")?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" }); }, [index]);
  return <section className={`trace-rail ${step.payload ? "has-payload" : ""} ${hasBoundary ? "has-boundary" : ""}`} aria-label={`${trace.title} trace`}>
    <header><div><span>Trace · {index + 1} of {trace.steps.length}</span><h2>{trace.title}</h2></div><div className="trace-header-actions"><button className="trace-delete" aria-label={`Delete ${trace.title} trace`} title="Delete trace" onClick={remove}><Trash2 size={14}/></button><button aria-label="Exit trace mode" title="Exit trace mode" onClick={close}><X size={14}/></button></div></header>
    <nav className="trace-journey" aria-label="Journey overview" ref={journey}>{trace.steps.map((item, stepIndex) => <div className={stepIndex < index ? "visited" : stepIndex === index ? "current" : ""} key={item.id}><button aria-current={stepIndex === index ? "step" : undefined} onClick={() => select(stepIndex)}><i>{String(stepIndex + 1).padStart(2, "0")}</i><span>{item.label}</span></button>{stepIndex < trace.steps.length - 1 && <b aria-hidden="true" />}</div>)}</nav>
    <div className={`trace-story ${step.payload ? "with-payload" : ""} ${hasBoundary ? "with-boundary" : ""}`}><div className="trace-action"><small>{step.label}</small><p>{step.action}</p>{step.evidence[0] && <code>{step.evidence[0].path}{step.evidence[0].startLine ? `:${step.evidence[0].startLine}` : ""}</code>}</div><div className="trace-step-detail">{hasBoundary && <BoundaryFlow step={step} />}{step.payload ? <DataLens key={step.id} payload={step.payload} /> : !hasBoundary && <div className="trace-data"><div><small>Receives</small><pre>{step.input || "—"}</pre></div><ArrowRight size={15}/><div><small>Produces</small><pre>{step.output || "—"}</pre></div></div>}</div></div>
    <footer><button className="trace-play" aria-label={playing ? "Pause trace" : "Play trace"} onClick={toggle}>{playing ? <Pause size={13}/> : <Play size={13}/>}</button><button disabled={index === 0} onClick={() => select(index - 1)}><ArrowLeft size={13}/>Previous</button><span>{step.label}</span><button disabled={index === trace.steps.length - 1} onClick={() => select(index + 1)}>Next<ArrowRight size={13}/></button></footer>
  </section>;
}

function BoundaryFlow({ step }: { step: KnowledgeTrace["steps"][number] }) {
  return <div className="boundary-flow"><Boundary direction="receives" boundary={step.receives} /><div className="boundary-component"><small>Current component</small><b>{step.label}</b></div><Boundary direction="produces" boundary={step.produces} /></div>;
}

function Boundary({ direction, boundary }: { direction: "receives" | "produces"; boundary?: KnowledgeTrace["steps"][number]["receives"] }) {
  if (!boundary) return <div className="boundary empty"><small>{direction === "receives" ? "Receives from" : "Produces to"}</small><b>Not specified</b></div>;
  const evidence = boundary.evidence[0];
  return <div className={`boundary ${direction}`}><small>{direction === "receives" ? "Receives from" : "Produces to"}</small><b>{boundary.endpoint}</b><span>{boundary.data}</span><i>{boundary.via.replaceAll("_", " ")} · {boundary.kind}</i>{evidence && <code>{evidence.path}{evidence.startLine ? `:${evidence.startLine}` : ""}</code>}</div>;
}

function DataLens({ payload }: { payload: NonNullable<KnowledgeTrace["steps"][number]["payload"]> }) {
  const [selected, setSelected] = useState(0);
  const consistency = payload.fields.map(item => payloadFieldConsistencyError(payload, item));
  const fields = payload.fields.filter((item, index) => String(item.operation) !== "passed_through" && !consistency[index]);
  const hiddenCount = payload.fields.length - fields.length; const field = fields[selected] ?? fields[0];
  return <div className="data-lens"><header><span><Braces size={12}/>Data lens</span><div>{hiddenCount > 0 && <strong title="The modifier did not match the before/after payload">{hiddenCount} inconsistent modifier{hiddenCount === 1 ? "" : "s"} hidden</strong>}<i>{payload.format}</i></div></header><div className="payload-diff"><div><small>Before</small><pre>{formatPayload(payload.before)}</pre></div><ArrowRight size={14}/><div><small>After</small><pre>{formatPayload(payload.after)}</pre></div></div>{fields.length > 0 && <div className="field-changes"><nav aria-label="Payload field changes">{fields.map((item, itemIndex) => <button className={`${item.operation} ${itemIndex === selected ? "active" : ""}`} key={`${item.path}-${itemIndex}`} onClick={() => setSelected(itemIndex)}><i>{operationMark(item.operation)}</i><span>{item.path}</span><small>{item.operation.replace("_", " ")}</small></button>)}</nav>{field && <aside><b>{field.path}</b><p>{field.explanation}</p>{(field.before !== undefined || field.after !== undefined) && <code>{formatInline(field.before)} <ArrowRight size={10}/> {formatInline(field.after)}</code>}{field.evidence[0] && <em>{field.evidence[0].path}{field.evidence[0].startLine ? `:${field.evidence[0].startLine}` : ""}</em>}</aside>}</div>}</div>;
}

export function formatPayload(value: unknown) {
  const normalized = parseJsonString(value);
  return typeof normalized === "string" ? normalized : JSON.stringify(normalized, null, 2);
}
function formatInline(value: unknown) {
  if (value === undefined) return "—";
  const normalized = parseJsonString(value);
  return typeof normalized === "string" ? normalized : JSON.stringify(normalized, null, 2);
}
function parseJsonString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") && trimmed.endsWith("}")) && !(trimmed.startsWith("[") && trimmed.endsWith("]"))) return value;
  try { return JSON.parse(trimmed) as unknown; } catch { return value; }
}
function operationMark(operation: NonNullable<KnowledgeTrace["steps"][number]["payload"]>["fields"][number]["operation"]) { return operation === "added" ? "+" : operation === "removed" ? "−" : operation === "modified" ? "~" : operation === "read" ? "↳" : operation === "persisted" ? "↓" : operation === "redacted" ? "×" : "="; }

function ViewDialog({ state, close, complete }: { state: DialogState; close: () => void; complete: (view?: KnowledgeView) => Promise<void> }) {
  const target = state.view; const [title, setTitle] = useState(target.title); const [description, setDescription] = useState(target.description); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: React.FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { if (state.type === "delete") { await api.deleteView(target.id); await complete(); } else await complete(await api.updateView(target.id, { title, description, expectedRevision: target.revision })); } catch (cause) { setError(message(cause)); setBusy(false); } }
  return <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><form className="dialog" onSubmit={submit} role="dialog" aria-modal="true" aria-label={state.type === "rename" ? "Rename view" : "Delete view"}><header><div><small>{state.type === "rename" ? "View details" : "Permanent action"}</small><h2>{state.type === "rename" ? "Rename view" : `Delete ${target.title}?`}</h2></div><button type="button" onClick={close}><X size={16}/></button></header>{state.type === "delete" ? <p>This permanently removes the view, its nodes, and its relationships. This cannot be undone.</p> : <><label>Title<input autoFocus value={title} onChange={event => setTitle(event.target.value)} required minLength={2}/></label><label>Description<textarea value={description} onChange={event => setDescription(event.target.value)} rows={3}/></label></>}{error && <small className="form-error">{error}</small>}<footer><button type="button" onClick={close}>Cancel</button><button className={state.type === "delete" ? "danger" : "primary"} disabled={busy}>{busy ? "Working…" : state.type === "delete" ? "Delete view" : "Save"}</button></footer></form></div>;
}

function RepositoryDeleteDialog({ repository, close, complete }: { repository: Repository; close: () => void; complete: () => Promise<void> }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: React.FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { await api.deleteRepository(repository.id); await complete(); } catch (cause) { setError(message(cause)); setBusy(false); } }
  return <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><form className="dialog" onSubmit={submit} role="dialog" aria-modal="true" aria-label="Remove repository"><header><div><small>Remove repository</small><h2>Remove {repository.name}?</h2></div><button type="button" onClick={close}><X size={16}/></button></header><p>This removes its saved maps, drill-downs, and traces from Cartograph. Files in the repository are not changed.</p>{error && <small className="form-error">{error}</small>}<footer><button type="button" onClick={close}>Cancel</button><button className="danger" disabled={busy}>{busy ? "Removing…" : "Remove repository"}</button></footer></form></div>;
}

function TraceDeleteDialog({ trace, close, complete }: { trace: KnowledgeTrace; close: () => void; complete: () => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: React.FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { await api.deleteTrace(trace.id); complete(); } catch (cause) { setError(message(cause)); setBusy(false); } }
  return <div className="dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><form className="dialog" onSubmit={submit} role="dialog" aria-modal="true" aria-label="Delete trace"><header><div><small>Permanent action</small><h2>Delete {trace.title}?</h2></div><button type="button" onClick={close}><X size={16}/></button></header><p>This permanently removes this saved trace. The knowledge map and its views are not affected.</p>{error && <small className="form-error">{error}</small>}<footer><button type="button" onClick={close}>Cancel</button><button className="danger" disabled={busy}>{busy ? "Deleting…" : "Delete trace"}</button></footer></form></div>;
}

function Onboarding({ onComplete, setup, user }: { onComplete: () => void; setup?: AppSetup; user?: { name: string } }) {
  const [path, setPath] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [dragging, setDragging] = useState(false);
  async function submit(e: React.FormEvent) { e.preventDefault(); setBusy(true); setError(""); try { await api.register(setup?.hosted ? { name: path } : path); await onComplete(); } catch (err) { setError(message(err)); } finally { setBusy(false); } }
  function drop(event: React.DragEvent<HTMLDivElement>) { event.preventDefault(); setDragging(false); const droppedPath = repositoryPathFromDrop(event.dataTransfer); if (droppedPath) { setPath(droppedPath); setError(""); } else setError("This browser did not expose the folder’s absolute path. Copy its absolute path and paste it here."); }
  return <main className="onboarding"><div className="onboard-brand"><Map size={18}/><b>Cartograph</b>{user && <span>Signed in as {user.name}</span>}</div><section><div className="kicker"><Sparkles size={14}/>Persistent code understanding</div><h1>Turn agent investigations into maps you can keep.</h1><p>Create a repository workspace, then connect Codex, Claude Code, or another MCP client.</p><form onSubmit={submit}><label>{setup?.hosted ? "Repository name" : "Absolute repository path"}</label><div className={dragging ? "dragging" : ""} onDragEnter={event => { if (!setup?.hosted) { event.preventDefault(); setDragging(true); } }} onDragOver={event => event.preventDefault()} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) setDragging(false); }} onDrop={setup?.hosted ? undefined : drop}><Code2 size={17}/><input value={path} onChange={e => setPath(e.target.value)} placeholder={setup?.hosted ? "cartograph-v2" : "/Users/you/code/repository"} required/><button disabled={busy}>{busy ? <LoaderCircle className="spin" size={17}/> : "Create workspace"}</button></div><small className="path-hint">{setup?.hosted ? "Use the repository name your coding agent will recognize. No source code is uploaded." : "Cartograph stores the path without scanning or parsing your code."}</small>{error && <small className="form-error">{error}</small>}</form></section><footer>{setup?.hosted ? "Cloud workspace · Source stays with your agent · Google-secured" : "Local-first · Source stays on your machine · SQLite-backed"}</footer></main>;
}
function repositoryPathFromDrop(data: DataTransfer): string | undefined {
  const file = data.files[0] as (File & { path?: string }) | undefined;
  if (file?.path && (file.path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(file.path) || file.path.startsWith("\\\\"))) return file.path;
  const uri = data.getData("text/uri-list").split("\n").find(value => value.startsWith("file://"));
  if (!uri) return undefined;
  try { return decodeURIComponent(new URL(uri).pathname); } catch { return undefined; }
}
const starters = [
  { id: "architecture", icon: Map, title: "Map the architecture", detail: "Major systems, boundaries, and dependencies", task: "Map the repository architecture. Create a compact top-level Cartograph view of the major systems, boundaries, and dependencies. Cite repository-relative source files for each component and relationship when available." },
  { id: "feature", icon: Code2, title: "Explain a feature", detail: "Find the code behind a capability", task: "Explain a feature in this repository. Ask me which feature to investigate, trace it through the relevant code, then create or extend a focused Cartograph view with concise source references." },
  { id: "request", icon: Route, title: "Trace a request", detail: "Follow data through the runtime path", task: "Trace an important request or event through this repository. Ask me which entry point to use, create or reuse a Cartograph view, then save a step-by-step trace with runtime boundaries and source references." },
];

function AgentStart({ repository, connected, openSetup }: { repository: Repository; connected: boolean; openSetup: () => void }) {
  const [copied, setCopied] = useState<string>();
  async function copyStarter(id: string, task: string) {
    const target = repository.rootPath ? `repository at ${repository.rootPath}` : `${repository.name} repository`;
    const prompt = `Use Cartograph for the ${target}. Register it if needed, search for relevant existing views first, and reuse prior knowledge where possible. ${task}`;
    await navigator.clipboard.writeText(prompt); setCopied(id); window.setTimeout(() => setCopied(current => current === id ? undefined : current), 1800);
  }
  return <div className="agent-start"><div className="agent-start-heading"><div className="empty-orbit"><Sparkles size={22}/></div><div><span>{connected ? "Agent connected" : "Workspace ready"}</span><h2>Start an investigation</h2><p>{connected ? "Copy a prompt into your agent. New maps will appear here automatically." : "Connect an agent, then use a focused prompt to create the first map."}</p></div></div><div className="starter-list">{starters.map(item => { const Icon = item.icon; return <button key={item.id} onClick={() => void copyStarter(item.id, item.task)}><Icon size={16}/><span><b>{item.title}</b><small>{item.detail}</small></span>{copied === item.id ? <Check className="starter-check" size={15}/> : <Copy size={13}/>}</button>; })}</div><footer>{!connected && <button onClick={openSetup}><Terminal size={14}/>Connect Codex or Claude Code</button>}<small>{copied ? "Prompt copied — paste it into your agent" : connected ? "Waiting for a Cartograph tool call" : "Repository source is read by your agent, not Cartograph"}</small></footer></div>;
}

function SetupDrawer({ setup, connected, close }: { setup: AppSetup; connected: boolean; close: () => void }) {
  const [client, setClient] = useState<"codex" | "claude">("codex"); const [copied, setCopied] = useState(false); const [tokenCopied, setTokenCopied] = useState(false); const [secret, setSecret] = useState<string>(); const [generating, setGenerating] = useState(false); const [error, setError] = useState("");
  const command = setup.hosted ? secret ? `cartograph login --url ${setup.mcpUrl}` : "Generate a connection token to reveal the command." : `codex mcp add cartograph -- npm --prefix ${shellQuote(setup.projectRoot)} run start:mcp`;
  const config = setup.hosted ? secret ? JSON.stringify({ mcpServers: { cartograph: { type: "http", url: setup.mcpUrl, headers: { Authorization: `Bearer ${secret}` } } } }, null, 2) : "Generate a connection token to reveal the configuration." : JSON.stringify({ mcpServers: { cartograph: { command: "npm", args: ["--prefix", setup.projectRoot, "run", "start:mcp"] } } }, null, 2);
  const value = client === "codex" ? command : config;
  async function copy() { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
  async function copyToken() { if (!secret) return; await navigator.clipboard.writeText(secret); setTokenCopied(true); window.setTimeout(() => setTokenCopied(false), 1800); }
  async function generate() { setGenerating(true); setError(""); try { const token = await api.createMcpToken(`${client === "codex" ? "Codex" : "Claude Code"} connection`); setSecret(token.secret); } catch (cause) { setError(message(cause)); } finally { setGenerating(false); } }
  return <><button className="drawer-backdrop" aria-label="Close agent setup" onClick={close}/><aside className="setup-drawer" aria-label="Agent setup"><header><div><small>Agent connection</small><h2>Connect Cartograph</h2></div><button aria-label="Close setup" onClick={close}><X size={16}/></button></header><div className={`connection-state ${connected ? "connected" : ""}`}><i/><span><b>{connected ? "Connected" : "Waiting for an agent"}</b><small>{connected ? "Cartograph received an authenticated MCP request." : "Complete setup, then return here to confirm the connection."}</small></span></div><nav aria-label="Agent client"><button className={client === "codex" ? "active" : ""} onClick={() => { setClient("codex"); setCopied(false); }}>Codex</button><button className={client === "claude" ? "active" : ""} onClick={() => { setClient("claude"); setCopied(false); }}>Claude Code</button></nav><section><span>01</span><div><h3>{setup.hosted && !secret ? "Create a secure connection" : client === "codex" ? "Log in from Terminal" : "Add this MCP server"}</h3><p>{setup.hosted && !secret ? "Generate a revocable token. It is shown once and stored only as a secure hash." : client === "codex" ? "Copy the token, run the command, and paste it at the hidden prompt. Cartograph stores it in macOS Keychain and configures Codex." : "Paste this JSON into your Claude Code MCP configuration, then restart the client."}</p>{setup.hosted && !secret ? <button className="generate-token" disabled={generating} onClick={() => void generate()}>{generating ? <LoaderCircle className="spin" size={14}/> : <Terminal size={14}/>}Generate connection token</button> : <><pre><code>{value}</code><button aria-label="Copy setup" onClick={() => void copy()}>{copied ? <Check size={14}/> : <Copy size={14}/>} {copied ? "Copied" : "Copy"}</button></pre>{setup.hosted && client === "codex" && secret && <div className="token-reveal"><span>One-time token</span><code>{secret}</code><button onClick={() => void copyToken()}>{tokenCopied ? <Check size={13}/> : <Copy size={13}/>} {tokenCopied ? "Copied" : "Copy token"}</button></div>}</>}{error && <small className="form-error">{error}</small>}</div></section><section><span>02</span><div><h3>Restart Codex</h3><p>Open the repository in a fresh Codex session. Keychain supplies the token automatically on every launch.</p></div></section><section><span>03</span><div><h3>Create the first map</h3><p>Close this panel and copy one of the starter investigations from the workspace.</p></div></section></aside></>;
}

function shellQuote(value: string) { return `'${value.replaceAll("'", `'\\''`)}'`; }

function Inspector({ item, close, repository }: { item: ViewNode; close: () => void; repository: Repository }) {
  const [editor, setEditor] = useState<EditorPreference>(editorPreference());
  function choose(value: EditorPreference) { setEditor(value); localStorage.setItem("cartograph.editor", value); }
  return <aside className="inspector"><header><div><span>{item.kind}</span><h2>{item.label}</h2></div><button aria-label="Close inspector" onClick={close}><PanelRightClose size={17}/></button></header><section><label>What it does</label><p>{item.summary}</p></section><section><label>Confidence</label><div className={`confidence ${item.confidence}`}><i />{item.confidence.replace("_", " ")}</div></section><section><div className="evidence-heading"><label>Source references</label><select aria-label="Evidence editor" value={repository.rootPath ? editor : "copy"} disabled={!repository.rootPath} onChange={event => choose(event.target.value as EditorPreference)}><option value="vscode">VS Code</option><option value="cursor">Cursor</option><option value="copy">Copy path</option></select></div>{item.evidence.length ? <div className="evidence-list">{item.evidence.map((e, i) => <div className="evidence-row" key={`${e.path}-${i}`}><button onClick={() => void openSource(repository, e, repository.rootPath ? editor : "copy")}><Code2 size={14}/><span>{e.path}<small>{e.startLine ? `Lines ${e.startLine}${e.endLine ? `–${e.endLine}` : ""}` : "File reference"}</small></span>{repository.rootPath && editor !== "copy" ? <ExternalLink size={12}/> : <Copy size={12}/>}</button><button aria-label={`Copy ${e.path}`} onClick={() => void copySource(repository, e)}><Copy size={12}/></button></div>)}</div> : <p className="muted">No source reference attached. Treat this interpretation with care.</p>}</section><footer><GitBranch size={13}/>{repository.rootPath ?? repository.name}</footer></aside>;
}

type EditorPreference = "vscode" | "cursor" | "copy";
const editorPreference = (): EditorPreference => (localStorage.getItem("cartograph.editor") as EditorPreference | null) ?? "vscode";
const absoluteSource = (repository: Repository, evidence: Pick<Evidence, "path" | "startLine">) => `${repository.rootPath ? `${repository.rootPath.replace(/\/$/, "")}/` : ""}${evidence.path}${evidence.startLine ? `:${evidence.startLine}` : ""}`;
async function copySource(repository: Repository, evidence: Pick<Evidence, "path" | "startLine">) { await navigator.clipboard.writeText(absoluteSource(repository, evidence)); }
async function openSource(repository: Repository, evidence: Pick<Evidence, "path" | "startLine">, editor: EditorPreference) { if (editor === "copy") return copySource(repository, evidence); window.location.href = `${editor}://file/${absoluteSource(repository, evidence)}`; }
const message = (e: unknown) => e instanceof Error ? e.message : "Something went wrong";
const initials = (name: string) => name.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase();
function relativeTime(date: string) { const seconds = Math.round((Date.now() - new Date(date).getTime()) / 1000); if (seconds < 60) return "just now"; if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`; if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`; return `${Math.floor(seconds / 86400)}d ago`; }
