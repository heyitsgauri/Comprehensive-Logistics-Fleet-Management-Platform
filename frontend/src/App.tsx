import { Route, Routes } from "react-router-dom";
import AppLayout from "./layouts/AppLayout";
import ProtectedRoute from "./routes/ProtectedRoute";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import VehiclesPage from "./pages/VehiclesPage";
import DriversPage from "./pages/DriversPage";
import DriverPortalPage from "./pages/DriverPortalPage";
import {
  AlertsPage,
  AnalyticsPage,
  CustomersPage,
  ExpensesPage,
  LiveFleetPage,
  MaintenancePage,
  ShipmentDetailPage,
  ShipmentsPage,
  TripsPage,
  WarehousesPage,
} from "./pages/OperationsPages";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/driver/assignment" element={<div className="min-h-screen bg-slate-100 p-4 md:p-8"><DriverPortalPage /></div>} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="driver" element={<DriverPortalPage />} />
          <Route path="fleet" element={<LiveFleetPage />} />
          <Route path="vehicles" element={<VehiclesPage />} />
          <Route path="drivers" element={<DriversPage />} />
          <Route path="customers" element={<CustomersPage />} />
          <Route path="warehouses" element={<WarehousesPage />} />
          <Route path="shipments" element={<ShipmentsPage />} />
          <Route path="shipments/:id" element={<ShipmentDetailPage />} />
          <Route path="trips" element={<TripsPage />} />
          <Route path="maintenance" element={<MaintenancePage />} />
          <Route path="expenses" element={<ExpensesPage />} />
          <Route path="alerts" element={<AlertsPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
