import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api } from "../api/client";
import type { AppWithDownloads } from "../types";
import StatusBadge from "../components/StatusBadge";
import DownloadProgress from "../components/DownloadProgress";

export default function AppDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [app, setApp] = useState<AppWithDownloads | null>(null);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    if (!id) return;
    const data = await api.getApp(parseInt(id));
    setApp(data);
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [id]);

  async function handleCheck() {
    if (!id) return;
    setChecking(true);
    setMessage("");
    try {
      const result = await api.checkApp(parseInt(id));
      setMessage(
        result.hasUpdate
          ? `Update available: ${result.version}`
          : `Up to date: ${result.version}`
      );
      load();
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setChecking(false);
    }
  }

  async function handleDownload() {
    if (!id) return;
    setDownloading(true);
    setMessage("");
    try {
      await api.downloadApp(parseInt(id));
      setMessage("Download started");
      load();
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setDownloading(false);
    }
  }

  async function handleDelete() {
    if (!id || !confirm("Delete this application and all its downloads?"))
      return;
    await api.deleteApp(parseInt(id));
    navigate("/");
  }

  if (!app) return <p className="text-gray-400">Loading...</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white">{app.name}</h1>
          <a
            href={app.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-400 hover:underline"
          >
            {app.url}
          </a>
        </div>
        <StatusBadge status={app.status} />
      </div>

      {message && (
        <div className="mb-4 p-3 rounded bg-gray-800 border border-gray-700 text-sm text-gray-300">
          {message}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <div className="rounded border border-gray-800 bg-gray-900 p-4">
          <span className="text-xs text-gray-500">Current Version</span>
          <p className="text-white font-medium mt-1">
            {app.currentVersion || "—"}
          </p>
        </div>
        <div className="rounded border border-gray-800 bg-gray-900 p-4">
          <span className="text-xs text-gray-500">Latest Version</span>
          <p className="text-white font-medium mt-1">
            {app.latestVersion || "—"}
          </p>
        </div>
        <div className="rounded border border-gray-800 bg-gray-900 p-4">
          <span className="text-xs text-gray-500">Source Type</span>
          <p className="text-white font-medium mt-1">{app.sourceType}</p>
        </div>
        <div className="rounded border border-gray-800 bg-gray-900 p-4">
          <span className="text-xs text-gray-500">Check Interval</span>
          <p className="text-white font-medium mt-1">
            {app.checkIntervalMinutes ?? 720} min
          </p>
        </div>
      </div>

      {app.errorMessage && (
        <div className="mb-4 p-3 rounded bg-red-900/20 border border-red-800 text-sm text-red-400">
          {app.errorMessage}
        </div>
      )}

      <div className="flex gap-2 mb-8">
        <button
          onClick={handleCheck}
          disabled={checking}
          className="px-3 py-1.5 rounded bg-gray-800 text-gray-300 text-sm hover:bg-gray-700 disabled:opacity-50"
        >
          {checking ? "Checking..." : "Check Now"}
        </button>
        <button
          onClick={handleDownload}
          disabled={downloading || !app.latestVersion}
          className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-500 disabled:opacity-50"
        >
          {downloading ? "Starting..." : "Download Latest"}
        </button>
        <Link
          to={`/apps/${id}/edit`}
          className="px-3 py-1.5 rounded bg-gray-800 text-gray-300 text-sm hover:bg-gray-700"
        >
          Edit
        </Link>
        <button
          onClick={handleDelete}
          className="px-3 py-1.5 rounded bg-red-900/50 text-red-400 text-sm hover:bg-red-900"
        >
          Delete
        </button>
      </div>

      <h2 className="text-lg font-medium text-white mb-4">Download History</h2>
      {app.downloads.length === 0 ? (
        <p className="text-gray-500 text-sm">No downloads yet.</p>
      ) : (
        <div className="space-y-3">
          {app.downloads.map((dl) => (
            <div
              key={dl.id}
              className="rounded border border-gray-800 bg-gray-900 p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="text-white font-medium mr-2">
                    v{dl.version}
                  </span>
                  <StatusBadge status={dl.status} />
                </div>
                <span className="text-xs text-gray-500">{dl.fileName}</span>
              </div>
              {(dl.status === "downloading" || dl.status === "paused") && (
                <DownloadProgress download={dl} />
              )}
              {dl.errorMessage && (
                <p className="text-xs text-red-400 mt-1">{dl.errorMessage}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
