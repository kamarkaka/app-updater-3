import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Application } from "../types";
import AppCard, { getAppStatus, timeAgo } from "../components/AppCard";
import SourceIcon from "../components/SourceIcon";
import StatusBadge from "../components/StatusBadge";
import { HiOutlineArrowPath } from "react-icons/hi2";

type ViewMode = "grid" | "list";
const VIEW_STORAGE_KEY = "app-updater-view";

export default function Dashboard() {
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem(VIEW_STORAGE_KEY) as ViewMode) || "grid"
  );

  const [checkingAll, setCheckingAll] = useState(false);

  async function handleCheckAll() {
    setCheckingAll(true);
    try {
      await api.checkAll();
      await loadApps();
    } catch {
      // errors shown per-app via status
    } finally {
      setCheckingAll(false);
    }
  }

  function switchView(mode: ViewMode) {
    setViewMode(mode);
    localStorage.setItem(VIEW_STORAGE_KEY, mode);
  }

  async function loadApps() {
    try {
      const data = await api.getApps();
      setApps(data);
    } catch {
      // handled by api client (401 redirect)
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadApps();
    const interval = setInterval(loadApps, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return <p className="text-gray-400">Loading...</p>;
  }

  if (apps.length === 0) {
    return (
      <div className="text-center py-20">
        <h2 className="text-xl text-gray-300 mb-2">No applications yet</h2>
        <p className="text-gray-500 mb-6">
          Add an application to start monitoring for updates.
        </p>
        <Link
          to="/apps/new"
          className="inline-block px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-500"
        >
          Add Application
        </Link>
      </div>
    );
  }

  function needsAttention(app: Application): boolean {
    if (app.status === "error") return true;
    if (app.latestVersion && app.currentVersion !== app.latestVersion) return true;
    if (!app.lastCheckedAt) return true;
    return false;
  }

  const attention = apps.filter(needsAttention);
  const upToDate = apps.filter((app) => !needsAttention(app));

  function renderGrid(items: Application[]) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((app) => (
          <AppCard key={app.id} app={app} />
        ))}
      </div>
    );
  }

  function renderList(items: Application[]) {
    return (
      <div className="rounded-lg border border-gray-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900/50 text-gray-400 text-xs uppercase tracking-wider">
              <th className="text-left px-4 py-3 font-medium">Name</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Current</th>
              <th className="text-left px-4 py-3 font-medium">Latest</th>
              <th className="text-left px-4 py-3 font-medium">Checked</th>
              <th className="text-left px-4 py-3 font-medium">URL</th>
            </tr>
          </thead>
          <tbody>
            {items.map((app) => {
              const status = getAppStatus(app);
              return (
                <tr
                  key={app.id}
                  className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      to={`/apps/${app.id}`}
                      className="text-white font-medium hover:text-blue-400 inline-flex items-center gap-1.5"
                    >
                      <SourceIcon sourceType={app.sourceType} />
                      {app.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={status} />
                  </td>
                  <td className="px-4 py-3 text-gray-300 font-mono">
                    {app.currentVersion || "—"}
                  </td>
                  <td className="px-4 py-3 font-mono">
                    {app.latestVersion && app.latestVersion !== app.currentVersion ? (
                      <span className="text-blue-400">{app.latestVersion}</span>
                    ) : (
                      <span className="text-gray-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {timeAgo(app.lastCheckedAt)}
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={app.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-500 hover:text-blue-400 truncate block max-w-[200px]"
                    >
                      {app.url}
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  function renderSection(title: string, items: Application[]) {
    if (items.length === 0) return null;
    return (
      <section className="mb-8">
        <h2 className="text-sm font-medium text-gray-400 mb-3">
          {title}
          <span className="ml-2 text-gray-600">{items.length}</span>
        </h2>
        {viewMode === "grid" ? renderGrid(items) : renderList(items)}
      </section>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-white">Applications</h1>
        <div className="flex items-center gap-3">
          <div className="flex rounded border border-gray-700 overflow-hidden">
            <button
              onClick={() => switchView("grid")}
              className={`px-2.5 py-1.5 text-sm ${
                viewMode === "grid"
                  ? "bg-gray-700 text-white"
                  : "bg-gray-900 text-gray-400 hover:text-gray-300"
              }`}
              title="Grid view"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
                <path d="M1 2.5A1.5 1.5 0 012.5 1h3A1.5 1.5 0 017 2.5v3A1.5 1.5 0 015.5 7h-3A1.5 1.5 0 011 5.5v-3zm8 0A1.5 1.5 0 0110.5 1h3A1.5 1.5 0 0115 2.5v3A1.5 1.5 0 0113.5 7h-3A1.5 1.5 0 019 5.5v-3zm-8 8A1.5 1.5 0 012.5 9h3A1.5 1.5 0 017 10.5v3A1.5 1.5 0 015.5 15h-3A1.5 1.5 0 011 13.5v-3zm8 0A1.5 1.5 0 0110.5 9h3a1.5 1.5 0 011.5 1.5v3a1.5 1.5 0 01-1.5 1.5h-3A1.5 1.5 0 019 13.5v-3z" />
              </svg>
            </button>
            <button
              onClick={() => switchView("list")}
              className={`px-2.5 py-1.5 text-sm ${
                viewMode === "list"
                  ? "bg-gray-700 text-white"
                  : "bg-gray-900 text-gray-400 hover:text-gray-300"
              }`}
              title="List view"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
                <path fillRule="evenodd" d="M2.5 12a.5.5 0 01.5-.5h10a.5.5 0 010 1H3a.5.5 0 01-.5-.5zm0-4a.5.5 0 01.5-.5h10a.5.5 0 010 1H3a.5.5 0 01-.5-.5zm0-4a.5.5 0 01.5-.5h10a.5.5 0 010 1H3a.5.5 0 01-.5-.5z" />
              </svg>
            </button>
          </div>
          <button
            onClick={handleCheckAll}
            disabled={checkingAll}
            className="px-3 py-1.5 rounded bg-gray-800 text-gray-300 text-sm hover:bg-gray-700 disabled:opacity-50 inline-flex items-center gap-1.5"
            title="Check all apps for updates"
          >
            <HiOutlineArrowPath className={`w-4 h-4 ${checkingAll ? "animate-spin" : ""}`} />
            Check All
          </button>
          <Link
            to="/apps/new"
            className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-500"
          >
            Add App
          </Link>
        </div>
      </div>

      {renderSection("Needs Attention", attention)}
      {renderSection("Up to Date", upToDate)}
    </div>
  );
}
