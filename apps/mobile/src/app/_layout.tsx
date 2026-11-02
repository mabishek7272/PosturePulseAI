import { Stack, router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { setUnauthorizedHandler } from "../api/http";
import { clearClinicianToken, getClinicianToken } from "../auth/tokenStore";

export default function RootLayout() {
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // Any 401 from any screen drops the stored token and returns to login.
    setUnauthorizedHandler(() => {
      void clearClinicianToken();
      router.replace("/login");
    });

    (async () => {
      const token = await getClinicianToken();
      router.replace(token ? "/home" : "/login");
      setChecked(true);
    })();

    return () => setUnauthorizedHandler(null);
  }, []);

  if (!checked) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0e0a16", alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color="#b98cff" />
      </View>
    );
  }

  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#0e0a16" } }} />;
}
