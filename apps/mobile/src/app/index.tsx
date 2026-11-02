import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { getClinicianToken } from "../auth/tokenStore";

/** Decides where to send the clinician on launch. Redirect rather than an
 *  imperative replace, which can fire before the navigator has mounted. */
export default function Index() {
  const [target, setTarget] = useState<"/home" | "/login" | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const token = await getClinicianToken();
      if (!cancelled) setTarget(token ? "/home" : "/login");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!target) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0e0a16", alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color="#b98cff" />
      </View>
    );
  }
  return <Redirect href={target} />;
}
