import type { Application, AppWithDownloads, Download, CheckResult, Settings, VersionSuggestion } from "../types";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...options?.headers as Record<string, string> };
  if (options?.body) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    if (
      !window.location.pathname.startsWith("/login") &&
      !window.location.pathname.startsWith("/setup")
    ) {
      window.location.href = "/login";
    }
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export const api = {
  // Auth
  getAuthStatus: () => request<{ needsSetup: boolean }>("/api/auth/status"),
  setup: (username: string, password: string) =>
    request<{ ok: boolean }>("/api/auth/setup", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  login: (username: string, password: string) =>
    request<{ ok: boolean }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () =>
    request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  me: () => request<{ userId: number }>("/api/auth/me"),

  // Apps
  getApps: () => request<Application[]>("/api/apps"),
  getApp: (id: number) => request<AppWithDownloads>(`/api/apps/${id}`),
  createApp: (data: Partial<Application>) =>
    request<Application>("/api/apps", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateApp: (id: number, data: Partial<Application>) =>
    request<Application>(`/api/apps/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteApp: (id: number) =>
    request<{ ok: boolean }>(`/api/apps/${id}`, { method: "DELETE" }),
  suggestVersions: (url: string) =>
    request<VersionSuggestion[]>("/api/apps/suggest", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  checkAll: () =>
    request<{ checked: number }>("/api/apps/check-all", { method: "POST" }),
  checkApp: (id: number) =>
    request<CheckResult>(`/api/apps/${id}/check`, { method: "POST" }),
  downloadApp: (id: number) =>
    request<Download>(`/api/apps/${id}/download`, { method: "POST" }),

  // Downloads
  getDownloads: () => request<Download[]>("/api/downloads"),
  getDownload: (id: number) => request<Download>(`/api/downloads/${id}`),
  pauseDownload: (id: number) =>
    request<{ ok: boolean }>(`/api/downloads/${id}/pause`, { method: "POST" }),
  resumeDownload: (id: number) =>
    request<{ ok: boolean }>(`/api/downloads/${id}/resume`, {
      method: "POST",
    }),
  cancelDownload: (id: number) =>
    request<{ ok: boolean }>(`/api/downloads/${id}`, { method: "DELETE" }),

  // Settings
  getSettings: () => request<Settings>("/api/settings"),
  updateSettings: (data: Partial<Settings>) =>
    request<Settings>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
};
