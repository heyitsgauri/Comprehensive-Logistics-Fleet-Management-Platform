import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  CheckCircle,
  MapPin,
  Navigation,
  Truck,
  XCircle,
} from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../auth/useAuth";
import { Banner, Button, Card, Modal, PageHeader, StatusBadge } from "../components/ui";
import { RouteDrawer } from "../components/RouteDrawer";
import type { DispatchRequest, Paginated } from "../types";
import { apiError } from "../utils/errors";

export default function DriverPortalPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  const [rejectingDispatchId, setRejectingDispatchId] = useState<number | null>(null);
  const [rejectionReason, setRejectionReason] = useState("schedule_conflict");
  const [rejectionNotes, setRejectionNotes] = useState("");
  const [routeShipmentId, setRouteShipmentId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

  // If token is provided, fetch specific dispatch
  const tokenQuery = useQuery({
    queryKey: ["driver-portal-token", token],
    queryFn: async () => {
      const resp = await api.get<DispatchRequest>("/driver/portal/", {
        params: { token },
      });
      return resp.data;
    },
    enabled: Boolean(token),
  });

  // If authenticated as driver, fetch list of assigned dispatches
  const listQuery = useQuery({
    queryKey: ["driver-my-dispatches"],
    queryFn: async () => {
      const resp = await api.get<Paginated<DispatchRequest>>("/dispatches/");
      return resp.data.results;
    },
    enabled: !token && Boolean(user),
    refetchInterval: 5000,
  });

  // Accept mutation
  const acceptMutation = useMutation({
    mutationFn: async ({
      dispatchId,
      token,
    }: {
      dispatchId?: number;
      token?: string;
    }) => {
      if (token) {
        return (
          await api.post("/driver/portal/", {
            token,
            action: "accept",
          })
        ).data;
      }
      return (await api.post(`/dispatches/${dispatchId}/accept/`)).data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries();
      setFeedback({
        tone: "success",
        message: `You accepted Shipment ${data.shipment_ref}! The fleet manager has been notified and will initiate the trip start.`,
      });
    },
    onError: (err) => {
      setFeedback({
        tone: "error",
        message: apiError(err),
      });
    },
  });

  // Reject mutation
  const rejectMutation = useMutation({
    mutationFn: async ({
      dispatchId,
      token,
      reason,
      notes,
    }: {
      dispatchId?: number;
      token?: string;
      reason: string;
      notes: string;
    }) => {
      if (token) {
        return (
          await api.post("/driver/portal/", {
            token,
            action: "reject",
            reason,
            notes,
          })
        ).data;
      }
      return (
        await api.post(`/dispatches/${dispatchId}/reject/`, {
          reason,
          notes,
        })
      ).data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries();
      setRejectingDispatchId(null);
      setFeedback({
        tone: "success",
        message: `You rejected Shipment ${data.shipment_ref}. The fleet manager has been alerted to reassign the delivery.`,
      });
    },
    onError: (err) => {
      setFeedback({
        tone: "error",
        message: apiError(err),
      });
    },
  });

  const assignments = token
    ? tokenQuery.data
      ? [tokenQuery.data]
      : []
    : listQuery.data ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Driver Portal"
        subtitle={
          token
            ? "Secure assignment access via your SMS notification link."
            : `Welcome, ${user?.full_name || "Driver"}. Review and respond to your delivery assignments.`
        }
      />

      {feedback && (
        <Banner tone={feedback.tone === "success" ? "success" : "error"}>
          {feedback.message}
        </Banner>
      )}

      {tokenQuery.isLoading && (
        <p className="py-12 text-center text-sm text-slate-500">
          Loading your delivery assignment details…
        </p>
      )}

      {tokenQuery.isError && (
        <Banner tone="error">
          Invalid or expired assignment link. Please log into the portal or contact your fleet manager.
        </Banner>
      )}

      {!token && listQuery.isLoading && (
        <p className="py-12 text-center text-sm text-slate-500">
          Fetching assigned shipments…
        </p>
      )}

      {!assignments.length && !tokenQuery.isLoading && !listQuery.isLoading && (
        <Card className="p-12 text-center">
          <Truck size={36} className="mx-auto text-slate-300 mb-3" />
          <h3 className="text-base font-semibold text-slate-800">
            No Active Assignments
          </h3>
          <p className="mt-1 text-sm text-slate-500">
            You do not currently have any pending delivery assignments.
          </p>
        </Card>
      )}

      <div className="space-y-4">
        {assignments.map((dispatch) => {
          const isPending = dispatch.status === "pending";
          const isInTransit = dispatch.shipment_status === "in_transit";
          return (
            <Card key={dispatch.id} className="p-5 border-l-4 border-l-brand-600">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-slate-900">
                    {dispatch.shipment_ref}
                  </span>
                  <StatusBadge status={isInTransit ? dispatch.shipment_status : dispatch.status} />
                </div>
                <div className="text-xs text-slate-400">
                  Dispatched: {new Date(dispatch.dispatched_at).toLocaleString()}
                </div>
              </div>

              {isInTransit && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">
                  <div>
                    <span className="font-semibold">On the road</span>
                    <span className="mx-2 text-blue-500">·</span>
                    {dispatch.pickup_address} <span aria-hidden="true">→</span>{" "}
                    {dispatch.delivery_address}
                    {dispatch.shipment_started_at && (
                      <span className="mt-1 block text-xs text-blue-700">
                        Started {new Date(dispatch.shipment_started_at).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="secondary"
                    className="text-xs"
                    onClick={() => setRouteShipmentId(dispatch.shipment)}
                  >
                    <Navigation size={14} /> Track route
                  </Button>
                </div>
              )}

              {/* Addresses */}
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700">
                    <MapPin size={12} />
                  </div>
                  <div>
                    <span className="text-xs font-semibold uppercase text-slate-400">
                      Pickup Address
                    </span>
                    <p className="text-sm font-medium text-slate-900">
                      {dispatch.pickup_address}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-700">
                    <Navigation size={12} />
                  </div>
                  <div>
                    <span className="text-xs font-semibold uppercase text-slate-400">
                      Delivery Destination
                    </span>
                    <p className="text-sm font-medium text-slate-900">
                      {dispatch.delivery_address}
                    </p>
                  </div>
                </div>
              </div>

              {/* Assignment Details Grid */}
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3 rounded-lg text-xs">
                <div>
                  <span className="text-slate-500 block">Cargo</span>
                  <strong className="text-slate-800">
                    {dispatch.cargo_description}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Weight</span>
                  <strong className="text-slate-800">
                    {dispatch.weight_kg} kg
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Vehicle</span>
                  <strong className="text-slate-800">
                    {dispatch.vehicle_reg}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Deadline</span>
                  <strong className="text-red-700">
                    {new Date(dispatch.deadline).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </strong>
                </div>
              </div>

              {/* Actions for Pending assignments */}
              {isPending && (
                <div className="mt-5 flex items-center justify-end gap-3 border-t border-slate-100 pt-3">
                  <Button
                    variant="danger"
                    onClick={() => {
                      setRejectingDispatchId(dispatch.id);
                    }}
                  >
                    <XCircle size={15} /> Reject Shipment
                  </Button>
                  <Button
                    disabled={acceptMutation.isPending}
                    onClick={() =>
                      acceptMutation.mutate({
                        dispatchId: dispatch.id,
                        token: token ?? undefined,
                      })
                    }
                  >
                    <CheckCircle size={15} />
                    {acceptMutation.isPending
                      ? "Accepting…"
                      : "Accept Shipment"}
                  </Button>
                </div>
              )}

              {dispatch.status === "accepted" && (
                <div className="mt-3 flex items-center gap-1.5 text-xs text-green-700 font-medium bg-green-50/70 p-2 rounded">
                  <CheckCircle size={14} /> You accepted this assignment on{" "}
                  {dispatch.responded_at
                    ? new Date(dispatch.responded_at).toLocaleString()
                    : "—"}
                  . Awaiting manager trip start.
                </div>
              )}

              {dispatch.status === "rejected" && (
                <div className="mt-3 text-xs text-red-700 bg-red-50/70 p-2 rounded">
                  <strong>Assignment Rejected:</strong> {dispatch.rejection_reason}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Reject Reason Modal */}
      <Modal
        open={Boolean(rejectingDispatchId)}
        title="Reject Delivery Assignment"
        onClose={() => setRejectingDispatchId(null)}
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Please select the reason you are rejecting this delivery assignment.
            Your fleet manager will be alerted immediately to reassign the shipment.
          </p>

          <div>
            <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">
              Reason for Rejection *
            </label>
            <select
              className="w-full rounded-md border border-slate-300 p-2 text-sm text-slate-900 focus:border-brand-700 focus:outline-none"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
            >
              <option value="schedule_conflict">
                Schedule conflict with existing assignment or personal commitment
              </option>
              <option value="unavailable">Currently unavailable or off-duty</option>
              <option value="vehicle_issue">
                Assigned vehicle mechanical or inspection issue
              </option>
              <option value="route_unreachable">
                Route or delivery address unreachable due to conditions
              </option>
              <option value="other">Other reason</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase text-slate-600 mb-1">
              Additional Details (Optional)
            </label>
            <textarea
              className="w-full rounded-md border border-slate-300 p-2 text-sm text-slate-900 focus:border-brand-700 focus:outline-none"
              rows={3}
              placeholder="Provide any additional explanation for the fleet manager…"
              value={rejectionNotes}
              onChange={(e) => setRejectionNotes(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <Button
              variant="secondary"
              onClick={() => setRejectingDispatchId(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={rejectMutation.isPending}
              onClick={() => {
                rejectMutation.mutate({
                  dispatchId: rejectingDispatchId ?? undefined,
                  token: token ?? undefined,
                  reason:
                    rejectionReason === "other" && rejectionNotes
                      ? rejectionNotes
                      : rejectionReason.replace(/_/g, " "),
                  notes: rejectionNotes,
                });
              }}
            >
              {rejectMutation.isPending
                ? "Submitting Rejection…"
                : "Confirm Rejection"}
            </Button>
          </div>
        </div>
      </Modal>
      <RouteDrawer
        open={routeShipmentId !== null}
        shipmentId={routeShipmentId}
        onClose={() => setRouteShipmentId(null)}
      />
    </div>
  );
}
