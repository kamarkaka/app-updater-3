import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { Application } from "../types";

const SOURCE_TYPES = [
  { value: "auto", label: "Auto-detect" },
  { value: "github", label: "GitHub" },
  { value: "gitlab", label: "GitLab" },
  { value: "generic", label: "Generic Web" },
];

export default function AppForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [sourceType, setSourceType] = useState("auto");
  const [checkInterval, setCheckInterval] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [versionSelector, setVersionSelector] = useState("");
  const [versionPattern, setVersionPattern] = useState("");
  const [downloadSelector, setDownloadSelector] = useState("");
  const [downloadPattern, setDownloadPattern] = useState("");
  const [assetPattern, setAssetPattern] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.getSettings().then((s) => setCheckInterval(s.checkIntervalMinutes));
  }, []);

  useEffect(() => {
    if (isEdit) {
      api.getApp(parseInt(id)).then((app) => {
        setName(app.name);
        setUrl(app.url);
        setSourceType(app.sourceType);
        setCheckInterval(app.checkIntervalMinutes!);
        setVersionSelector(app.versionSelector ?? "");
        setVersionPattern(app.versionPattern ?? "");
        setDownloadSelector(app.downloadSelector ?? "");
        setDownloadPattern(app.downloadPattern ?? "");
        setAssetPattern(app.assetPattern ?? "");
        if (
          app.versionSelector ||
          app.versionPattern ||
          app.downloadSelector ||
          app.downloadPattern ||
          app.assetPattern
        ) {
          setShowAdvanced(true);
        }
      });
    }
  }, [id, isEdit]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const data: Partial<Application> = {
      name,
      url,
      sourceType,
      checkIntervalMinutes: checkInterval,
      ...(versionSelector && { versionSelector }),
      ...(versionPattern && { versionPattern }),
      ...(downloadSelector && { downloadSelector }),
      ...(downloadPattern && { downloadPattern }),
      ...(assetPattern && { assetPattern }),
    };

    try {
      if (isEdit) {
        await api.updateApp(parseInt(id), data);
      } else {
        await api.createApp(data);
      }
      navigate("/");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-semibold text-white mb-6">
        {isEdit ? "Edit Application" : "Add Application"}
      </h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 rounded bg-red-900/30 border border-red-800 text-red-400 text-sm">
            {error}
          </div>
        )}

        <label className="block">
          <span className="text-sm text-gray-400">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Visual Studio Code"
            className="mt-1 block w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            required
          />
        </label>

        <label className="block">
          <span className="text-sm text-gray-400">URL</span>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="e.g., https://github.com/user/repo"
            className="mt-1 block w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            required
          />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm text-gray-400">Source Type</span>
            <select
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value)}
              className="mt-1 block w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            >
              {SOURCE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm text-gray-400">
              Check Interval (minutes)
            </span>
            <input
              type="number"
              value={checkInterval}
              onChange={(e) => setCheckInterval(parseInt(e.target.value))}
              min={1}
              className="mt-1 block w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            />
          </label>
        </div>

        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-sm text-gray-400 hover:text-white"
        >
          {showAdvanced ? "Hide" : "Show"} Advanced Options
        </button>

        {showAdvanced && (
          <div className="space-y-3 border border-gray-800 rounded-lg p-4">
            <p className="text-xs text-gray-500 mb-2">
              Override auto-detection with CSS selectors and regex patterns.
            </p>

            <label className="block">
              <span className="text-xs text-gray-400">Version CSS Selector</span>
              <input
                type="text"
                value={versionSelector}
                onChange={(e) => setVersionSelector(e.target.value)}
                placeholder="e.g., .release-version"
                className="mt-1 block w-full rounded bg-gray-800 border border-gray-700 px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </label>

            <label className="block">
              <span className="text-xs text-gray-400">Version Regex</span>
              <input
                type="text"
                value={versionPattern}
                onChange={(e) => setVersionPattern(e.target.value)}
                placeholder="e.g., (\d+\.\d+\.\d+)"
                className="mt-1 block w-full rounded bg-gray-800 border border-gray-700 px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </label>

            <label className="block">
              <span className="text-xs text-gray-400">
                Download Link CSS Selector
              </span>
              <input
                type="text"
                value={downloadSelector}
                onChange={(e) => setDownloadSelector(e.target.value)}
                placeholder="e.g., a.download-btn"
                className="mt-1 block w-full rounded bg-gray-800 border border-gray-700 px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </label>

            <label className="block">
              <span className="text-xs text-gray-400">
                Download URL Filter Regex
              </span>
              <input
                type="text"
                value={downloadPattern}
                onChange={(e) => setDownloadPattern(e.target.value)}
                placeholder="e.g., \.dmg$"
                className="mt-1 block w-full rounded bg-gray-800 border border-gray-700 px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </label>

            <label className="block">
              <span className="text-xs text-gray-400">
                Asset Pattern (for GitHub/multi-asset pages)
              </span>
              <input
                type="text"
                value={assetPattern}
                onChange={(e) => setAssetPattern(e.target.value)}
                placeholder="e.g., linux.*amd64"
                className="mt-1 block w-full rounded bg-gray-800 border border-gray-700 px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </label>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 rounded bg-blue-600 text-white font-medium hover:bg-blue-500 disabled:opacity-50"
          >
            {loading ? "Saving..." : isEdit ? "Save Changes" : "Add Application"}
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="px-4 py-2 rounded bg-gray-800 text-gray-300 hover:bg-gray-700"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
