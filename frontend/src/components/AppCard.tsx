import { Link } from "react-router-dom";
import type { Application } from "../types";
import StatusBadge from "./StatusBadge";

function getAppStatus(app: Application): string {
  if (app.status === "error") return "error";
  if (app.status === "paused") return "paused";
  if (app.latestVersion && app.currentVersion !== app.latestVersion)
    return "update-available";
  return "up-to-date";
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "never";
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function AppCard({ app }: { app: Application }) {
  const displayStatus = getAppStatus(app);

  return (
    <Link
      to={`/apps/${app.id}`}
      className="block rounded-lg border border-gray-800 bg-gray-900 p-4 hover:border-gray-700 transition-colors"
    >
      <div className="flex items-start justify-between mb-3">
        <h3 className="font-medium text-white truncate mr-2">{app.name}</h3>
        <StatusBadge status={displayStatus} />
      </div>

      <div className="space-y-1 text-sm text-gray-400">
        <div className="flex justify-between">
          <span>Current</span>
          <span className="text-gray-300">
            {app.currentVersion || "—"}
          </span>
        </div>
        {app.latestVersion && app.latestVersion !== app.currentVersion && (
          <div className="flex justify-between">
            <span>Latest</span>
            <span className="text-blue-400">{app.latestVersion}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>Checked</span>
          <span>{timeAgo(app.lastCheckedAt)}</span>
        </div>
      </div>

      {app.errorMessage && (
        <p className="mt-2 text-xs text-red-400 truncate">{app.errorMessage}</p>
      )}

      <p className="mt-2 text-xs text-gray-600 truncate">{app.url}</p>
    </Link>
  );
}
