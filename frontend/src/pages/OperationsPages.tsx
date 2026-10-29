import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
} from "react-leaflet";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import { useAuth } from "../auth/useAuth";
import {
  Banner,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  inputClass,
  Modal,
  PageHeader,
  StatusBadge,
} from "../components/ui";
import { DispatchModal } from "../components/DispatchModal";
import { RouteDrawer } from "../components/RouteDrawer";
import {
  CheckCircle2,
  Clock,
  Eye,
  Map as MapIconLucide,
  Navigation,
  Play,
  RotateCcw,
  Send,
  Truck,
} from "lucide-react";
import type { LiveVehicle, Paginated, Shipment } from "../types";
import { apiError } from "../utils/errors";

type Entity = { id: number };
type Customer = Entity & { name: string; contact_name: string; phone: string; email: string; address: string };
type Warehouse = Entity & { name: string; address: string; lat: number; lng: number; operating_hours: string };
type Trip = Entity & {
  shipment: number;
  shipment_ref: string;
  vehicle: number;
  vehicle_reg: string;
  driver: number;
  driver_name: string;
  status: string;
  distance_km: number | null;
  started_at: string | null;
  estimated_arrival: string | null;
};
type Maintenance = Entity & {
  vehicle: number;
  vehicle_reg: string;
  kind: string;
  description: string;
  status: string;
  scheduled_date: string;
  estimated_cost: string;
  cost: string;
  notes: string;
};
type Expense = Entity & {
  category: string;
  vehicle: number;
  vehicle_reg: string;
  date: string;
  amount: string;
  litres: string | null;
  note: string;
};
type Alert = Entity & {
  category: string;
  severity: string;
  message: string;
  status: string;
  vehicle_reg: string | null;
  shipment_ref: string | null;
  created_at: string;
};
type Vehicle = Entity & { registration_number: string; status: string };
type AssignmentTrip = { id: number; shipment_ref: string; status: string };
type VehicleOption = {
  id: number;
  registration_number: string;
  vehicle_type: string;
  make: string;
  model: string;
  capacity_kg: string;
  fuel_type: string;
  status: string;
  active_trip: AssignmentTrip | null;
  eligible: boolean;
  issues: string[];
};
type DriverOption = {
  id: number;
  full_name: string;
  status: string;
  license_expiry: string;
  license_valid: boolean;
  active_trip: AssignmentTrip | null;
  eligible: boolean;
  issues: string[];
};
type AssignmentOptions = {
  vehicles: VehicleOption[];
  drivers: DriverOption[];
};

function useCanManageOperations() {
  const { user } = useAuth();
  return ["admin", "fleet_manager", "coordinator"].includes(user?.role ?? "");
}

function useList<T>(key: string, url: string, params?: Record<string, unknown>) {
  return useQuery({
    queryKey: [key, params],
    queryFn: async () => {
      const { data } = await api.get<Paginated<T> | T[]>(url, { params });
      return Array.isArray(data) ? data : data.results;
    },
  });
}

function useWrite(url: string, method: "post" | "patch" = "post") {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ path = "", body }: { path?: string; body?: unknown }) =>
      api[method](`${url}${path}`, body),
    onSuccess: () => {
      client.invalidateQueries();
    },
    onError: (error) => window.alert(apiError(error)),
  });
}

function DataTable<T extends Entity>({
  rows,
  columns,
  empty,
}: {
  rows: T[] | undefined;
  columns: { title: string; render: (row: T) => React.ReactNode }[];
  empty: string;
}) {
  if (!rows) return <p className="p-5 text-sm text-slate-500">Loading…</p>;
  if (!rows.length) return <EmptyState title={empty} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>{columns.map((column) => <th key={column.title} className="px-4 py-3">{column.title}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => <tr key={row.id} className="hover:bg-slate-50">
            {columns.map((column) => <td key={column.title} className="px-4 py-3">{column.render(row)}</td>)}
          </tr>)}
        </tbody>
      </table>
    </div>
  );
}

function RecordModal({
  open,
  title,
  onClose,
  onSubmit,
  submitDisabled = false,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  submitDisabled?: boolean;
  children: React.ReactNode;
}) {
  return <Modal open={open} title={title} onClose={onClose}>
    <form className="space-y-3" onSubmit={onSubmit}>
      {children}
      <div className="flex justify-end gap-2 pt-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={submitDisabled}>Save</Button>
      </div>
    </form>
  </Modal>;
}

function TextField({ label, name, required = true, type = "text", defaultValue }: { label: string; name: string; required?: boolean; type?: string; defaultValue?: string }) {
  return <Field label={label}><input className={inputClass} name={name} type={type} required={required} defaultValue={defaultValue} /></Field>;
}

export function CustomersPage() {
  const canManage = useCanManageOperations();
  const [open, setOpen] = useState(false);
  const rows = useList<Customer>("customers", "/customers/");
  const create = useWrite("/customers/");
  return <div>
    <PageHeader title="Customers" subtitle="Customer contacts and shipment destinations." action={canManage ? <Button onClick={() => setOpen(true)}>Add customer</Button> : undefined} />
    {rows.isError && <Banner tone="error">Could not load customers.</Banner>}
    <Card><DataTable rows={rows.data} empty="No customers found" columns={[
      { title: "Name", render: (row) => <span className="font-medium">{row.name}</span> },
      { title: "Contact", render: (row) => row.contact_name || "—" },
      { title: "Phone", render: (row) => row.phone },
      { title: "Email", render: (row) => row.email || "—" },
      { title: "Address", render: (row) => row.address },
    ]} /></Card>
    {canManage && <RecordModal open={open} title="Add customer" onClose={() => setOpen(false)} onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      create.mutate({ body: Object.fromEntries(form) }, { onSuccess: () => setOpen(false) });
    }}>
      <TextField label="Customer name" name="name" />
      <TextField label="Contact name" name="contact_name" required={false} />
      <TextField label="Phone" name="phone" />
      <TextField label="Email" name="email" type="email" required={false} />
      <Field label="Address"><textarea className={inputClass} name="address" required /></Field>
    </RecordModal>}
  </div>;
}

export function WarehousesPage() {
  const canManage = useCanManageOperations();
  const [open, setOpen] = useState(false);
  const rows = useList<Warehouse>("warehouses", "/warehouses/");
  const create = useWrite("/warehouses/");
  return <div>
    <PageHeader title="Warehouses" subtitle="Manage warehouse locations." action={canManage ? <Button onClick={() => setOpen(true)}>Add warehouse</Button> : undefined} />
    {rows.isError && <Banner tone="error">Could not load warehouses.</Banner>}
    <Card><DataTable rows={rows.data} empty="No warehouses found" columns={[
      { title: "Name", render: (row) => row.name },
      { title: "Address", render: (row) => row.address },
      { title: "Coordinates", render: (row) => `${row.lat}, ${row.lng}` },
      { title: "Operating hours", render: (row) => row.operating_hours || "—" },
    ]} /></Card>
    {canManage && <RecordModal open={open} title="Add warehouse" onClose={() => setOpen(false)} onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      create.mutate({ body: Object.fromEntries(form) }, { onSuccess: () => setOpen(false) });
    }}>
      <TextField label="Name" name="name" />
      <Field label="Address"><textarea className={inputClass} name="address" required /></Field>
      <TextField label="Latitude" name="lat" type="number" />
      <TextField label="Longitude" name="lng" type="number" />
      <TextField label="Operating hours" name="operating_hours" required={false} />
    </RecordModal>}
  </div>;
}

export function ShipmentsPage() {
  const canManage = useCanManageOperations();
  const [open, setOpen] = useState(false);
  const [dispatchTarget, setDispatchTarget] = useState<Shipment | null>(null);
  const [routeTarget, setRouteTarget] = useState<{ shipmentId?: number; tripId?: number } | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get("status") ?? "";
  const late = searchParams.get("late") === "true";
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const rows = useList<Shipment>("shipments", "/shipments/", {
    status: status || undefined,
    late: late ? "true" : undefined,
    search: search || undefined,
  });
  const customers = useList<Customer>("customers", "/customers/");
  const create = useWrite("/shipments/");

  const startTripMutation = useMutation({
    mutationFn: async (shipmentId: number) => {
      return (await api.post(`/shipments/${shipmentId}/start_trip/`)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shipments"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      queryClient.invalidateQueries({ queryKey: ["fleet-live"] });
    },
    onError: (err) => window.alert(apiError(err)),
  });

  const completeTripMutation = useMutation({
    mutationFn: async (shipmentId: number) => {
      // Find trip for shipment
      const tripsResp = await api.get<{ results: { id: number; shipment: number; status: string }[] }>("/trips/", {
        params: { shipment: shipmentId, status: "in_transit" },
      });
      const trip = tripsResp.data.results?.[0];
      if (!trip) throw new Error("No active trip found for this shipment.");
      return (await api.post(`/trips/${trip.id}/complete/`)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shipments"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      queryClient.invalidateQueries({ queryKey: ["fleet-live"] });
      queryClient.invalidateQueries({ queryKey: ["trips"] });
      queryClient.invalidateQueries({ queryKey: ["driver-my-dispatches"] });
    },
    onError: (err) => window.alert(apiError(err)),
  });

  return <div>
    <PageHeader
      title="Shipments"
      subtitle="Create, dispatch, and track customer shipments across the complete lifecycle."
      action={canManage ? <Button onClick={() => setOpen(true)}>Create shipment</Button> : undefined}
    />
    {rows.isError && <Banner tone="error">Could not load shipments.</Banner>}
    <Card>
      <div className="flex flex-wrap gap-3 border-b border-slate-200 p-4">
        <input
          className={`${inputClass} max-w-sm`}
          aria-label="Search shipments"
          placeholder="Search shipment reference or customer"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          className={`${inputClass} max-w-xs`}
          aria-label="Filter shipments by status"
          value={status}
          onChange={(event) => {
            const next = new URLSearchParams(searchParams);
            if (event.target.value) next.set("status", event.target.value);
            else next.delete("status");
            setSearchParams(next);
          }}
        >
          <option value="">All statuses</option>
          {[
            ["pending", "Pending Assignment"],
            ["awaiting_acceptance", "Awaiting Driver Acceptance"],
            ["accepted", "Accepted (Awaiting Trip Start)"],
            ["in_transit", "In Transit"],
            ["delivered", "Delivered"],
            ["delayed", "Delayed"],
            ["rejected", "Driver Rejected"],
            ["cancelled", "Cancelled"],
          ].map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 px-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={late}
            onChange={(event) => {
              const next = new URLSearchParams(searchParams);
              if (event.target.checked) next.set("late", "true");
              else next.delete("late");
              setSearchParams(next);
            }}
          />
          Overdue only
        </label>
      </div>
      <DataTable
        rows={rows.data}
        empty="No shipments found"
        columns={[
          {
            title: "Reference",
            render: (row) => (
              <Link
                className="font-medium text-brand-700 hover:underline"
                to={`/shipments/${row.id}`}
              >
                {row.reference}
              </Link>
            ),
          },
          { title: "Customer", render: (row) => row.customer_name },
          {
            title: "Cargo",
            render: (row) => (
              <span>
                {row.cargo_description}
                <span className="block text-xs text-slate-500">{row.weight_kg} kg</span>
              </span>
            ),
          },
          {
            title: "Deadline",
            render: (row) => new Date(row.deadline).toLocaleString([], {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            }),
          },
          { title: "Status", render: (row) => <StatusBadge status={row.status} /> },
          {
            title: "Shipment Started",
            render: (row) => {
              if (row.shipment_started_status === "Started") {
                return (
                  <div className="flex flex-col">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-full bg-blue-600 animate-pulse" />
                      <span className="font-semibold text-blue-800 text-xs">Started</span>
                      {row.departure_punctuality === "On Time" && (
                        <span className="rounded bg-green-50 px-1 py-0.5 text-[10px] font-medium text-green-700 ring-1 ring-green-600/20">
                          On Time
                        </span>
                      )}
                      {row.departure_punctuality === "Late" && (
                        <span className="rounded bg-red-50 px-1 py-0.5 text-[10px] font-medium text-red-700 ring-1 ring-red-600/20">
                          Late
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-500 mt-0.5">
                      {row.started_at ? new Date(row.started_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                    </span>
                  </div>
                );
              }
              if (row.shipment_started_status === "Delivered") {
                return (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700">
                    <CheckCircle2 size={13} /> Delivered
                  </span>
                );
              }
              return <span className="text-xs text-slate-400">Not Started</span>;
            },
          },
          {
            title: "Actions",
            render: (row) => {
              return (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    className="text-xs py-1 px-2.5 flex items-center gap-1"
                    onClick={() => navigate(`/shipments/${row.id}`)}
                  >
                    <Eye size={12} /> Details
                  </Button>

                  {canManage && ["pending", "rejected", "draft"].includes(row.status) && (
                    <Button
                      className="text-xs py-1 px-2.5 flex items-center gap-1 bg-brand-700 hover:bg-brand-800 text-white"
                      onClick={() => setDispatchTarget(row)}
                    >
                      <Send size={12} /> Start Shipment
                    </Button>
                  )}

                  {row.status === "awaiting_acceptance" && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-amber-700 font-medium">Awaiting Driver</span>
                      {canManage && (
                        <Button
                          variant="secondary"
                          className="text-xs py-0.5 px-2"
                          onClick={() => setDispatchTarget(row)}
                        >
                          Review / Resend
                        </Button>
                      )}
                    </div>
                  )}

                  {canManage && row.status === "accepted" && (
                    <Button
                      className="text-xs py-1 px-2.5 flex items-center gap-1 bg-green-700 hover:bg-green-800 text-white"
                      disabled={startTripMutation.isPending}
                      onClick={() => startTripMutation.mutate(row.id)}
                    >
                      <Play size={12} /> Start Trip
                    </Button>
                  )}

                  {row.status === "in_transit" && (
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="secondary"
                        className="text-xs py-1 px-2 flex items-center gap-1 text-blue-700 border-blue-200 hover:bg-blue-50"
                        onClick={() => setRouteTarget({ shipmentId: row.id })}
                      >
                        <MapIconLucide size={12} /> Check Route
                      </Button>
                      {canManage && (
                        <Button
                          className="text-xs py-1 px-2 bg-emerald-700 hover:bg-emerald-800 text-white"
                          disabled={completeTripMutation.isPending}
                          onClick={() => completeTripMutation.mutate(row.id)}
                        >
                          Complete
                        </Button>
                      )}
                    </div>
                  )}

                  {row.status === "delivered" && (
                    <Button
                      variant="secondary"
                      className="text-xs py-1 px-2 flex items-center gap-1"
                      onClick={() => setRouteTarget({ shipmentId: row.id })}
                    >
                      <MapIconLucide size={12} /> Route
                    </Button>
                  )}
                </div>
              );
            },
          },
        ]}
      />
    </Card>

    {/* Dispatch Confirmation Modal */}
    <DispatchModal
      open={Boolean(dispatchTarget)}
      shipment={dispatchTarget}
      onClose={() => setDispatchTarget(null)}
      onDispatched={() => setDispatchTarget(null)}
    />

    {/* Route Drawer */}
    <RouteDrawer
      open={Boolean(routeTarget)}
      shipmentId={routeTarget?.shipmentId}
      tripId={routeTarget?.tripId}
      onClose={() => setRouteTarget(null)}
    />
    {canManage && <RecordModal open={open} title="Create shipment" onClose={() => setOpen(false)} onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      create.mutate(
        { body: Object.fromEntries(form) },
        {
          onSuccess: (response) => {
            setOpen(false);
            navigate(`/shipments/${response.data.id}`);
          },
        },
      );
    }}>
      <Field label="Customer"><select className={inputClass} name="customer" required>
        <option value="">Select customer</option>{customers.data?.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
      </select></Field>
      <TextField label="Cargo description" name="cargo_description" />
      <TextField label="Weight (kg)" name="weight_kg" type="number" />
      <TextField label="Deadline" name="deadline" type="datetime-local" />
      <Field label="Pickup address"><textarea className={inputClass} name="pickup_address" required /></Field>
      <div className="grid grid-cols-2 gap-3"><TextField label="Pickup latitude" name="pickup_lat" type="number" /><TextField label="Pickup longitude" name="pickup_lng" type="number" /></div>
      <Field label="Delivery address"><textarea className={inputClass} name="delivery_address" required /></Field>
      <div className="grid grid-cols-2 gap-3"><TextField label="Delivery latitude" name="delivery_lat" type="number" /><TextField label="Delivery longitude" name="delivery_lng" type="number" /></div>
    </RecordModal>}
  </div>;
}

export function ShipmentDetailPage() {
  const canManage = useCanManageOperations();
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [dispatchModalOpen, setDispatchModalOpen] = useState(false);
  const [routeDrawerOpen, setRouteDrawerOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const query = useQuery({
    queryKey: ["shipment", id],
    queryFn: async () => (await api.get<Shipment>(`/shipments/${id}/`)).data,
    enabled: Boolean(id),
    refetchInterval: 6000,
  });

  const cancel = useWrite(`/shipments/${id}/cancel/`);

  const startTripMutation = useMutation({
    mutationFn: async () => {
      return (await api.post(`/shipments/${id}/start_trip/`)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shipment", id] });
      queryClient.invalidateQueries({ queryKey: ["shipments"] });
      queryClient.invalidateQueries({ queryKey: ["fleet-live"] });
      setNotice("Trip started! Vehicle is now in transit.");
    },
    onError: (err) => window.alert(apiError(err)),
  });

  const completeTripMutation = useMutation({
    mutationFn: async () => {
      const tripsResp = await api.get<{ results: { id: number; shipment: number; status: string }[] }>("/trips/", {
        params: { shipment: id, status: "in_transit" },
      });
      const trip = tripsResp.data.results?.[0];
      if (!trip) throw new Error("No active trip found for this shipment.");
      return (await api.post(`/trips/${trip.id}/complete/`)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shipment", id] });
      queryClient.invalidateQueries({ queryKey: ["shipments"] });
      queryClient.invalidateQueries({ queryKey: ["fleet-live"] });
      queryClient.invalidateQueries({ queryKey: ["driver-my-dispatches"] });
      setNotice("Trip completed! Shipment marked as delivered.");
    },
    onError: (err) => window.alert(apiError(err)),
  });

  const retrySmsMutation = useMutation({
    mutationFn: async () => {
      if (!query.data?.active_dispatch?.id) throw new Error("No active dispatch to retry SMS for.");
      return (await api.post(`/dispatches/${query.data.active_dispatch.id}/retry_sms/`)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shipment", id] });
      setNotice("Driver SMS resent successfully.");
    },
    onError: (err) => window.alert(apiError(err)),
  });

  const shipment = query.data;

  // 5-step workflow calculation
  const getStepStatus = (stepIndex: number) => {
    if (!shipment) return "pending";
    const status = shipment.status;
    // Step 0: Shipment details (always done)
    if (stepIndex === 0) return "completed";
    // Step 1: Vehicle & driver assignment
    if (stepIndex === 1) {
      if (status === "pending") return "current";
      return "completed";
    }
    // Step 2: Driver SMS acceptance
    if (stepIndex === 2) {
      if (status === "awaiting_acceptance") return "current";
      if (["accepted", "in_transit", "delivered"].includes(status)) return "completed";
      if (status === "rejected") return "rejected";
      return "pending";
    }
    // Step 3: In transit & live tracking
    if (stepIndex === 3) {
      if (status === "accepted") return "ready";
      if (status === "in_transit") return "current";
      if (status === "delivered") return "completed";
      return "pending";
    }
    // Step 4: Delivery completed
    if (stepIndex === 4) {
      if (status === "delivered") return "completed";
      return "pending";
    }
    return "pending";
  };

  const steps = [
    "Shipment details",
    "Vehicle & driver",
    "Driver SMS acceptance",
    "In transit & tracking",
    "Delivered",
  ];

  return (
    <div>
      <PageHeader
        title={shipment?.reference ?? "Shipment"}
        subtitle="Shipment details, driver SMS dispatch, and live route tracking."
        action={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => navigate("/shipments")}>
              Back to shipments
            </Button>
          </div>
        }
      />
      {notice && <Banner tone="success" className="mb-4">{notice}</Banner>}
      {query.isError && <Banner tone="error" className="mb-4">Could not load shipment details.</Banner>}
      {shipment && (
        <Card className="p-6">
          {/* 5-step Stepper */}
          <ol aria-label="Shipment workflow" className="mb-6 grid gap-2 sm:grid-cols-5">
            {steps.map((step, index) => {
              const state = getStepStatus(index);
              const isCurrent = state === "current";
              const isCompleted = state === "completed";
              const isRejected = state === "rejected";
              const isReady = state === "ready";
              return (
                <li
                  key={step}
                  aria-current={isCurrent ? "step" : undefined}
                  className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                    isCurrent
                      ? "border-brand-700 bg-brand-50 text-brand-900 shadow-sm"
                      : isCompleted
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                      : isRejected
                      ? "border-red-300 bg-red-50 text-red-800"
                      : isReady
                      ? "border-blue-300 bg-blue-50 text-blue-800"
                      : "border-slate-200 text-slate-500 bg-slate-50/50"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold">{index + 1}.</span>
                    <span className="truncate">{step}</span>
                  </div>
                </li>
              );
            })}
          </ol>

          {/* Status & Timing Bar */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-3">
              <StatusBadge status={shipment.status} />
              {shipment.is_late && (
                <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">
                  Past deadline
                </span>
              )}
            </div>

            {/* Persistent Departure / Started Timing Column */}
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500">Departure:</span>
              {shipment.started_at ? (
                <div className="flex items-center gap-1.5">
                  <span className="font-medium text-slate-900">
                    {new Date(shipment.started_at).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  {shipment.departure_punctuality && (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                        shipment.departure_punctuality === "On Time"
                          ? "bg-emerald-100 text-emerald-800"
                          : shipment.departure_punctuality === "Late"
                          ? "bg-red-100 text-red-800"
                          : "bg-blue-100 text-blue-800"
                      }`}
                    >
                      {shipment.departure_punctuality}
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-slate-400 italic">Not started yet</span>
              )}
            </div>
          </div>

          {/* Shipment Details Data List */}
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["Customer", shipment.customer_name],
              ["Cargo", shipment.cargo_description],
              ["Weight", `${shipment.weight_kg} kg`],
              ["Deadline", new Date(shipment.deadline).toLocaleString()],
              ["Pickup Address", shipment.pickup_address],
              ["Delivery Address", shipment.delivery_address],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md bg-slate-50/70 p-3">
                <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</dt>
                <dd className="mt-1 text-sm font-medium text-slate-900 break-words">{value}</dd>
              </div>
            ))}
          </dl>

          {/* Workflow Stage Actions & Banners */}

          {/* 1. Pending Assignment / Dispatch */}
          {["pending", "draft"].includes(shipment.status) && (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-brand-200 bg-brand-50/60 p-4">
              <div>
                <h4 className="font-semibold text-brand-900">Ready for Dispatch</h4>
                <p className="mt-0.5 text-xs text-brand-700">
                  Assign an eligible vehicle and driver to send an SMS dispatch request with an interactive acceptance link.
                </p>
              </div>
              {canManage && (
                <Button
                  className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white font-medium py-2 px-4 shadow-sm"
                  onClick={() => setDispatchModalOpen(true)}
                >
                  <Send size={14} /> Start Shipment / Dispatch
                </Button>
              )}
            </div>
          )}

          {/* 2. Driver Rejected Banner */}
          {shipment.status === "rejected" && (
            <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="font-semibold text-red-900 flex items-center gap-1.5">
                    Driver Rejected Assignment
                  </h4>
                  {shipment.active_dispatch?.rejection_reason && (
                    <p className="mt-1 text-xs text-red-800 font-medium">
                      Reason: <span className="capitalize">{shipment.active_dispatch.rejection_reason.replace("_", " ")}</span>
                    </p>
                  )}
                  {shipment.active_dispatch?.rejection_notes && (
                    <p className="mt-0.5 text-xs text-red-700 italic">
                      "{shipment.active_dispatch.rejection_notes}"
                    </p>
                  )}
                </div>
                {canManage && (
                  <Button
                    className="flex items-center gap-1.5 bg-brand-700 hover:bg-brand-800 text-white text-xs py-2 px-3"
                    onClick={() => setDispatchModalOpen(true)}
                  >
                    <Send size={13} /> Reassign & Dispatch
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* 3. Awaiting Driver SMS Acceptance */}
          {shipment.status === "awaiting_acceptance" && (
            <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50/80 p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Clock className="text-amber-600 animate-pulse" size={18} />
                  <h4 className="font-semibold text-amber-900">Awaiting Driver SMS Response</h4>
                </div>
                <div className="flex items-center gap-2">
                  {canManage && (
                    <>
                      <Button
                        variant="secondary"
                        className="text-xs py-1 px-2.5 flex items-center gap-1 border-amber-300 hover:bg-amber-100"
                        disabled={retrySmsMutation.isPending}
                        onClick={() => retrySmsMutation.mutate()}
                      >
                        <RotateCcw size={12} /> Resend SMS
                      </Button>
                      <Button
                        variant="secondary"
                        className="text-xs py-1 px-2.5"
                        onClick={() => setDispatchModalOpen(true)}
                      >
                        Reassign
                      </Button>
                    </>
                  )}
                </div>
              </div>

              <dl className="grid gap-3 sm:grid-cols-3 text-xs text-amber-900">
                <div className="rounded bg-white/60 p-2.5">
                  <dt className="text-amber-700 font-medium">Assigned Driver</dt>
                  <dd className="mt-1 font-semibold text-slate-900">
                    {shipment.active_dispatch?.driver_name || "—"}
                    <span className="block text-[11px] font-normal text-slate-600">
                      📞 {shipment.active_dispatch?.driver_phone || "—"}
                    </span>
                  </dd>
                </div>
                <div className="rounded bg-white/60 p-2.5">
                  <dt className="text-amber-700 font-medium">Assigned Vehicle</dt>
                  <dd className="mt-1 font-semibold text-slate-900">
                    {shipment.active_dispatch?.vehicle_registration || "—"}
                  </dd>
                </div>
                <div className="rounded bg-white/60 p-2.5">
                  <dt className="text-amber-700 font-medium">SMS Delivery Status</dt>
                  <dd className="mt-1 flex items-center gap-1.5 font-semibold text-slate-900">
                    <span
                      className={`inline-block w-2 h-2 rounded-full ${
                        shipment.active_dispatch?.sms_status === "sent"
                          ? "bg-emerald-500"
                          : shipment.active_dispatch?.sms_status === "failed"
                          ? "bg-red-500"
                          : "bg-amber-500"
                      }`}
                    />
                    <span className="capitalize">{shipment.active_dispatch?.sms_status || "sent"}</span>
                    {shipment.active_dispatch?.sms_provider && (
                      <span className="text-[10px] text-slate-500 font-normal">
                        ({shipment.active_dispatch.sms_provider})
                      </span>
                    )}
                  </dd>
                </div>
              </dl>

              {/* Driver Simulation Link for verification */}
              {shipment.active_dispatch?.token && (
                <div className="mt-3.5 pt-3 border-t border-amber-200/80 text-xs flex flex-wrap items-center justify-between gap-2 text-amber-800">
                  <span>Driver response portal (SMS simulated link):</span>
                  <Link
                    to={`/driver/assignment?token=${shipment.active_dispatch.token}`}
                    target="_blank"
                    className="font-medium underline hover:text-amber-950 flex items-center gap-1 bg-amber-100/70 py-0.5 px-2 rounded"
                  >
                    Open Driver SMS Portal <Navigation size={11} />
                  </Link>
                </div>
              )}
            </div>
          )}

          {/* 4. Accepted - Ready to Start Trip */}
          {shipment.status === "accepted" && (
            <div className="mt-6 rounded-lg border border-emerald-300 bg-emerald-50/80 p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-emerald-800">
                    <CheckCircle2 size={20} className="text-emerald-600" />
                    <h4 className="font-semibold text-base">Driver Accepted Assignment</h4>
                  </div>
                  <p className="mt-1 text-xs text-emerald-700">
                    {shipment.active_dispatch?.driver_name || "Driver"} responded and accepted the dispatch request. The vehicle and driver are staged.
                  </p>
                </div>
                {canManage && (
                  <Button
                    className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-800 text-white font-medium py-2 px-4 shadow-sm"
                    disabled={startTripMutation.isPending}
                    onClick={() => startTripMutation.mutate()}
                  >
                    <Play size={16} /> Start Trip
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* 5. In Transit - Tracking & Route Check */}
          {shipment.status === "in_transit" && (
            <div className="mt-6 rounded-lg border border-blue-300 bg-blue-50/80 p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-blue-900">
                    <Truck size={20} className="text-blue-600 animate-bounce" />
                    <h4 className="font-semibold text-base">Shipment is In Transit</h4>
                  </div>
                  <p className="mt-1 text-xs text-blue-700">
                    Trip is active and live fleet tracking is recording vehicle progress along the OSRM route.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    className="flex items-center gap-1.5 text-blue-800 border-blue-300 hover:bg-blue-100"
                    onClick={() => setRouteDrawerOpen(true)}
                  >
                    <MapIconLucide size={14} /> Check Route
                  </Button>
                  {canManage && (
                    <Button
                      className="bg-emerald-700 hover:bg-emerald-800 text-white"
                      disabled={completeTripMutation.isPending}
                      onClick={() => completeTripMutation.mutate()}
                    >
                      Complete Delivery
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 6. Delivered */}
          {shipment.status === "delivered" && (
            <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-slate-800">
                <CheckCircle2 size={18} className="text-emerald-600" />
                <span className="font-semibold text-sm">Delivery Completed</span>
              </div>
              <Button
                variant="secondary"
                className="flex items-center gap-1.5 text-xs"
                onClick={() => setRouteDrawerOpen(true)}
              >
                <MapIconLucide size={13} /> View Route Details
              </Button>
            </div>
          )}

          {/* Cancel button if early state */}
          {canManage && ["draft", "pending"].includes(shipment.status) && (
            <div className="mt-6 border-t pt-4">
              <Button
                variant="danger"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate({}, { onSuccess: () => navigate("/shipments") })}
              >
                Cancel shipment
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* Dispatch Modal */}
      {shipment && (
        <DispatchModal
          open={dispatchModalOpen}
          shipment={shipment}
          onClose={() => setDispatchModalOpen(false)}
          onDispatched={() => {
            setDispatchModalOpen(false);
            queryClient.invalidateQueries({ queryKey: ["shipment", id] });
            queryClient.invalidateQueries({ queryKey: ["shipments"] });
          }}
        />
      )}

      {/* Slide-over Route Drawer */}
      <RouteDrawer
        open={routeDrawerOpen}
        shipmentId={shipment?.id}
        onClose={() => setRouteDrawerOpen(false)}
      />
    </div>
  );
}

export function TripsPage() {
  const canManage = useCanManageOperations();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedShipment = searchParams.get("shipment") ?? "";
  const [open, setOpen] = useState(Boolean(requestedShipment));
  const [selectedShipmentId, setSelectedShipmentId] = useState(requestedShipment);
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [routeTarget, setRouteTarget] = useState<{ shipmentId?: number; tripId?: number } | null>(null);
  const status = searchParams.get("status") ?? "";
  const rows = useList<Trip>("trips", "/trips/", {
    status: status || undefined,
    shipment: requestedShipment || undefined,
  });
  const shipments = useList<Shipment>("shipments", "/shipments/", { status: "pending" });
  const selectedShipmentDetail = useQuery({
    queryKey: ["shipment-assignment", selectedShipmentId],
    queryFn: async () =>
      (await api.get<Shipment>(`/shipments/${selectedShipmentId}/`)).data,
    enabled:
      Boolean(selectedShipmentId) &&
      shipments.data !== undefined &&
      !shipments.data.some((item) => String(item.id) === selectedShipmentId),
  });
  const shipmentOptions =
    selectedShipmentDetail.data &&
    !shipments.data?.some(
      (item) => item.id === selectedShipmentDetail.data.id,
    )
      ? [selectedShipmentDetail.data, ...(shipments.data ?? [])]
      : (shipments.data ?? []);
  const eligibility = useQuery({
    queryKey: ["shipment-eligibility", selectedShipmentId],
    queryFn: async () =>
      (
        await api.get<AssignmentOptions>(
          `/shipments/${selectedShipmentId}/eligible/`,
        )
      ).data,
    enabled: Boolean(selectedShipmentId),
  });
  const create = useWrite("/trips/");
  const action = useWrite("/trips/", "post");
  return <div>
    <PageHeader title="Trips" subtitle="Assign shipments and track trip progress." action={canManage ? <Button onClick={() => setOpen(true)}>Assign shipment</Button> : undefined} />
    {notice && <Banner tone="success">{notice}</Banner>}
    {rows.isError && <Banner tone="error">Could not load trips.</Banner>}
    <Card>
      <div className="border-b border-slate-200 p-4">
        <select className={`${inputClass} max-w-xs`} aria-label="Filter trips by status" value={status} onChange={(event) => {
          const next = new URLSearchParams(searchParams);
          if (event.target.value) next.set("status", event.target.value);
          else next.delete("status");
          setSearchParams(next);
        }}>
          <option value="">All trip statuses</option>
          {["planned", "in_transit", "completed", "cancelled"].map((value) => <option key={value} value={value}>{value.replace("_", " ")}</option>)}
        </select>
      </div>
      <DataTable rows={rows.data} empty="No trips found" columns={[
      { title: "Shipment", render: (row) => <Link className="text-brand-700 hover:underline" to={`/shipments/${row.shipment}`}>{row.shipment_ref}</Link> },
      { title: "Vehicle", render: (row) => row.vehicle_reg },
      { title: "Driver", render: (row) => row.driver_name },
      { title: "Status", render: (row) => <StatusBadge status={row.status} /> },
      { title: "Distance", render: (row) => row.distance_km ? `${row.distance_km} km` : "—" },
      {
        title: "Action",
        render: (row) => (
          <div className="flex items-center gap-1.5">
            {canManage && row.status === "planned" && (
              <Button onClick={() => action.mutate({ path: `${row.id}/start/` })}>Start</Button>
            )}
            {row.status === "in_transit" && (
              <>
                <Button
                  variant="secondary"
                  className="text-xs py-1 px-2 flex items-center gap-1 text-blue-700 border-blue-200 hover:bg-blue-50"
                  onClick={() => setRouteTarget({ tripId: row.id })}
                >
                  <MapIconLucide size={12} /> Check Route
                </Button>
                {canManage && (
                  <Button
                    className="text-xs py-1 px-2 bg-emerald-700 hover:bg-emerald-800 text-white"
                    onClick={() => action.mutate({ path: `${row.id}/complete/` })}
                  >
                    Complete
                  </Button>
                )}
              </>
            )}
            {row.status === "completed" && (
              <Button
                variant="secondary"
                className="text-xs py-1 px-2 flex items-center gap-1"
                onClick={() => setRouteTarget({ tripId: row.id })}
              >
                <MapIconLucide size={12} /> Route
              </Button>
            )}
            {!canManage && row.status === "planned" && "—"}
            {row.status === "cancelled" && "—"}
          </div>
        ),
      },
    ]} /></Card>
    {canManage && <RecordModal
      open={open}
      title="Assign shipment"
      onClose={() => setOpen(false)}
      submitDisabled={
        create.isPending ||
        !selectedShipmentId ||
        !eligibility.data?.vehicles.some(
          (vehicle) => vehicle.id === selectedVehicleId && vehicle.eligible,
        ) ||
        !eligibility.data?.drivers.some(
          (driver) => driver.id === selectedDriverId && driver.eligible,
        )
      }
      onSubmit={(event) => {
        event.preventDefault();
        if (
          selectedVehicleId === null ||
          selectedDriverId === null ||
          !eligibility.data?.vehicles.some(
            (vehicle) => vehicle.id === selectedVehicleId && vehicle.eligible,
          ) ||
          !eligibility.data.drivers.some(
            (driver) => driver.id === selectedDriverId && driver.eligible,
          )
        ) {
          return;
        }
        create.mutate(
          {
            body: {
              shipment_id: Number(selectedShipmentId),
              vehicle_id: selectedVehicleId,
              driver_id: selectedDriverId,
            },
          },
          {
            onSuccess: () => {
              setOpen(false);
              setNotice(
                "Shipment assigned. The trip is planned and ready to start.",
              );
            },
          },
        );
      }}
    >
      <Field label="Shipment">
        <select
          className={inputClass}
          name="shipment_id"
          required
          value={selectedShipmentId}
          onChange={(event) => {
            const id = event.target.value;
            setSelectedShipmentId(id);
            setSelectedVehicleId(null);
            setSelectedDriverId(null);
            const next = new URLSearchParams(searchParams);
            if (id) next.set("shipment", id);
            else next.delete("shipment");
            setSearchParams(next);
          }}
        >
          <option value="">Select shipment</option>
          {shipmentOptions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.reference} · {item.customer_name} · {item.weight_kg} kg
            </option>
          ))}
        </select>
      </Field>
      {eligibility.isLoading && selectedShipmentId && (
        <p className="text-sm text-slate-500">
          Checking vehicle and driver eligibility…
        </p>
      )}
      {eligibility.isError && (
        <Banner tone="error">
          Could not check eligibility for this shipment. Retry before assigning.
        </Banner>
      )}
      {eligibility.data && (
        <>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium text-slate-700">
              Vehicles for{" "}
              {shipmentOptions.find(
                (item) => String(item.id) === selectedShipmentId,
              )?.weight_kg ?? "selected"}{" "}
              kg cargo
            </legend>
            {eligibility.data.vehicles.map((vehicle) => (
              <label
                key={vehicle.id}
                className={`block rounded-md border p-3 text-sm ${
                  vehicle.eligible
                    ? "cursor-pointer border-slate-200 hover:border-brand-700"
                    : "border-slate-200 bg-slate-50 text-slate-500"
                }`}
              >
                <span className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="vehicle_choice"
                    checked={selectedVehicleId === vehicle.id}
                    disabled={!vehicle.eligible}
                    onChange={() => setSelectedVehicleId(vehicle.id)}
                    className="mt-1"
                  />
                  <span className="min-w-0">
                    <span className="font-medium">
                      {vehicle.registration_number} · {vehicle.vehicle_type}{" "}
                      {vehicle.make} {vehicle.model}
                    </span>
                    <span className="block text-xs">
                      Capacity {vehicle.capacity_kg} kg · {vehicle.fuel_type} ·{" "}
                      {vehicle.status.replace("_", " ")}
                    </span>
                    {vehicle.active_trip && (
                      <span className="block text-xs">
                        Active trip #{vehicle.active_trip.id} (
                        {vehicle.active_trip.shipment_ref})
                      </span>
                    )}
                    {vehicle.issues.map((issue) => (
                      <span key={issue} className="block text-xs text-red-700">
                        {issue}
                      </span>
                    ))}
                  </span>
                </span>
              </label>
            ))}
            {!eligibility.data.vehicles.length && (
              <p className="text-sm text-slate-500">
                No vehicles are available to evaluate.
              </p>
            )}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium text-slate-700">
              Drivers
            </legend>
            {eligibility.data.drivers.map((driver) => (
              <label
                key={driver.id}
                className={`block rounded-md border p-3 text-sm ${
                  driver.eligible
                    ? "cursor-pointer border-slate-200 hover:border-brand-700"
                    : "border-slate-200 bg-slate-50 text-slate-500"
                }`}
              >
                <span className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="driver_choice"
                    checked={selectedDriverId === driver.id}
                    disabled={!driver.eligible}
                    onChange={() => setSelectedDriverId(driver.id)}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium">{driver.full_name}</span>
                    <span className="block text-xs">
                      {driver.status.replace("_", " ")} · License{" "}
                      {driver.license_valid ? "valid" : "expired"} through{" "}
                      {driver.license_expiry}
                    </span>
                    {driver.active_trip && (
                      <span className="block text-xs">
                        Active trip #{driver.active_trip.id} (
                        {driver.active_trip.shipment_ref})
                      </span>
                    )}
                    {driver.issues.map((issue) => (
                      <span key={issue} className="block text-xs text-red-700">
                        {issue}
                      </span>
                    ))}
                  </span>
                </span>
              </label>
            ))}
            {!eligibility.data.drivers.length && (
              <p className="text-sm text-slate-500">
                No drivers are available to evaluate.
              </p>
            )}
          </fieldset>
        </>
      )}
    </RecordModal>}

    {/* Route Drawer for Trips */}
    <RouteDrawer
      open={Boolean(routeTarget)}
      tripId={routeTarget?.tripId}
      shipmentId={routeTarget?.shipmentId}
      onClose={() => setRouteTarget(null)}
    />
  </div>;
}

export function LiveFleetPage() {
  const [routeTarget, setRouteTarget] = useState<{ shipmentId?: number; tripId?: number } | null>(null);
  const query = useQuery({
    queryKey: ["fleet-live"],
    queryFn: async () => (await api.get<LiveVehicle[]>("/fleet/live/")).data,
    refetchInterval: 10000,
  });

  const points = query.data?.filter(
    (item): item is LiveVehicle & { lat: number; lng: number } => item.lat !== null && item.lng !== null
  );

  return (
    <div>
      <PageHeader
        title="Live Fleet"
        subtitle="Real-time vehicle positions, active trip tracking, and OSRM route simulation."
      />
      {query.isError && <Banner tone="error">Could not load live fleet positions.</Banner>}
      <Card className="overflow-hidden">
        {points?.length ? (
          <MapContainer center={[points[0].lat, points[0].lng]} zoom={6} scrollWheelZoom className="h-[65vh] min-h-96">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {points.map((vehicle) => {
              const markerColor = vehicle.late
                ? "#dc2626"
                : vehicle.is_actively_travelling
                ? "#2563eb"
                : vehicle.status === "in_transit"
                ? "#0d9488"
                : "#64748b";

              return (
                <CircleMarker
                  key={vehicle.id}
                  center={[vehicle.lat, vehicle.lng]}
                  radius={vehicle.is_actively_travelling ? 10 : 8}
                  pathOptions={{
                    color: markerColor,
                    fillColor: markerColor,
                    fillOpacity: 0.85,
                    weight: vehicle.is_actively_travelling ? 3 : 2,
                  }}
                >
                  <Popup>
                    <div className="p-1 min-w-[220px] text-xs space-y-2">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-1 font-bold">
                        <span className="text-slate-900">{vehicle.registration_number}</span>
                        <span
                          className={`capitalize text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            vehicle.is_actively_travelling
                              ? "bg-blue-100 text-blue-800"
                              : vehicle.late
                              ? "bg-red-100 text-red-800"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {vehicle.is_actively_travelling ? "Active Trip" : vehicle.status.replace("_", " ")}
                        </span>
                      </div>

                      {vehicle.driver_name && (
                        <div className="text-slate-600">
                          <span className="font-medium text-slate-800">Driver:</span> {vehicle.driver_name}
                          {vehicle.driver_phone && (
                            <span className="block text-[11px] text-slate-500">📞 {vehicle.driver_phone}</span>
                          )}
                        </div>
                      )}

                      {vehicle.shipment_ref && (
                        <div className="text-slate-600">
                          <span className="font-medium text-slate-800">Shipment:</span> {vehicle.shipment_ref}
                        </div>
                      )}

                      {vehicle.pickup_address && vehicle.delivery_address && (
                        <div className="text-[11px] text-slate-500 border-t border-slate-100 pt-1 space-y-0.5">
                          <div className="truncate">
                            <span className="font-semibold text-emerald-700">From:</span> {vehicle.pickup_address}
                          </div>
                          <div className="truncate">
                            <span className="font-semibold text-blue-700">To:</span> {vehicle.delivery_address}
                          </div>
                        </div>
                      )}

                      {vehicle.progress !== null && (
                        <div className="border-t border-slate-100 pt-1">
                          <div className="flex justify-between text-[11px] mb-1">
                            <span className="text-slate-500">Trip progress</span>
                            <span className="font-bold text-slate-800">{Math.round(vehicle.progress * 100)}%</span>
                          </div>
                          <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="bg-brand-600 h-1.5 rounded-full transition-all duration-500"
                              style={{ width: `${Math.min(100, Math.round(vehicle.progress * 100))}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {vehicle.remaining_distance_km !== null && vehicle.remaining_distance_km !== undefined && (
                        <div className="text-[11px] text-slate-500">
                          Remaining:{" "}
                          <span className="font-semibold text-slate-700">{vehicle.remaining_distance_km} km</span>
                          {vehicle.total_distance_km ? ` of ${vehicle.total_distance_km} km` : ""}
                        </div>
                      )}

                      {vehicle.shipment_id && (
                        <div className="pt-1.5 border-t border-slate-100">
                          <button
                            type="button"
                            className="w-full flex items-center justify-center gap-1.5 py-1 px-2 rounded bg-brand-700 text-white text-xs font-medium hover:bg-brand-800 transition cursor-pointer"
                            onClick={() => setRouteTarget({ shipmentId: vehicle.shipment_id ?? undefined })}
                          >
                            <MapIconLucide size={12} /> Check Route
                          </button>
                        </div>
                      )}
                    </div>
                  </Popup>
                </CircleMarker>
              );
            })}
          </MapContainer>
        ) : (
          <div className="p-8 text-center text-sm text-slate-500">
            {query.isLoading ? "Loading fleet positions…" : "No vehicles have coordinates to display."}
          </div>
        )}
      </Card>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-full bg-blue-600" />
          In Transit (actively travelling)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-full bg-teal-600" />
          Assigned / In Transit
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-full bg-slate-500" />
          Available / Idle
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-full bg-red-600" />
          Overdue
        </span>
      </div>

      {/* Slide-over Route Drawer */}
      <RouteDrawer
        open={Boolean(routeTarget)}
        shipmentId={routeTarget?.shipmentId}
        tripId={routeTarget?.tripId}
        onClose={() => setRouteTarget(null)}
      />
    </div>
  );
}

export function MaintenancePage() {
  const canManage = useCanManageOperations();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [cancelTarget, setCancelTarget] = useState<Maintenance | null>(null);
  const [completing, setCompleting] = useState<Maintenance | null>(null);
  const [editing, setEditing] = useState<Maintenance | null>(null);
  const [notice, setNotice] = useState("");
  const rows = useList<Maintenance>("maintenance", "/maintenance/", {
    status: status || undefined,
    search: search || undefined,
  });
  const vehicles = useList<Vehicle>("vehicles", "/vehicles/");
  const create = useWrite("/maintenance/");
  const update = useWrite("/maintenance/", "patch");
  const action = useWrite("/maintenance/");
  return <div>
    <PageHeader title="Maintenance" subtitle="Schedule service and record completed work." action={canManage ? <Button onClick={() => setOpen(true)}>Schedule maintenance</Button> : undefined} />
    {notice && <Banner tone="success">{notice}</Banner>}
    {rows.isError && <Banner tone="error">Could not load maintenance records.</Banner>}
    {vehicles.isError && <Banner tone="error">Could not load vehicles for maintenance scheduling.</Banner>}
    <Card>
      <div className="flex flex-wrap gap-3 border-b border-slate-200 p-4">
        <input
          className={`${inputClass} min-w-56 flex-1`}
          aria-label="Search maintenance"
          placeholder="Search description or vehicle registration"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          className={`${inputClass} max-w-xs`}
          aria-label="Filter maintenance by status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">All statuses</option>
          {["scheduled", "in_progress", "completed", "cancelled"].map((value) => (
            <option key={value} value={value}>{value.replace("_", " ")}</option>
          ))}
        </select>
      </div>
      <DataTable rows={rows.data} empty="No maintenance records" columns={[
        { title: "Vehicle", render: (row) => row.vehicle_reg },
        { title: "Type", render: (row) => row.kind },
        { title: "Description", render: (row) => <span>{row.description}{row.notes && <span className="block text-xs text-slate-500">{row.notes}</span>}</span> },
        { title: "Scheduled", render: (row) => row.scheduled_date },
        { title: "Est. cost", render: (row) => `₹${Number(row.estimated_cost).toLocaleString()}` },
        { title: "Status", render: (row) => <StatusBadge status={row.status} /> },
        { title: "Action", render: (row) => !canManage ? "—" : row.status === "scheduled" ? <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setEditing(row)}>Edit</Button><Button onClick={() => action.mutate({ path: `${row.id}/start/` }, { onSuccess: () => setNotice("Maintenance started; the vehicle is now unavailable for assignment.") })}>Start</Button><Button variant="secondary" onClick={() => setCancelTarget(row)}>Cancel</Button></div> : row.status === "in_progress" ? <Button onClick={() => setCompleting(row)}>Complete</Button> : row.status === "completed" ? `Completed · ₹${Number(row.cost).toLocaleString()}` : "—" },
      ]} />
    </Card>
    {canManage && <RecordModal
      open={open || Boolean(editing)}
      title={editing ? "Edit scheduled maintenance" : "Schedule maintenance"}
      onClose={() => {
      setOpen(false);
      setEditing(null);
      }}
      submitDisabled={create.isPending || update.isPending}
      onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const body = Object.fromEntries(form);
      const mutation = editing ? update : create;
      mutation.mutate(
        {
          path: editing ? `${editing.id}/` : "",
          body,
        },
        {
          onSuccess: () => {
            setOpen(false);
            setEditing(null);
            setNotice(editing ? "Scheduled maintenance updated." : "Maintenance scheduled.");
          },
        },
      );
      }}
    >
      <Field label="Vehicle"><select className={inputClass} name="vehicle" required defaultValue={editing ? String(editing.vehicle) : ""}><option value="">Select vehicle</option>{vehicles.data?.map((item) => <option key={item.id} value={item.id}>{item.registration_number} · {item.status.replace("_", " ")}</option>)}</select></Field>
      <Field label="Type"><select className={inputClass} name="kind" defaultValue={editing?.kind ?? "scheduled"}><option value="scheduled">Scheduled service</option><option value="preventive">Preventive maintenance</option><option value="repair">Repair</option></select></Field>
      <TextField label="Description" name="description" defaultValue={editing?.description} />
      <TextField label="Scheduled date" name="scheduled_date" type="date" defaultValue={editing?.scheduled_date} />
      <TextField label="Estimated cost (₹)" name="estimated_cost" type="number" defaultValue={editing?.estimated_cost ?? "0"} />
      <Field label="Notes"><textarea className={inputClass} name="notes" defaultValue={editing?.notes ?? ""} /></Field>
    </RecordModal>}
    {canManage && <RecordModal
      open={Boolean(completing)}
      title={`Complete maintenance${completing ? ` · ${completing.vehicle_reg}` : ""}`}
      onClose={() => setCompleting(null)}
      submitDisabled={action.isPending}
      onSubmit={(event) => {
        event.preventDefault();
        if (!completing) return;
        const form = new FormData(event.currentTarget);
        action.mutate(
          {
            path: `${completing.id}/complete/`,
            body: {
              cost: form.get("cost"),
              odometer_km: form.get("odometer_km"),
            },
          },
          {
            onSuccess: () => {
              setCompleting(null);
              setNotice("Maintenance completed and any eligible expense recorded.");
            },
          },
        );
      }}
    >
      <TextField label="Actual cost (₹)" name="cost" type="number" />
      <TextField label="Odometer (km)" name="odometer_km" type="number" required={false} />
    </RecordModal>}
    <ConfirmDialog
      open={Boolean(cancelTarget)}
      title="Cancel scheduled maintenance?"
      message={
        cancelTarget
          ? `Cancel maintenance for ${cancelTarget.vehicle_reg}: ${cancelTarget.description}? This cannot be undone.`
          : ""
      }
      confirmLabel="Cancel maintenance"
      busy={action.isPending}
      onCancel={() => setCancelTarget(null)}
      onConfirm={() => {
        if (!cancelTarget) return;
        action.mutate(
          { path: `${cancelTarget.id}/cancel/` },
          {
            onSuccess: () => {
              setCancelTarget(null);
              setNotice("Scheduled maintenance cancelled.");
            },
          },
        );
      }}
    />
  </div>;
}

export function ExpensesPage() {
  const canManage = useCanManageOperations();
  const [open, setOpen] = useState(false);
  const rows = useList<Expense>("expenses", "/expenses/");
  const vehicles = useList<Vehicle>("vehicles", "/vehicles/");
  const summary = useQuery({ queryKey: ["expense-summary"], queryFn: async () => (await api.get<{ total: number; by_category: Record<string, number>; fuel_litres: number }>("/expenses/summary/")).data });
  const create = useWrite("/expenses/");
  return <div>
    <PageHeader title="Fuel & Expenses" subtitle="Record fleet costs and review expense totals." action={canManage ? <Button onClick={() => setOpen(true)}>Add expense</Button> : undefined} />
    {rows.isError && <Banner tone="error">Could not load expenses.</Banner>}
    {summary.isError && <Banner tone="error">Could not load expense summary.</Banner>}
    {summary.data && <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card className="p-4"><p className="text-sm text-slate-500">Total expenses</p><p className="mt-1 text-xl font-semibold">₹{summary.data.total.toLocaleString()}</p></Card>
      <Card className="p-4"><p className="text-sm text-slate-500">Fuel litres</p><p className="mt-1 text-xl font-semibold">{summary.data.fuel_litres.toLocaleString()}</p></Card>
      {Object.entries(summary.data.by_category).map(([category, amount]) => <Card key={category} className="p-4"><p className="text-sm capitalize text-slate-500">{category}</p><p className="mt-1 text-xl font-semibold">₹{amount.toLocaleString()}</p></Card>)}
    </div>}
    <Card><DataTable rows={rows.data} empty="No expenses recorded" columns={[
      { title: "Date", render: (row) => row.date },
      { title: "Category", render: (row) => <span className="capitalize">{row.category}</span> },
      { title: "Vehicle", render: (row) => row.vehicle_reg },
      { title: "Amount", render: (row) => `₹${Number(row.amount).toLocaleString()}` },
      { title: "Litres", render: (row) => row.litres ?? "—" },
      { title: "Note", render: (row) => row.note || "—" },
    ]} /></Card>
    {canManage && <RecordModal open={open} title="Add expense" onClose={() => setOpen(false)} onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const category = String(form.get("category"));
      const body = Object.fromEntries([...form].filter(([key, value]) => value !== "" && !(category !== "fuel" && ["litres", "unit_price"].includes(key))));
      create.mutate({ body }, { onSuccess: () => setOpen(false) });
    }}>
      <Field label="Vehicle"><select className={inputClass} name="vehicle" required><option value="">Select vehicle</option>{vehicles.data?.map((item) => <option key={item.id} value={item.id}>{item.registration_number}</option>)}</select></Field>
      <Field label="Category"><select className={inputClass} name="category"><option value="fuel">Fuel</option><option value="toll">Toll</option><option value="maintenance">Maintenance</option><option value="other">Other</option></select></Field>
      <TextField label="Date" name="date" type="date" />
      <TextField label="Amount (₹), ignored for fuel" name="amount" type="number" required={false} />
      <div className="grid grid-cols-2 gap-3"><TextField label="Fuel litres" name="litres" type="number" required={false} /><TextField label="Price per litre" name="unit_price" type="number" required={false} /></div>
      <TextField label="Note" name="note" required={false} />
    </RecordModal>}
  </div>;
}

export function AlertsPage() {
  const canManage = useCanManageOperations();
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get("status") ?? "";
  const rows = useList<Alert>("alerts", "/alerts/", { status: status || undefined });
  const action = useWrite("/alerts/");
  return <div>
    <PageHeader title="Alerts" subtitle="Monitor deadlines, documents, maintenance and unusual costs." action={<Button onClick={() => action.mutate({ path: "refresh/" })}>Refresh alerts</Button>} />
    {rows.isError && <Banner tone="error">Could not load alerts.</Banner>}
    <Card>
      <div className="border-b border-slate-200 p-4">
        <select className={`${inputClass} max-w-xs`} aria-label="Filter alerts by status" value={status} onChange={(event) => {
          const next = new URLSearchParams(searchParams);
          if (event.target.value) next.set("status", event.target.value);
          else next.delete("status");
          setSearchParams(next);
        }}>
          <option value="">All alert statuses</option>
          {["open", "acknowledged", "resolved"].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>
      <DataTable rows={rows.data} empty="No alerts found" columns={[
      { title: "Severity", render: (row) => <StatusBadge status={row.severity} /> },
      { title: "Category", render: (row) => <span className="capitalize">{row.category}</span> },
      { title: "Alert", render: (row) => row.message },
      { title: "Related", render: (row) => row.shipment_ref ?? row.vehicle_reg ?? "—" },
      { title: "Created", render: (row) => new Date(row.created_at).toLocaleString() },
      { title: "Status / action", render: (row) => row.status === "open" ? <div className="flex items-center gap-2"><StatusBadge status={row.status} />{canManage && <Button onClick={() => action.mutate({ path: `${row.id}/acknowledge/` })}>Acknowledge</Button>}</div> : row.status === "acknowledged" ? <div className="flex items-center gap-2"><StatusBadge status={row.status} />{canManage && <Button variant="secondary" onClick={() => action.mutate({ path: `${row.id}/resolve/` })}>Resolve</Button>}</div> : <StatusBadge status={row.status} /> },
    ]} /></Card>
  </div>;
}

type Analytics = {
  daily: { date: string; created: number; delivered: number; late: number }[];
  deliveries: number;
  on_time_rate: number | null;
  avg_delivery_minutes: number | null;
  fleet_utilization: number | null;
  costs: Record<string, number>;
  emissions: { total_kg_co2: number; assumptions: string[] };
};

export function AnalyticsPage() {
  const [end, setEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [start, setStart] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 29);
    return date.toISOString().slice(0, 10);
  });
  const query = useQuery({
    queryKey: ["analytics", start, end],
    queryFn: async () => (await api.get<Analytics>("/analytics/trends/", { params: { from: start, to: end } })).data,
    enabled: start <= end,
  });
  const exportCsv = async () => {
    try {
      const { data } = await api.get("/analytics/export/", { params: { from: start, to: end }, responseType: "blob" });
      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url;
      link.download = "trips.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      window.alert(apiError(error));
    }
  };
  return <div>
    <PageHeader title="Analytics" subtitle="Delivery, fleet, cost and emissions estimates." action={<Button variant="secondary" onClick={exportCsv}>Export trips CSV</Button>} />
    <Card className="mb-4 flex flex-wrap items-end gap-3 p-4">
      <Field label="From"><input className={inputClass} type="date" value={start} onChange={(event) => setStart(event.target.value)} /></Field>
      <Field label="To"><input className={inputClass} type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></Field>
    </Card>
    {start > end && <Banner tone="error">Start date must be on or before end date.</Banner>}
    {query.isError && <Banner tone="error">Could not load analytics for this date range.</Banner>}
    {query.data && <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Completed deliveries", query.data.deliveries],
          ["On-time rate", query.data.on_time_rate === null ? "—" : `${query.data.on_time_rate}%`],
          ["Fleet utilization", query.data.fleet_utilization === null ? "—" : `${query.data.fleet_utilization}%`],
          ["Estimated CO₂", `${query.data.emissions.total_kg_co2} kg`],
        ].map(([label, value]) => <Card key={label} className="p-4"><p className="text-sm text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></Card>)}
      </div>
      <Card className="mb-4 p-4"><h2 className="mb-3 text-sm font-medium">Daily shipments</h2><ResponsiveContainer width="100%" height={300}>
        <AreaChart data={query.data.daily}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} /><Tooltip /><Legend /><Area type="monotone" dataKey="created" stroke="#14625f" fill="#14625f" fillOpacity={0.15} /><Area type="monotone" dataKey="delivered" stroke="#2563eb" fill="#2563eb" fillOpacity={0.12} /><Area type="monotone" dataKey="late" stroke="#dc2626" fill="#dc2626" fillOpacity={0.1} /></AreaChart>
      </ResponsiveContainer></Card>
      <Card className="p-4"><h2 className="mb-3 text-sm font-medium">Costs and estimates</h2><p className="mb-3 text-sm">Total recorded costs: <strong>₹{(query.data.costs.total ?? 0).toLocaleString()}</strong></p><ul className="list-inside list-disc text-sm text-slate-600">{query.data.emissions.assumptions.map((text) => <li key={text}>{text}</li>)}</ul></Card>
    </>}
  </div>;
}
