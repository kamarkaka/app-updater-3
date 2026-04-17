import type { Download } from "../types";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export default function DownloadProgress({ download }: { download: Download }) {
  const downloaded = download.downloadedBytes ?? 0;
  const total = download.totalBytes ?? 0;
  const percent = total > 0 ? Math.round((downloaded / total) * 100) : 0;

  return (
    <div className="w-full">
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span>
          {formatBytes(downloaded)}
          {total > 0 && ` / ${formatBytes(total)}`}
        </span>
        {total > 0 && <span>{percent}%</span>}
      </div>
      <div className="w-full bg-gray-800 rounded-full h-2">
        <div
          className="bg-blue-500 h-2 rounded-full transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
