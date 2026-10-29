import {
  useCallback,
  useEffect,
  useState,
} from "react";
import type { ReactNode } from "react";
import { api, TOKEN_KEY } from "../api/client";
import { AuthContext } from "./context";
import type { User } from "../types";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(
    Boolean(localStorage.getItem(TOKEN_KEY)),
  );

  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) return;
    api
      .get<User>("/auth/me/")
      .then((response) => setUser(response.data))
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const { data } = await api.post<{ token: string; user: User }>(
      "/auth/login/",
      { username, password },
    );
    localStorage.setItem(TOKEN_KEY, data.token);
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout/");
    } catch {
      // Clear the local session even if the server cannot be reached.
    }
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
