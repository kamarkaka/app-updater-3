const statusStyles: Record<string, string> = {
  active: "bg-green-900/50 text-green-400 border-green-800",
  paused: "bg-yellow-900/50 text-yellow-400 border-yellow-800",
  error: "bg-red-900/50 text-red-400 border-red-800",
  "up-to-date": "bg-green-900/50 text-green-400 border-green-800",
  "update-available": "bg-blue-900/50 text-blue-400 border-blue-800",
  pending: "bg-gray-800/50 text-gray-400 border-gray-700",
  downloading: "bg-blue-900/50 text-blue-400 border-blue-800",
  completed: "bg-green-900/50 text-green-400 border-green-800",
  failed: "bg-red-900/50 text-red-400 border-red-800",
};

export default function StatusBadge({ status }: { status: string }) {
  const style = statusStyles[status] || statusStyles.active;
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium border whitespace-nowrap ${style}`}
    >
      {status}
    </span>
  );
}
