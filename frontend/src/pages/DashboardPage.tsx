import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import { Banner, Card, PageHeader } from "../components/ui";
import type { Paginated, Summary } from "../types";

const VEHICLE_COLORS: Record<string, string> = {
  available: "#16a34a",
  assigned: "#d97706",
  in_transit: "#2563eb",
  maintenance: "#f59e0b",
  inactive: "#94a3b8",
};

const pretty = (value: string) =>
  value.replace(/_/g, " ").replace(/^\w/, (char) => char.toUpperCase());

function formatMinutes(minutes: number | null) {
  if (minutes === null) return "—";
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function Kpi({
  label,
  value,
  hint,
  to,
  tone = "text-slate-900",
}: {
  label: string;
  value: string | number;
  hint: string;
  to: string;
  tone?: string;
}) {
  return (
    <Link
      to={to}
      className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
    >
      <div className="text-sm text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</div>
      <div className="mt-1 text-xs text-slate-400">{hint}</div>
    </Link>
  );
}

export default function DashboardPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["summary"],
    queryFn: async () =>
      (await api.get<Summary>("/analytics/summary/")).data,
    refetchInterval: 15000,
  });
  const { data: alerts } = useQuery({
    queryKey: ["dashboard-open-alerts"],
    queryFn: async () =>
      (
        await api.get<Paginated<{ id: number }>>("/alerts/", {
          params: { status: "open", page_size: 1 },
        })
      ).data.count,
  });

  if (isLoading) {
    return <p className="text-sm text-slate-500">Loading dashboard…</p>;
  }
  if (isError || !data) {
    return (
      <Banner tone="error">
        Could not load the dashboard. Is the backend running?
      </Banner>
    );
  }

  const shipmentData = Object.entries(data.shipment_status_counts).map(
    ([key, count]) => ({ name: pretty(key), count }),
  );
  const vehicleData = Object.entries(data.vehicle_status_counts)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({ key, name: pretty(key), count }));

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Live figures from the database. Click a card to open the matching list."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Kpi
          label="Awaiting driver acceptance"
          value={data.awaiting_acceptance ?? 0}
          hint="Dispatch SMS sent, awaiting response"
          to="/shipments?status=awaiting_acceptance"
          tone={data.awaiting_acceptance ? "text-amber-600" : "text-slate-900"}
        />
        <Kpi
          label="Accepted awaiting trip start"
          value={data.accepted_awaiting_start ?? 0}
          hint="Driver accepted, ready for manager start"
          to="/shipments?status=accepted"
          tone={data.accepted_awaiting_start ? "text-green-700" : "text-slate-900"}
        />
        <Kpi
          label="Rejected assignments"
          value={data.rejected_assignments ?? 0}
          hint="Driver rejected, reassignment required"
          to="/shipments?status=rejected"
          tone={data.rejected_assignments ? "text-red-600" : "text-slate-900"}
        />
        <Kpi
          label="Active trips"
          value={data.active_trips}
          hint="Vehicles currently in transit"
          to="/trips?status=in_transit"
          tone="text-blue-700"
        />
        <Kpi
          label="Delayed deliveries"
          value={data.delayed_deliveries}
          hint="Open shipments past their deadline"
          to="/shipments?late=true"
          tone={data.delayed_deliveries ? "text-red-600" : "text-slate-900"}
        />
        <Kpi
          label="Open alerts"
          value={alerts ?? "—"}
          hint="Items needing operational attention"
          to="/alerts?status=open"
          tone={alerts ? "text-red-600" : "text-slate-900"}
        />
        <Kpi
          label="Available vehicles"
          value={data.available_vehicles}
          hint={`of ${data.total_vehicles} total vehicles`}
          to="/vehicles?status=available"
          tone="text-green-700"
        />
        <Kpi
          label="On-time delivery rate"
          value={
            data.on_time_rate === null ? "—" : `${data.on_time_rate}%`
          }
          hint="Completed trips delivered by the deadline"
          to="/analytics"
        />
        <Kpi
          label="Average delivery time"
          value={formatMinutes(data.avg_delivery_minutes)}
          hint="From trip start to delivery completion"
          to="/trips?status=completed"
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-medium text-slate-700">
            Shipments by status
          </h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={shipmentData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar
                dataKey="count"
                name="Shipments"
                fill="#14625f"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-medium text-slate-700">
            Fleet by status
          </h2>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={vehicleData}
                dataKey="count"
                nameKey="name"
                innerRadius={55}
                outerRadius={90}
              >
                {vehicleData.map((item) => (
                  <Cell
                    key={item.key}
                    fill={VEHICLE_COLORS[item.key] ?? "#94a3b8"}
                  />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}
