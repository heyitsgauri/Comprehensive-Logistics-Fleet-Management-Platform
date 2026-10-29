export type Role = "admin" | "fleet_manager" | "coordinator" | "driver";

export type User = {
  id: number;
  username: string;
  full_name: string;
  role: Role | null;
};

export type Paginated<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

export type Vehicle = {
  id: number;
  registration_number: string;
  vehicle_type: string;
  make: string;
  model: string;
  capacity_kg: string;
  fuel_type: string;
  status: string;
  odometer_km: number;
  insurance_expiry: string | null;
  permit_expiry: string | null;
  current_lat?: number | null;
  current_lng?: number | null;
};

export type Driver = {
  id: number;
  full_name: string;
  phone: string;
  license_number: string;
  license_expiry: string;
  status: string;
  license_valid: boolean;
};

export type DispatchRequest = {
  id: number;
  shipment: number;
  shipment_ref: string;
  customer_name: string;
  pickup_address: string;
  delivery_address: string;
  cargo_description: string;
  weight_kg: string;
  deadline: string;
  shipment_status: string;
  shipment_started_at: string | null;
  vehicle: number;
  vehicle_reg: string;
  vehicle_capacity: string;
  driver: number;
  driver_name: string;
  driver_phone: string;
  status: "pending" | "accepted" | "rejected" | "cancelled" | "superseded";
  token: string;
  dispatched_at: string;
  responded_at: string | null;
  rejection_reason?: string;
  rejection_notes?: string;
  sms_status: "pending" | "sent" | "delivered" | "failed";
  sms_provider: string;
  sms_provider_message_id?: string;
  sms_error?: string;
  sms_attempts: number;
};

export type Shipment = {
  id: number;
  reference: string;
  customer: number;
  customer_name: string;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  delivery_address: string;
  delivery_lat: number;
  delivery_lng: number;
  cargo_description: string;
  weight_kg: string;
  deadline: string;
  scheduled_departure: string | null;
  started_at: string | null;
  status:
    | "draft"
    | "pending"
    | "assigned"
    | "awaiting_acceptance"
    | "accepted"
    | "rejected"
    | "in_transit"
    | "delayed"
    | "delivered"
    | "cancelled";
  is_late: boolean;
  shipment_started_status: "Not Started" | "Started" | "Delivered";
  departure_punctuality: "On Time" | "Late" | "Started" | null;
  active_dispatch?: {
    id: number;
    status: string;
    vehicle_id: number;
    vehicle_reg: string;
    vehicle_registration?: string;
    driver_id: number;
    driver_name: string;
    driver_phone: string;
    sms_status: string;
    sms_provider: string;
    sms_error: string;
    token: string;
    dispatched_at: string;
    responded_at: string | null;
    rejection_reason?: string;
    rejection_notes?: string;
  } | null;
};

export type RouteDetails = {
  trip_id: number | null;
  shipment_id?: number;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  last_update: string;
  simulated: boolean;
  progress_ratio: number;
  progress_percent: number;
  total_distance_km: number;
  distance_covered_km: number;
  distance_remaining_km: number;
  planned_duration_min: number;
  estimated_arrival: string;
  shipment: {
    id: number;
    reference: string;
    customer_name: string;
    cargo_description: string;
    weight_kg: string;
    deadline: string;
    pickup_address: string;
    delivery_address: string;
    pickup_coords: [number, number];
    delivery_coords: [number, number];
  };
  vehicle: {
    id: number;
    registration_number: string;
    vehicle_type: string;
    make: string;
    model: string;
  };
  driver: {
    id: number;
    full_name: string;
    phone: string;
  };
  current_location: [number, number];
  full_route: [number, number][];
  covered_route: [number, number][];
  remaining_route: [number, number][];
};

export type LiveVehicle = {
  id: number;
  registration_number: string;
  status: string;
  lat: number | null;
  lng: number | null;
  simulated: boolean;
  gps_mode?: string;
  last_update: string;
  is_actively_travelling: boolean;
  trip_id: number | null;
  shipment_id?: number | null;
  shipment_ref: string | null;
  driver_name: string | null;
  driver_phone?: string | null;
  estimated_arrival: string | null;
  progress: number | null;
  progress_percent?: number | null;
  total_distance_km?: number | null;
  remaining_distance_km?: number | null;
  pickup_address?: string | null;
  delivery_address?: string | null;
  pickup: [number, number] | null;
  delivery: [number, number] | null;
  late: boolean;
  deadline: string | null;
};

export type Summary = {
  total_shipments: number;
  shipments_today: number;
  shipment_status_counts: Record<string, number>;
  vehicle_status_counts: Record<string, number>;
  total_vehicles: number;
  available_vehicles: number;
  active_trips: number;
  awaiting_acceptance: number;
  accepted_awaiting_start: number;
  rejected_assignments: number;
  delayed_deliveries: number;
  on_time_rate: number | null;
  avg_delivery_minutes: number | null;
};
