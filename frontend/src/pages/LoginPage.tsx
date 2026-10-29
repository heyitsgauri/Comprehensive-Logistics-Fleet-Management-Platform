import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Truck } from "lucide-react";
import { useAuth } from "../auth/useAuth";
import { Banner, Button, Card, Field, inputClass } from "../components/ui";
import { apiError } from "../utils/errors";

const schema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState("");
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(values: FormValues) {
    setServerError("");
    try {
      await login(values.username, values.password);
      navigate("/", { replace: true });
    } catch (err) {
      setServerError(apiError(err));
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-900 p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-5 flex items-center gap-2 text-brand-900">
          <Truck size={24} />
          <span className="text-lg font-semibold">Logistics Platform</span>
        </div>
        {serverError && <Banner tone="error">{serverError}</Banner>}
        <form
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          className="space-y-4"
        >
          <Field label="Username" error={errors.username?.message}>
            <input
              className={inputClass}
              autoComplete="username"
              {...register("username")}
            />
          </Field>
          <Field label="Password" error={errors.password?.message}>
            <input
              type="password"
              className={inputClass}
              autoComplete="current-password"
              {...register("password")}
            />
          </Field>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <p className="mt-4 text-xs text-slate-500">
          Demo accounts: admin, manager, coordinator, driver1. Demo password:
          Demo@12345
        </p>
      </Card>
    </div>
  );
}
