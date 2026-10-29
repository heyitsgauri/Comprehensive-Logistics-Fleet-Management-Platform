import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Building2,
  BarChart3,
  Bell,
  Contact,
  LayoutDashboard,
  LogOut,
  Map as MapIcon,
  Menu,
  Package,
  Receipt,
  Route,
  Truck,
  UserCheck,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { Button } from "../components/ui";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/driver", label: "Driver Portal", icon: UserCheck },
  { to: "/fleet", label: "Live Fleet", icon: MapIcon },
  { to: "/vehicles", label: "Vehicles", icon: Truck },
  { to: "/drivers", label: "Drivers", icon: Users },
  { to: "/customers", label: "Customers", icon: Contact },
  { to: "/warehouses", label: "Warehouses", icon: Building2 },
  { to: "/shipments", label: "Shipments", icon: Package },
  { to: "/trips", label: "Trips", icon: Route },
  { to: "/maintenance", label: "Maintenance", icon: Wrench },
  { to: "/expenses", label: "Expenses", icon: Receipt },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
];

const roleLabels: Record<string, string> = {
  admin: "Administrator",
  fleet_manager: "Fleet Manager",
  coordinator: "Logistics Coordinator",
  driver: "Driver",
};

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="space-y-1 px-3">
      {nav.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === "/"}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${
              isActive
                ? "bg-brand-700 text-white"
                : "text-white/80 hover:bg-brand-800"
            }`
          }
        >
          <Icon size={18} />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 bg-brand-900 text-white md:block">
        <div className="px-5 py-5 text-lg font-semibold">
          Logistics Platform
        </div>
        <SidebarNav />
      </aside>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-slate-900/50"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="relative h-full w-64 bg-brand-900 text-white">
            <div className="flex items-center justify-between px-5 py-5">
              <span className="text-lg font-semibold">Logistics Platform</span>
              <button
                aria-label="Close menu"
                onClick={() => setDrawerOpen(false)}
              >
                <X size={20} />
              </button>
            </div>
            <SidebarNav onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4">
          <button
            aria-label="Open menu"
            className="rounded p-1 text-slate-600 hover:bg-slate-100 md:hidden"
            onClick={() => setDrawerOpen(true)}
          >
            <Menu size={20} />
          </button>
          <div className="hidden text-sm text-slate-500 md:block">
            Fleet &amp; delivery operations
          </div>
          <div className="flex items-center gap-3">
            <NavLink
              to="/alerts"
              aria-label="Open alerts"
              className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <Bell size={18} />
            </NavLink>
            <div className="text-right text-sm leading-tight">
              <div className="font-medium text-slate-900">
                {user?.full_name}
              </div>
              <div className="text-xs text-slate-500">
                {roleLabels[user?.role ?? ""] ?? "No role"}
              </div>
            </div>
            <Button variant="secondary" onClick={handleLogout}>
              <LogOut size={16} /> Log out
            </Button>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
