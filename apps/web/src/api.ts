import type { KnowledgeSearchResult, KnowledgeTrace, KnowledgeView, Repository } from "@cartograph/shared";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error ?? `Request failed (${response.status})`); }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export const api = {
  repositories: () => request<Repository[]>("/api/repositories"),
  register: (path: string) => request<Repository>("/api/repositories", { method: "POST", body: JSON.stringify({ path }) }),
  deleteRepository: (id: string) => request<void>(`/api/repositories/${id}`, { method: "DELETE" }),
  views: (repositoryId?: string) => request<KnowledgeView[]>(`/api/views${repositoryId ? `?repositoryId=${encodeURIComponent(repositoryId)}` : ""}`),
  view: (id: string) => request<KnowledgeView>(`/api/views/${id}`),
  search: (repositoryId: string, query: string) => request<KnowledgeSearchResult[]>(`/api/repositories/${repositoryId}/search?q=${encodeURIComponent(query)}`),
  drilldown: (viewId: string, nodeId: string) => request<KnowledgeView>(`/api/views/${viewId}/nodes/${encodeURIComponent(nodeId)}/drilldown`, { method: "POST" }),
  traces: (viewId: string) => request<KnowledgeTrace[]>(`/api/views/${viewId}/traces`),
  trace: (id: string) => request<KnowledgeTrace>(`/api/traces/${id}`),
  deleteTrace: (id: string) => request<void>(`/api/traces/${id}`, { method: "DELETE" }),
  updateView: (id: string, body: { title?: string; description?: string; expectedRevision?: number }) => request<KnowledgeView>(`/api/views/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  updatePositions: (id: string, expectedRevision: number, positions: { id: string; x: number; y: number }[], layout?: { routes?: { id: string; route: { points: { x: number; y: number }[]; label?: { x: number; y: number } } }[]; clearRoutes?: boolean }) => request<KnowledgeView>(`/api/views/${id}/positions`, { method: "PATCH", body: JSON.stringify({ expectedRevision, positions, ...layout }) }),
  duplicateView: (id: string) => request<KnowledgeView>(`/api/views/${id}/duplicate`, { method: "POST" }),
  archiveView: (id: string, expectedRevision: number) => request<KnowledgeView>(`/api/views/${id}/archive`, { method: "POST", body: JSON.stringify({ expectedRevision }) }),
  deleteView: (id: string) => request<void>(`/api/views/${id}`, { method: "DELETE" }),
};
