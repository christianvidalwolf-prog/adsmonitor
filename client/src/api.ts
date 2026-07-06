import type {
  ActionEvaluation,
  ActionInput,
  ActionRecommendation,
  ActionRow,
  CommitResult,
  CommitRequest,
  ImportPreview,
  RecommendationDataCoverage,
  Settings,
} from "@shared";
import {
  buildCampaignRows,
  buildDashboard,
  buildKeywordRows,
  buildSearchTermRows,
  deleteStoredImport,
  getStoredSettings,
  listStoredImports,
  saveCommittedImport,
  saveStoredSettings,
} from "./localData";

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any) {
    super(body?.error ?? `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body);
  if (body === null) {
    throw new ApiError(res.status, {
      error:
        "La API no devolvió JSON. Revisa que el backend esté levantado y que /api no apunte al frontend.",
    });
  }
  return body as T;
}

const qs = (marketplaces: string[]) =>
  marketplaces.length ? `?marketplaces=${marketplaces.join(",")}` : "";

export const api = {
  previewImport(file: File): Promise<ImportPreview[]> {
    const fd = new FormData();
    fd.append("file", file);
    return request("/api/imports/preview", { method: "POST", body: fd });
  },
  commitImport(body: CommitRequest) {
    return request<CommitResult>(
      "/api/imports/commit",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    ).then((result) => {
      saveCommittedImport(result);
      return result;
    });
  },
  listImports: async () => listStoredImports(),
  deleteImport: async (id: number) => {
    deleteStoredImport(id);
    return { deleted: true as const };
  },
  dashboard: async (m: string[]) => buildDashboard(m),
  campaigns: async (m: string[]) => buildCampaignRows(m),
  keywords: async (m: string[]) => buildKeywordRows(m),
  searchTerms: async (m: string[]) => buildSearchTermRows(m),
  getSettings: async () => getStoredSettings(),
  saveSettings: async (s: Settings) => saveStoredSettings(s),
  actions: (m: string[]) => request<ActionRow[]>(`/api/actions${qs(m)}`),
  actionRecommendations: (m: string[]) =>
    request<ActionRecommendation[]>(`/api/actions/recommendations${qs(m)}`),
  actionRecommendationCoverage: (m: string[]) =>
    request<RecommendationDataCoverage>(
      `/api/actions/recommendations/coverage${qs(m)}`
    ),
  createAction: (body: ActionInput) =>
    request<ActionRow>("/api/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  updateAction: (id: number, body: Partial<ActionInput>) =>
    request<ActionRow>(`/api/actions/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  deleteAction: (id: number) =>
    request<{ deleted: true }>(`/api/actions/${id}`, { method: "DELETE" }),
  evaluateAction: (id: number) =>
    request<ActionEvaluation>(`/api/actions/${id}/evaluate`, { method: "POST" }),
};
