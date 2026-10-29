import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../auth/useAuth";
import {
  Banner,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  Pagination,
  StatusBadge,
  inputClass,
} from "../components/ui";
import VehicleFormModal from "../features/vehicles/VehicleFormModal";
import { useDebounce } from "../hooks/useDebounce";
import type { Paginated, Vehicle } from "../types";
import { apiError } from "../utils/errors";

export default function VehiclesPage() {
  const { user } = useAuth();
  const canWrite = user?.role === "admin" || user?.role === "fleet_manager";
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get("status") ?? "";
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [confirming, setConfirming] = useState<Vehicle | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const debouncedSearch = useDebounce(search);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["vehicles", { search: debouncedSearch, status, page }],
    queryFn: async () =>
      (
        await api.get<Paginated<Vehicle>>("/vehicles/", {
          params: {
            search: debouncedSearch || undefined,
            status: status || undefined,
            page,
          },
        })
      ).data,
  });

  const toggle = useMutation({
    mutationFn: async (vehicle: Vehicle) =>
      api.patch(`/vehicles/${vehicle.id}/`, {
        status: vehicle.status === "inactive" ? "available" : "inactive",
      }),
    onSuccess: (_response, vehicle) => {
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      flash(
        vehicle.status === "inactive"
          ? "Vehicle reactivated."
          : "Vehicle deactivated.",
      );
      setConfirming(null);
    },
    onError: (err) => {
      setError(apiError(err));
      setConfirming(null);
    },
  });

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3000);
  }

  function openForm(vehicle: Vehicle | null) {
    setEditing(vehicle);
    setFormOpen(true);
  }

  return (
    <div>
      <PageHeader
        title="Vehicles"
        subtitle="Manage the fleet and its availability."
        action={
          canWrite ? (
            <Button onClick={() => openForm(null)}>
              <Plus size={16} /> Add vehicle
            </Button>
          ) : undefined
        }
      />
      {notice && <Banner tone="success">{notice}</Banner>}
      {error && <Banner tone="error">{error}</Banner>}

      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-200 p-4">
          <div className="relative min-w-56 flex-1">
            <Search
              size={16}
              className="absolute left-3 top-2.5 text-slate-400"
            />
            <input
              aria-label="Search vehicles"
              className={`${inputClass} pl-9`}
              placeholder="Search registration, make or model"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <select
            aria-label="Filter by status"
            className={`${inputClass} w-48`}
            value={status}
            onChange={(event) => {
              const next = new URLSearchParams(searchParams);
              if (event.target.value) next.set("status", event.target.value);
              else next.delete("status");
              setSearchParams(next);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            <option value="available">Available</option>
            <option value="assigned">Assigned</option>
            <option value="in_transit">In transit</option>
            <option value="maintenance">Maintenance</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        {isLoading && (
          <p className="p-6 text-sm text-slate-500">Loading vehicles…</p>
        )}
        {isError && (
          <div className="p-4">
            <Banner tone="error">Could not load vehicles.</Banner>
          </div>
        )}
        {data && data.results.length === 0 && (
          <EmptyState
            title="No vehicles found"
            hint="Try clearing the filters, or add a vehicle."
          />
        )}
        {data && data.results.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2">Registration</th>
                  <th className="px-4 py-2">Vehicle</th>
                  <th className="px-4 py-2">Capacity</th>
                  <th className="px-4 py-2">Fuel</th>
                  <th className="px-4 py-2">Odometer</th>
                  <th className="px-4 py-2">Insurance</th>
                  <th className="px-4 py-2">Status</th>
                  {canWrite && (
                    <th className="px-4 py-2 text-right">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.results.map((vehicle) => (
                  <tr key={vehicle.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {vehicle.registration_number}
                    </td>
                    <td className="px-4 py-3">
                      {vehicle.vehicle_type} · {vehicle.make} {vehicle.model}
                    </td>
                    <td className="px-4 py-3">
                      {Number(vehicle.capacity_kg).toLocaleString()} kg
                    </td>
                    <td className="px-4 py-3 capitalize">
                      {vehicle.fuel_type}
                    </td>
                    <td className="px-4 py-3">
                      {vehicle.odometer_km.toLocaleString()} km
                    </td>
                    <td className="px-4 py-3">
                      {vehicle.insurance_expiry ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={vehicle.status} />
                    </td>
                    {canWrite && (
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="secondary"
                            onClick={() => openForm(vehicle)}
                          >
                            Edit
                          </Button>
                          {vehicle.status === "inactive" ? (
                            <Button
                              variant="secondary"
                              onClick={() => toggle.mutate(vehicle)}
                              disabled={toggle.isPending}
                            >
                              Reactivate
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              onClick={() => {
                                setError("");
                                setConfirming(vehicle);
                              }}
                              disabled={
                                toggle.isPending ||
                                ["assigned", "in_transit"].includes(
                                  vehicle.status,
                                )
                              }
                            >
                              Deactivate
                            </Button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.count > 0 && (
          <Pagination page={page} count={data.count} onPage={setPage} />
        )}
      </Card>

      <VehicleFormModal
        open={formOpen}
        vehicle={editing}
        onClose={() => setFormOpen(false)}
        onSaved={(message) => {
          setFormOpen(false);
          flash(message);
        }}
      />
      <ConfirmDialog
        open={confirming !== null}
        title="Deactivate vehicle"
        message={`Deactivate ${confirming?.registration_number}? It will no longer be offered for new trips.`}
        confirmLabel="Deactivate"
        busy={toggle.isPending}
        onConfirm={() => confirming && toggle.mutate(confirming)}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}
