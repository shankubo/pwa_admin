import { useEffect, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "@/stores/auth.store";
import { refreshAccessToken } from "@/lib/api";

export function RequireAuth({ children }: { children: ReactNode }) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (accessToken) {
      setChecked(true);
      return;
    }
    refreshAccessToken().finally(() => setChecked(true));
  }, [accessToken]);

  if (!checked) return null;
  if (!accessToken) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
