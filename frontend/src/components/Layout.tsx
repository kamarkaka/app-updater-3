import { Link, useNavigate, useLocation } from "react-router-dom";
import { api } from "../api/client";

export default function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();

  const navItems = [
    { path: "/", label: "Dashboard" },
    { path: "/apps/new", label: "Add App" },
    { path: "/downloads", label: "Downloads" },
  ];

  async function handleLogout() {
    await api.logout();
    navigate("/login");
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <nav className="border-b border-gray-800 bg-gray-900">
        <div className="mx-auto max-w-6xl px-4 flex items-center justify-between h-14">
          <Link to="/" className="text-lg font-semibold text-white">
            App Updater
          </Link>
          <div className="flex items-center gap-1">
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`px-3 py-1.5 rounded text-sm ${
                  location.pathname === item.path
                    ? "bg-gray-700 text-white"
                    : "text-gray-400 hover:text-white hover:bg-gray-800"
                }`}
              >
                {item.label}
              </Link>
            ))}
            <button
              onClick={handleLogout}
              className="ml-4 px-3 py-1.5 rounded text-sm text-gray-400 hover:text-white hover:bg-gray-800"
            >
              Logout
            </button>
          </div>
        </div>
      </nav>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
