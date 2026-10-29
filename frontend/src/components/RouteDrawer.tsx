import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CircleMarker,
  MapContainer,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import {
  Calendar,
  Clock,
  MapPin,
  Navigation,
  Phone,
  Truck,
  User,
  X,
} from "lucide-react";
import { api } from "../api/client";
import { Button, Card, StatusBadge } from "./ui";
import type { RouteDetails } from "../types";

function FitBounds({ coords }: { coords: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (coords && coords.length > 1) {
      map.fitBounds(coords, { padding: [40, 40] });
    }
  }, [coords, map]);
  return null;
}

export function RouteDrawer({
  open,
  shipmentId,
  tripId,
  onClose,
}: {
  open: boolean;
  shipmentId?: number | null;
  tripId?: number | null;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: ["route-details", shipmentId, tripId],
    queryFn: async () => {
      if (shipmentId) {
        return (
          await api.get<RouteDetails>(
            `/shipments/${shipmentId}/route-details/`,
          )
        ).data;
      }
      return (
        await api.get<RouteDetails>(`/trips/${tripId}/route-details/`)
      ).data;
    },
    enabled: Boolean(open && (shipmentId || tripId)),
    refetchInterval: 10000,
  });

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    if (open) {
      window.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  const data = query.data;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/50 transition-opacity backdrop-blur-xs">
      <div
        className="relative flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl transition-transform"
        role="dialog"
        aria-label="Route Tracking Drawer"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-slate-900">
                Route Tracking &amp; Progress
              </h2>
              {data && <StatusBadge status={data.status} />}
            </div>
            <p className="text-xs text-slate-500">
              Shipment {data?.shipment.reference ?? "..."} · Planned via OSRM
              road routing
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close route panel"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {query.isLoading && (
            <div className="py-20 text-center text-sm text-slate-500">
              Calculating real-time route geometry and vehicle coordinates…
            </div>
          )}

          {query.isError && (
            <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
              Could not load route details. Please verify backend routing
              service.
            </div>
          )}

          {data && (
            <>
              {/* Interactive Map */}
              <div className="overflow-hidden rounded-xl border border-slate-200 shadow-xs">
                <div className="h-72 w-full">
                  <MapContainer
                    center={data.current_location}
                    zoom={7}
                    scrollWheelZoom={false}
                    className="h-full w-full"
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    {data.full_route?.length > 1 && (
                      <FitBounds coords={data.full_route} />
                    )}

                    {/* Covered portion: solid blue */}
                    {data.covered_route?.length > 1 && (
                      <Polyline
                        positions={data.covered_route}
                        pathOptions={{ color: "#2563eb", weight: 5, opacity: 0.85 }}
                      />
                    )}

                    {/* Remaining portion: dashed neutral */}
                    {data.remaining_route?.length > 1 && (
                      <Polyline
                        positions={data.remaining_route}
                        pathOptions={{
                          color: "#94a3b8",
                          weight: 4,
                          dashArray: "6, 8",
                          opacity: 0.75,
                        }}
                      />
                    )}

                    {/* Pickup marker */}
                    <CircleMarker
                      center={data.shipment.pickup_coords}
                      radius={7}
                      pathOptions={{ color: "#16a34a", fillColor: "#22c55e", fillOpacity: 1 }}
                    >
                      <Popup>
                        <div className="text-xs">
                          <strong className="text-green-700">Pickup Location</strong>
                          <p>{data.shipment.pickup_address}</p>
                        </div>
                      </Popup>
                    </CircleMarker>

                    {/* Destination marker */}
                    <CircleMarker
                      center={data.shipment.delivery_coords}
                      radius={7}
                      pathOptions={{ color: "#dc2626", fillColor: "#ef4444", fillOpacity: 1 }}
                    >
                      <Popup>
                        <div className="text-xs">
                          <strong className="text-red-700">Destination Location</strong>
                          <p>{data.shipment.delivery_address}</p>
                        </div>
                      </Popup>
                    </CircleMarker>

                    {/* Live Vehicle Location Marker */}
                    <CircleMarker
                      center={data.current_location}
                      radius={9}
                      pathOptions={{
                        color: "#1d4ed8",
                        fillColor: "#3b82f6",
                        fillOpacity: 1,
                        weight: 2,
                      }}
                    >
                      <Popup>
                        <div className="text-xs">
                          <strong className="text-blue-700">
                            {data.vehicle.registration_number}
                          </strong>
                          <p>Driver: {data.driver.full_name}</p>
                          <p>Progress: {data.progress_percent}% covered</p>
                          <p className="text-[10px] text-slate-500">
                            Simulated GPS position
                          </p>
                        </div>
                      </Popup>
                    </CircleMarker>
                  </MapContainer>
                </div>
                <div className="flex items-center justify-between bg-slate-50 px-4 py-2 text-xs text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-600 animate-pulse" />
                    Simulated GPS Position ({data.current_location[0].toFixed(4)},{" "}
                    {data.current_location[1].toFixed(4)})
                  </span>
                  <span>
                    Last updated: {new Date(data.last_update).toLocaleTimeString()}
                  </span>
                </div>
              </div>

              {/* Progress Bar & Distance Metrics */}
              <Card className="p-4">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-700">Route Covered</span>
                  <span className="font-semibold text-brand-700">
                    {data.progress_percent}%
                  </span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full bg-brand-600 transition-all duration-500"
                    style={{ width: `${data.progress_percent}%` }}
                  />
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-lg bg-slate-50 p-2.5">
                    <div className="text-[11px] uppercase tracking-wider text-slate-500">
                      Total Distance
                    </div>
                    <div className="mt-1 text-base font-semibold text-slate-900">
                      {data.total_distance_km} km
                    </div>
                  </div>
                  <div className="rounded-lg bg-blue-50/60 p-2.5">
                    <div className="text-[11px] uppercase tracking-wider text-blue-700">
                      Covered
                    </div>
                    <div className="mt-1 text-base font-semibold text-blue-900">
                      {data.distance_covered_km} km
                    </div>
                  </div>
                  <div className="rounded-lg bg-amber-50/60 p-2.5">
                    <div className="text-[11px] uppercase tracking-wider text-amber-700">
                      Remaining
                    </div>
                    <div className="mt-1 text-base font-semibold text-amber-900">
                      {data.distance_remaining_km} km
                    </div>
                  </div>
                </div>
              </Card>

              {/* Timing & ETA Metrics */}
              <div className="grid grid-cols-2 gap-3">
                <Card className="p-4">
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                    <Clock size={14} className="text-slate-400" /> Planned Duration
                  </div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">
                    {Math.floor(data.planned_duration_min / 60) > 0
                      ? `${Math.floor(data.planned_duration_min / 60)}h `
                      : ""}
                    {data.planned_duration_min % 60}m
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    Started:{" "}
                    {data.started_at
                      ? new Date(data.started_at).toLocaleTimeString()
                      : "Not started"}
                  </div>
                </Card>

                <Card className="p-4">
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                    <Calendar size={14} className="text-slate-400" /> Current ETA
                  </div>
                  <div className="mt-1 text-lg font-semibold text-brand-700">
                    {new Date(data.estimated_arrival).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    Deadline:{" "}
                    {new Date(data.shipment.deadline).toLocaleTimeString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </Card>
              </div>

              {/* Assignment & Driver Information */}
              <Card className="p-4 space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Resource &amp; Cargo Details
                </h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-xs text-slate-500 flex items-center gap-1">
                      <Truck size={13} /> Assigned Vehicle
                    </span>
                    <span className="font-medium text-slate-900 block mt-0.5">
                      {data.vehicle.registration_number}
                    </span>
                    <span className="text-xs text-slate-500">
                      {data.vehicle.vehicle_type} · {data.vehicle.make}{" "}
                      {data.vehicle.model}
                    </span>
                  </div>

                  <div>
                    <span className="text-xs text-slate-500 flex items-center gap-1">
                      <User size={13} /> Assigned Driver
                    </span>
                    <span className="font-medium text-slate-900 block mt-0.5">
                      {data.driver.full_name}
                    </span>
                    <a
                      href={`tel:${data.driver.phone}`}
                      className="text-xs text-brand-700 hover:underline flex items-center gap-1 mt-0.5"
                    >
                      <Phone size={11} /> {data.driver.phone}
                    </a>
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-3">
                  <span className="text-xs text-slate-500">Cargo &amp; Weight:</span>
                  <span className="font-medium text-slate-800 ml-2">
                    {data.shipment.cargo_description} ({data.shipment.weight_kg} kg)
                  </span>
                </div>
              </Card>

              {/* Route Endpoints */}
              <Card className="p-4 space-y-3">
                <div className="flex items-start gap-3 text-sm">
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700">
                    <MapPin size={14} />
                  </div>
                  <div>
                    <span className="text-xs font-medium text-slate-500">
                      Pickup Origin
                    </span>
                    <p className="font-medium text-slate-900">
                      {data.shipment.pickup_address}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 text-sm border-t border-slate-100 pt-3">
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-700">
                    <Navigation size={14} />
                  </div>
                  <div>
                    <span className="text-xs font-medium text-slate-500">
                      Delivery Destination
                    </span>
                    <p className="font-medium text-slate-900">
                      {data.shipment.delivery_address}
                    </p>
                  </div>
                </div>
              </Card>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 bg-slate-50 px-6 py-3 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close Panel
          </Button>
        </div>
      </div>
    </div>
  );
}
