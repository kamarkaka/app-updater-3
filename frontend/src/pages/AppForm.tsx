import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { Application, VersionSuggestion } from "../types";

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

  // Suggestion state
  const [suggestions, setSuggestions] = useState<VersionSuggestion[]>([]);
  const [detecting, setDetecting] = useState(false);

  const isGitHub = sourceType === "github" || /github\.com/i.test(url);

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

  async function handleDetect() {
    if (!url) return;
    setDetecting(true);
    setSuggestions([]);
    setError("");
    try {
      const results = await api.suggestVersions(url);
      setSuggestions(results);
      if (results.length === 0) {
        setError("No versions detected on this page.");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDetecting(false);
    }
  }

  function applySuggestion(s: VersionSuggestion) {
    setVersionSelector(s.selector);
    setVersionPattern(s.pattern);
    setShowAdvanced(true);
  }

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

        {!isGitHub && (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleDetect}
                disabled={detecting || !url}
                className="px-3 py-1.5 rounded bg-gray-700 text-gray-300 text-sm hover:bg-gray-600 disabled:opacity-50"
              >
                {detecting ? "Detecting..." : "Detect Versions"}
              </button>
              {suggestions.length > 0 && (
                <span className="text-xs text-gray-500">
                  {suggestions.length} version(s) found — click "Use" to apply
                </span>
              )}
            </div>

            {suggestions.length > 0 && (
              <div className="space-y-1">
                {suggestions.slice(0, 10).map((s, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded bg-gray-800/50 border border-gray-800 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="text-white font-mono mr-3">
                        {s.version}
                      </span>
                      <span className="text-gray-500 text-xs truncate">
                        {s.context}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => applySuggestion(s)}
                      className="text-xs text-blue-400 hover:text-blue-300 ml-3 shrink-0"
                    >
                      Use
                    </button>
                  </div>
                ))}
              </div>
            )}

            {!versionSelector && !versionPattern && (
              <p className="text-xs text-amber-500/80">
                Version selector and pattern are required for non-GitHub sources.
              </p>
            )}
          </div>
        )}

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
              CSS selectors and regex patterns for version and download detection.
            </p>

            <label className="block">
              <span className="text-xs text-gray-400">Version CSS Selector</span>
              <input
                type="text"
                value={versionSelector}
                onChange={(e) => setVersionSelector(e.target.value)}
                placeholder="e.g., h2.release-title"
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
