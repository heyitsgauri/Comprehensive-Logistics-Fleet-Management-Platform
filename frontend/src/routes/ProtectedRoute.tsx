import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../auth/useAuth";

export default function ProtectedRoute() {
  const { user, loading } = useAuth();
  if (loading) {
    return <div className="p-8 text-sm text-slate-500">Loading…</div>;
  }
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}
