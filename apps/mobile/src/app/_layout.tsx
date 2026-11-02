import { Stack, router } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState, View } from "react-native";
import { setUnauthorizedHandler } from "../api/http";
import { clearClinicianToken } from "../auth/tokenStore";
import { isIdle, recordActivity } from "../auth/idleLock";
import { colors } from "../theme/colors";

const CHECK_INTERVAL_MS = 30000;

export default function RootLayout() {
  const checkTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Any 401 from any screen drops the stored token and returns to login.
    // The idle-lock check below reuses this exact path, so there is one
    // lock-and-redirect code path, not two.
    const lock = () => {
      void clearClinicianToken();
      router.replace("/login");
    };
    setUnauthorizedHandler(lock);

    function checkIdle() {
      if (isIdle()) lock();
    }

    checkTimer.current = setInterval(checkIdle, CHECK_INTERVAL_MS);
    // Covers the realistic shared-device case: backgrounded, then reopened by
    // someone else nine minutes later. Wall-clock time elapsed is correct
    // even though the interval was not ticking while backgrounded.
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") checkIdle();
    });

    return () => {
      setUnauthorizedHandler(null);
      if (checkTimer.current) clearInterval(checkTimer.current);
      appStateSub.remove();
    };
  }, []);

  return (
    <View
      style={{ flex: 1 }}
      onStartShouldSetResponderCapture={() => {
        recordActivity();
        return false;
      }}
    >
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bgDeep } }} />
    </View>
  );
}
