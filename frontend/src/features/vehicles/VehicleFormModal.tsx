import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "../../api/client";
import { Banner, Button, Field, Modal, inputClass } from "../../components/ui";
import type { Vehicle } from "../../types";
import { apiError, fieldErrors } from "../../utils/errors";

const schema = z.object({
  registration_number: z
    .string()
    .trim()
    .min(1, "Registration number is required")
    .max(20, "Max 20 characters"),
  vehicle_type: z.string().trim().min(1, "Vehicle type is required"),
  make: z.string().trim().min(1, "Make is required"),
  model: z.string().trim().min(1, "Model is required"),
  capacity_kg: z
    .string()
    .refine((value) => Number(value) > 0, "Enter a capacity greater than zero"),
  fuel_type: z.enum(["diesel", "petrol", "cng", "electric"]),
  status: z.enum(["available", "maintenance", "inactive"]),
  odometer_km: z.string().refine(
    (value) =>
      value === "" || (Number.isInteger(Number(value)) && Number(value) >= 0),
    "Enter a whole number, 0 or more",
  ),
  insurance_expiry: z.string(),
  permit_expiry: z.string(),
});

type FormValues = z.infer<typeof schema>;
const LOCKED = ["assigned", "in_transit"];

function VehicleForm({
  vehicle,
  onSaved,
}: {
  vehicle: Vehicle | null;
  onSaved: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState("");
  const locked = vehicle ? LOCKED.includes(vehicle.status) : false;
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      registration_number: vehicle?.registration_number ?? "",
      vehicle_type: vehicle?.vehicle_type ?? "",
      make: vehicle?.make ?? "",
      model: vehicle?.model ?? "",
      capacity_kg: vehicle?.capacity_kg ?? "",
      fuel_type: (vehicle?.fuel_type as FormValues["fuel_type"]) ?? "diesel",
      status:
        vehicle && !locked
          ? (vehicle.status as FormValues["status"])
          : "available",
      odometer_km: vehicle ? String(vehicle.odometer_km) : "0",
      insurance_expiry: vehicle?.insurance_expiry ?? "",
      permit_expiry: vehicle?.permit_expiry ?? "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const { status, ...rest } = values;
      const payload = {
        ...rest,
        ...(locked ? {} : { status }),
        odometer_km: Number(values.odometer_km || 0),
        insurance_expiry: values.insurance_expiry || null,
        permit_expiry: values.permit_expiry || null,
      };
      return vehicle
        ? api.patch(`/vehicles/${vehicle.id}/`, payload)
        : api.post("/vehicles/", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      onSaved(vehicle ? "Vehicle updated." : "Vehicle added.");
    },
    onError: (err) => {
      setServerError(apiError(err));
      for (const [key, message] of Object.entries(fieldErrors(err))) {
        setError(key as keyof FormValues, { message });
      }
    },
  });

  return (
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      noValidate
      className="space-y-3"
    >
      {serverError && <Banner tone="error">{serverError}</Banner>}
      <Field
        label="Registration number"
        error={errors.registration_number?.message}
      >
        <input className={inputClass} {...register("registration_number")} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Vehicle type" error={errors.vehicle_type?.message}>
          <input
            className={inputClass}
            placeholder="Truck, Van…"
            {...register("vehicle_type")}
          />
        </Field>
        <Field label="Fuel type" error={errors.fuel_type?.message}>
          <select className={inputClass} {...register("fuel_type")}>
            <option value="diesel">Diesel</option>
            <option value="petrol">Petrol</option>
            <option value="cng">CNG</option>
            <option value="electric">Electric</option>
          </select>
        </Field>
        <Field label="Make" error={errors.make?.message}>
          <input className={inputClass} {...register("make")} />
        </Field>
        <Field label="Model" error={errors.model?.message}>
          <input className={inputClass} {...register("model")} />
        </Field>
        <Field label="Capacity (kg)" error={errors.capacity_kg?.message}>
          <input
            className={inputClass}
            inputMode="decimal"
            {...register("capacity_kg")}
          />
        </Field>
        <Field label="Odometer (km)" error={errors.odometer_km?.message}>
          <input
            className={inputClass}
            inputMode="numeric"
            {...register("odometer_km")}
          />
        </Field>
        <Field
          label="Insurance expiry"
          error={errors.insurance_expiry?.message}
        >
          <input
            type="date"
            className={inputClass}
            {...register("insurance_expiry")}
          />
        </Field>
        <Field label="Permit expiry" error={errors.permit_expiry?.message}>
          <input
            type="date"
            className={inputClass}
            {...register("permit_expiry")}
          />
        </Field>
      </div>
      <Field label="Availability" error={errors.status?.message}>
        <select
          className={inputClass}
          disabled={locked}
          {...register("status")}
        >
          <option value="available">Available</option>
          <option value="maintenance">Maintenance</option>
          <option value="inactive">Inactive</option>
        </select>
      </Field>
      {locked && (
        <p className="text-xs text-slate-500">
          This vehicle is on an active trip. Its status changes automatically
          when the trip ends.
        </p>
      )}
      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending
            ? "Saving…"
            : vehicle
              ? "Save changes"
              : "Add vehicle"}
        </Button>
      </div>
    </form>
  );
}

export default function VehicleFormModal({
  open,
  vehicle,
  onClose,
  onSaved,
}: {
  open: boolean;
  vehicle: Vehicle | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  return (
    <Modal
      open={open}
      title={vehicle ? `Edit ${vehicle.registration_number}` : "Add vehicle"}
      onClose={onClose}
    >
      <VehicleForm vehicle={vehicle} onSaved={onSaved} />
    </Modal>
  );
}
