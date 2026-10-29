import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "../../api/client";
import { Banner, Button, Field, Modal, inputClass } from "../../components/ui";
import type { Driver } from "../../types";
import { apiError, fieldErrors } from "../../utils/errors";

const schema = z.object({
  full_name: z.string().trim().min(1, "Name is required"),
  phone: z.string().trim().min(5, "Enter a valid phone number"),
  license_number: z.string().trim().min(1, "License number is required"),
  license_expiry: z.string().min(1, "License expiry date is required"),
  status: z.enum(["available", "off_duty", "inactive"]),
});

type FormValues = z.infer<typeof schema>;
const LOCKED = ["assigned", "on_trip"];

function DriverForm({
  driver,
  onSaved,
}: {
  driver: Driver | null;
  onSaved: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState("");
  const locked = driver ? LOCKED.includes(driver.status) : false;
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      full_name: driver?.full_name ?? "",
      phone: driver?.phone ?? "",
      license_number: driver?.license_number ?? "",
      license_expiry: driver?.license_expiry ?? "",
      status:
        driver && !locked
          ? (driver.status as FormValues["status"])
          : "available",
    },
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const { status, ...rest } = values;
      const payload = locked ? rest : { ...rest, status };
      return driver
        ? api.patch(`/drivers/${driver.id}/`, payload)
        : api.post("/drivers/", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      onSaved(driver ? "Driver updated." : "Driver added.");
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
      <Field label="Full name" error={errors.full_name?.message}>
        <input className={inputClass} {...register("full_name")} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone" error={errors.phone?.message}>
          <input
            className={inputClass}
            inputMode="tel"
            {...register("phone")}
          />
        </Field>
        <Field label="License number" error={errors.license_number?.message}>
          <input className={inputClass} {...register("license_number")} />
        </Field>
        <Field
          label="License expiry"
          error={errors.license_expiry?.message}
        >
          <input
            type="date"
            className={inputClass}
            {...register("license_expiry")}
          />
        </Field>
        <Field label="Availability" error={errors.status?.message}>
          <select
            className={inputClass}
            disabled={locked}
            {...register("status")}
          >
            <option value="available">Available</option>
            <option value="off_duty">Off duty</option>
            <option value="inactive">Inactive</option>
          </select>
        </Field>
      </div>
      {locked && (
        <p className="text-xs text-slate-500">
          This driver is on an active trip. Availability changes automatically
          when the trip ends.
        </p>
      )}
      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending
            ? "Saving…"
            : driver
              ? "Save changes"
              : "Add driver"}
        </Button>
      </div>
    </form>
  );
}

export default function DriverFormModal({
  open,
  driver,
  onClose,
  onSaved,
}: {
  open: boolean;
  driver: Driver | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  return (
    <Modal
      open={open}
      title={driver ? `Edit ${driver.full_name}` : "Add driver"}
      onClose={onClose}
    >
      <DriverForm driver={driver} onSaved={onSaved} />
    </Modal>
  );
}
