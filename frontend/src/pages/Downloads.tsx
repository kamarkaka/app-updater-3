import { useState, useEffect } from "react";
import { api } from "../api/client";
import type { Download } from "../types";
import StatusBadge from "../components/StatusBadge";
import DownloadProgress from "../components/DownloadProgress";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export default function Downloads() {
  const [downloads, setDownloads] = useState<Download[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const data = await api.getDownloads();
      setDownloads(data);
    } catch {
      // handled
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 2000);
    return () => clearInterval(interval);
  }, []);

  async function handlePause(id: number) {
    await api.pauseDownload(id);
    load();
  }

  async function handleResume(id: number) {
    await api.resumeDownload(id);
    load();
  }

  async function handleCancel(id: number) {
    if (!confirm("Cancel and delete this download?")) return;
    await api.cancelDownload(id);
    load();
  }

  if (loading) return <p className="text-gray-400">Loading...</p>;

  return (
    <div>
      <h1 className="text-xl font-semibold text-white mb-6">Downloads</h1>

      {downloads.length === 0 ? (
        <p className="text-gray-500">No downloads.</p>
      ) : (
        <div className="space-y-3">
          {downloads.map((dl) => (
            <div
              key={dl.id}
              className="rounded border border-gray-800 bg-gray-900 p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-white font-medium">{dl.fileName}</span>
                  <StatusBadge status={dl.status} />
                </div>
                <div className="flex items-center gap-2">
                  {dl.totalBytes && (
                    <span className="text-xs text-gray-500">
                      {formatBytes(dl.totalBytes)}
                    </span>
                  )}
                  <span className="text-xs text-gray-500">v{dl.version}</span>
                </div>
              </div>

              {(dl.status === "downloading" || dl.status === "paused") && (
                <DownloadProgress download={dl} />
              )}

              {dl.errorMessage && (
                <p className="text-xs text-red-400 mt-1">{dl.errorMessage}</p>
              )}

              <div className="flex gap-2 mt-3">
                {dl.status === "downloading" && (
                  <button
                    onClick={() => handlePause(dl.id)}
                    className="px-2 py-1 rounded bg-gray-800 text-gray-300 text-xs hover:bg-gray-700"
                  >
                    Pause
                  </button>
                )}
                {(dl.status === "paused" || dl.status === "failed") && (
                  <button
                    onClick={() => handleResume(dl.id)}
                    className="px-2 py-1 rounded bg-blue-600 text-white text-xs hover:bg-blue-500"
                  >
                    Resume
                  </button>
                )}
                {dl.status !== "completed" && (
                  <button
                    onClick={() => handleCancel(dl.id)}
                    className="px-2 py-1 rounded bg-red-900/50 text-red-400 text-xs hover:bg-red-900"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
