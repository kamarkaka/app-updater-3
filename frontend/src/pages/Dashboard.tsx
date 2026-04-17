import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Application } from "../types";
import AppCard from "../components/AppCard";

export default function Dashboard() {
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-white">Applications</h1>
        <Link
          to="/apps/new"
          className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-500"
        >
          Add App
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {apps.map((app) => (
          <AppCard key={app.id} app={app} />
        ))}
      </div>
    </div>
  );
}
