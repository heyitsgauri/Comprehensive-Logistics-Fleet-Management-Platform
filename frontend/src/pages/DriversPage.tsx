import { useState } from "react";
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
import DriverFormModal from "../features/drivers/DriverFormModal";
import { useDebounce } from "../hooks/useDebounce";
import type { Driver, Paginated } from "../types";
import { apiError } from "../utils/errors";

export default function DriversPage() {
  const { user } = useAuth();
  const canWrite = user?.role === "admin" || user?.role === "fleet_manager";
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Driver | null>(null);
  const [confirming, setConfirming] = useState<Driver | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const debouncedSearch = useDebounce(search);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["drivers", { search: debouncedSearch, status, page }],
    queryFn: async () =>
      (
        await api.get<Paginated<Driver>>("/drivers/", {
          params: {
            search: debouncedSearch || undefined,
            status: status || undefined,
            page,
          },
        })
      ).data,
  });

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3000);
  }

  const toggle = useMutation({
    mutationFn: async (driver: Driver) =>
      api.patch(`/drivers/${driver.id}/`, {
        status: driver.status === "inactive" ? "available" : "inactive",
      }),
    onSuccess: (_response, driver) => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      flash(
        driver.status === "inactive"
          ? "Driver reactivated."
          : "Driver deactivated.",
      );
      setConfirming(null);
    },
    onError: (err) => {
      setError(apiError(err));
      setConfirming(null);
    },
  });

  function openForm(driver: Driver | null) {
    setEditing(driver);
    setFormOpen(true);
  }

  return (
    <div>
      <PageHeader
        title="Drivers"
        subtitle="Driver records, licenses and availability."
        action={
          canWrite ? (
            <Button onClick={() => openForm(null)}>
              <Plus size={16} /> Add driver
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
              aria-label="Search drivers"
              className={`${inputClass} pl-9`}
              placeholder="Search name, license or phone"
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
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            <option value="available">Available</option>
            <option value="assigned">Assigned</option>
            <option value="on_trip">On trip</option>
            <option value="off_duty">Off duty</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        {isLoading && (
          <p className="p-6 text-sm text-slate-500">Loading drivers…</p>
        )}
        {isError && (
          <div className="p-4">
            <Banner tone="error">Could not load drivers.</Banner>
          </div>
        )}
        {data && data.results.length === 0 && (
          <EmptyState
            title="No drivers found"
            hint="Try clearing the filters, or add a driver."
          />
        )}
        {data && data.results.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Phone</th>
                  <th className="px-4 py-2">License</th>
                  <th className="px-4 py-2">License expiry</th>
                  <th className="px-4 py-2">Status</th>
                  {canWrite && (
                    <th className="px-4 py-2 text-right">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.results.map((driver) => (
                  <tr key={driver.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {driver.full_name}
                    </td>
                    <td className="px-4 py-3">{driver.phone}</td>
                    <td className="px-4 py-3">{driver.license_number}</td>
                    <td className="px-4 py-3">
                      {driver.license_expiry}
                      {!driver.license_valid && (
                        <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700">
                          Expired
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={driver.status} />
                    </td>
                    {canWrite && (
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="secondary"
                            onClick={() => openForm(driver)}
                          >
                            Edit
                          </Button>
                          {driver.status === "inactive" ? (
                            <Button
                              variant="secondary"
                              onClick={() => toggle.mutate(driver)}
                              disabled={toggle.isPending}
                            >
                              Reactivate
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              onClick={() => {
                                setError("");
                                setConfirming(driver);
                              }}
                              disabled={
                                toggle.isPending ||
                                ["assigned", "on_trip"].includes(driver.status)
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

      <DriverFormModal
        open={formOpen}
        driver={editing}
        onClose={() => setFormOpen(false)}
        onSaved={(message) => {
          setFormOpen(false);
          flash(message);
        }}
      />
      <ConfirmDialog
        open={confirming !== null}
        title="Deactivate driver"
        message={`Deactivate ${confirming?.full_name}? They will no longer be offered for new trips.`}
        confirmLabel="Deactivate"
        busy={toggle.isPending}
        onConfirm={() => confirming && toggle.mutate(confirming)}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}
