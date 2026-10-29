import axios from "axios";

export function apiError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    if (!err.response) return "Cannot reach the server. Is the backend running?";
    const data: unknown = err.response.data;
    if (typeof data === "string") return "Server error. Please try again.";
    if (data && typeof data === "object" && "detail" in data) {
      return String(data.detail);
    }
    if (data && typeof data === "object") {
      return Object.entries(data)
        .map(([key, value]) =>
          `${key}: ${Array.isArray(value) ? value.join(" ") : String(value)}`,
        )
        .join(" | ");
    }
  }
  return "Something went wrong.";
}

export function fieldErrors(err: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (
    axios.isAxiosError(err) &&
    err.response?.data &&
    typeof err.response.data === "object"
  ) {
    for (const [key, value] of Object.entries(err.response.data)) {
      out[key] = Array.isArray(value) ? value.join(" ") : String(value);
    }
  }
  return out;
}
