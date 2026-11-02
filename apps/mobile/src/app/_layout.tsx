import { Stack, router } from "expo-router";
import { useEffect } from "react";
import { setUnauthorizedHandler } from "../api/http";
import { clearClinicianToken } from "../auth/tokenStore";

export default function RootLayout() {
  useEffect(() => {
    // Any 401 from any screen drops the stored token and returns to login.
    setUnauthorizedHandler(() => {
      void clearClinicianToken();
      router.replace("/login");
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#0e0a16" } }} />;
}
