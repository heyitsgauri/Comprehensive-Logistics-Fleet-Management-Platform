import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Phone,
  Send,
  Truck,
} from "lucide-react";
import { api } from "../api/client";
import { Button, Modal } from "./ui";
import type { Driver, Shipment, Vehicle } from "../types";
import { apiError } from "../utils/errors";

export function DispatchModal({
  open,
  shipment,
  onClose,
  onDispatched,
}: {
  open: boolean;
  shipment: Shipment | null;
  onClose: () => void;
  onDispatched?: () => void;
}) {
  const queryClient = useQueryClient();
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(
    shipment?.active_dispatch?.vehicle_id ?? null,
  );
  const [selectedDriverId, setSelectedDriverId] = useState<number | null>(
    shipment?.active_dispatch?.driver_id ?? null,
  );
  const [resultNotice, setResultNotice] = useState<{
    tone: "success" | "error" | "warn";
    message: string;
    canRetrySms?: boolean;
    dispatchId?: number;
  } | null>(null);

  // Fetch eligible vehicles and drivers
  const eligibility = useQuery({
    queryKey: ["shipment-eligibility", shipment?.id],
    queryFn: async () => {
      return (
        await api.get<{
          vehicles: (Vehicle & { eligible: boolean; issues: string[] })[];
          drivers: (Driver & { eligible: boolean; issues: string[] })[];
        }>(`/shipments/${shipment!.id}/eligible/`)
      ).data;
    },
    enabled: Boolean(open && shipment?.id),
  });

  // Fetch planned route preview (distance and ETA)
  const routePreview = useQuery({
    queryKey: [
      "route-preview",
      shipment?.pickup_lat,
      shipment?.pickup_lng,
      shipment?.delivery_lat,
      shipment?.delivery_lng,
    ],
    queryFn: async () => {
      return (
        await api.get<{
          distance_km: number;
          duration_min: number;
          eta: string;
        }>("/trips/route-preview/", {
          params: {
            from_lat: shipment!.pickup_lat,
            from_lng: shipment!.pickup_lng,
            to_lat: shipment!.delivery_lat,
            to_lng: shipment!.delivery_lng,
          },
        })
      ).data;
    },
    enabled: Boolean(open && shipment),
  });

  // Dispatch mutation
  const dispatchMutation = useMutation({
    mutationFn: async (payload: {
      vehicle_id: number;
      driver_id: number;
      retry_sms?: boolean;
    }) => {
      const resp = await api.post(
        `/shipments/${shipment!.id}/dispatch/`,
        payload,
      );
      return resp.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["shipments"] });
      queryClient.invalidateQueries({ queryKey: ["shipment", String(shipment?.id)] });
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });

      const dispatchInfo = data.dispatch;
      if (dispatchInfo?.sms_status === "failed") {
        setResultNotice({
          tone: "warn",
          message: `Dispatch request created for ${dispatchInfo.driver_name}, but SMS notification delivery failed: ${
            dispatchInfo.sms_error || "Provider error"
          }. You can retry SMS below.`,
          canRetrySms: true,
          dispatchId: dispatchInfo.id,
        });
      } else {
        setResultNotice({
          tone: "success",
          message: `Dispatch successfully sent to ${dispatchInfo.driver_name}! An SMS was sent to ${dispatchInfo.driver_phone} and status is Awaiting Driver Acceptance.`,
        });
        if (onDispatched) onDispatched();
      }
    },
    onError: (err) => {
      setResultNotice({
        tone: "error",
        message: apiError(err),
      });
    },
  });

  // SMS retry mutation
  const retrySmsMutation = useMutation({
    mutationFn: async (dispatchId: number) => {
      return (await api.post(`/dispatches/${dispatchId}/retry_sms/`)).data;
    },
    onSuccess: (data) => {
      if (data.sms_status === "sent") {
        setResultNotice({
          tone: "success",
          message: `SMS notification successfully delivered to ${data.driver_name} (${data.driver_phone}).`,
        });
      } else {
        setResultNotice({
          tone: "error",
          message: `SMS retry failed: ${data.sms_error || "Unknown error"}.`,
          canRetrySms: true,
          dispatchId: data.id,
        });
      }
    },
  });

  if (!open || !shipment) return null;

  const selectedVehicle = eligibility.data?.vehicles.find(
    (v) => v.id === selectedVehicleId,
  );
  const selectedDriver = eligibility.data?.drivers.find(
    (d) => d.id === selectedDriverId,
  );

  const canConfirm =
    Boolean(selectedVehicle && selectedVehicle.eligible) &&
    Boolean(selectedDriver && selectedDriver.eligible) &&
    !dispatchMutation.isPending;

  return (
    <Modal open={open} title="Confirm Shipment Dispatch" onClose={onClose}>
      <div className="space-y-4">
        {resultNotice && (
          <div
            className={`rounded-lg p-3 text-sm ${
              resultNotice.tone === "success"
                ? "bg-green-50 text-green-800 border border-green-200"
                : resultNotice.tone === "warn"
                  ? "bg-amber-50 text-amber-800 border border-amber-200"
                  : "bg-red-50 text-red-800 border border-red-200"
            }`}
          >
            <div className="flex items-start gap-2">
              {resultNotice.tone === "success" ? (
                <CheckCircle2 size={16} className="mt-0.5 text-green-600 shrink-0" />
              ) : (
                <AlertTriangle size={16} className="mt-0.5 text-amber-600 shrink-0" />
              )}
              <div className="flex-1">
                <p>{resultNotice.message}</p>
                {resultNotice.canRetrySms && resultNotice.dispatchId && (
                  <Button
                    variant="secondary"
                    className="mt-2 text-xs py-1 px-2.5"
                    disabled={retrySmsMutation.isPending}
                    onClick={() =>
                      retrySmsMutation.mutate(resultNotice.dispatchId!)
                    }
                  >
                    {retrySmsMutation.isPending ? "Retrying SMS…" : "Retry Sending SMS"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Shipment Overview Box */}
        <div className="rounded-lg bg-slate-50 p-4 border border-slate-200 space-y-2">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Shipment Reference
              </span>
              <p className="text-base font-bold text-slate-900">
                {shipment.reference}
              </p>
            </div>
            <div className="text-right">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Customer
              </span>
              <p className="text-sm font-semibold text-slate-800">
                {shipment.customer_name}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-slate-500">Cargo:</span>{" "}
              <strong className="text-slate-800">
                {shipment.cargo_description}
              </strong>
            </div>
            <div>
              <span className="text-slate-500">Weight:</span>{" "}
              <strong className="text-slate-800">{shipment.weight_kg} kg</strong>
            </div>
            <div>
              <span className="text-slate-500">Deadline:</span>{" "}
              <strong className="text-slate-800">
                {new Date(shipment.deadline).toLocaleString()}
              </strong>
            </div>
            <div>
              <span className="text-slate-500">Distance &amp; ETA:</span>{" "}
              <strong className="text-brand-700">
                {routePreview.data
                  ? `${routePreview.data.distance_km} km · ETA ${new Date(
                      routePreview.data.eta,
                    ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                  : "Calculating route…"}
              </strong>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 border-t border-slate-200 pt-2 text-xs">
            <div>
              <span className="text-slate-500 block">Pickup:</span>
              <span className="font-medium text-slate-900">
                {shipment.pickup_address}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block">Delivery:</span>
              <span className="font-medium text-slate-900">
                {shipment.delivery_address}
              </span>
            </div>
          </div>
        </div>

        {/* Assigned Vehicle Selection / Confirmation */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
            Assigned Vehicle
          </label>
          {eligibility.isLoading ? (
            <p className="text-xs text-slate-500">Loading fleet eligibility…</p>
          ) : (
            <select
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-700 focus:outline-none"
              value={selectedVehicleId ?? ""}
              onChange={(e) =>
                setSelectedVehicleId(e.target.value ? Number(e.target.value) : null)
              }
            >
              <option value="">Select vehicle</option>
              {eligibility.data?.vehicles.map((v) => (
                <option key={v.id} value={v.id} disabled={!v.eligible}>
                  {v.registration_number} · Capacity {v.capacity_kg} kg
                  {!v.eligible ? ` (${v.issues.join(", ")})` : " (Eligible)"}
                </option>
              ))}
            </select>
          )}
          {selectedVehicle && (
            <p className="text-xs text-slate-500 flex items-center gap-1">
              <Truck size={12} /> {selectedVehicle.vehicle_type} · {selectedVehicle.make}{" "}
              {selectedVehicle.model} · Cap {selectedVehicle.capacity_kg} kg
            </p>
          )}
        </div>

        {/* Assigned Driver Selection / Confirmation */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600">
            Assigned Driver
          </label>
          {eligibility.isLoading ? (
            <p className="text-xs text-slate-500">Loading driver eligibility…</p>
          ) : (
            <select
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-700 focus:outline-none"
              value={selectedDriverId ?? ""}
              onChange={(e) =>
                setSelectedDriverId(e.target.value ? Number(e.target.value) : null)
              }
            >
              <option value="">Select driver</option>
              {eligibility.data?.drivers.map((d) => (
                <option key={d.id} value={d.id} disabled={!d.eligible}>
                  {d.full_name} · {d.phone}
                  {!d.eligible ? ` (${d.issues.join(", ")})` : " (Eligible)"}
                </option>
              ))}
            </select>
          )}
          {selectedDriver && (
            <p className="text-xs text-slate-500 flex items-center gap-1">
              <Phone size={12} /> SMS will be sent to registered mobile:{" "}
              <strong>{selectedDriver.phone}</strong>
            </p>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!canConfirm}
            onClick={() => {
              if (selectedVehicleId && selectedDriverId) {
                dispatchMutation.mutate({
                  vehicle_id: selectedVehicleId,
                  driver_id: selectedDriverId,
                });
              }
            }}
          >
            <Send size={14} />
            {dispatchMutation.isPending
              ? "Dispatching & Sending SMS…"
              : "Confirm Dispatch"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
