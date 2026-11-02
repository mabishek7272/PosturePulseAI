import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text } from "react-native";
import { countMetricResults } from "../api/events";
import { UnauthorizedError } from "../api/http";
import { getClinicianToken } from "../auth/tokenStore";
import { AnalysisStages, STAGES } from "../components/AnalysisStages";
import { Screen } from "../components/Screen";

const POLL_MS = 2000;
const GIVE_UP_MS = 120000;

export default function AnalysisScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const [stage, setStage] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();

    // Stages 0-2 are local progress indication while the server works; stage
    // advances past 2 only when real metric results start arriving.
    const ticker = setInterval(() => {
      setStage((current) => (current < 2 ? current + 1 : current));
    }, 1800);

    function giveUp(message: string) {
      clearInterval(ticker);
      setError(message);
    }

    async function poll() {
      try {
        const token = await getClinicianToken();
        if (cancelled) return;
        if (!token) {
          clearInterval(ticker);
          return router.replace("/login");
        }
        const count = await countMetricResults(sessionId, token);
        if (cancelled) return;
        if (count > 0) {
          setStage(STAGES.length);
          clearInterval(ticker);
          return router.replace({ pathname: "/results", params: { sessionId } });
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) {
          clearInterval(ticker);
          return router.replace("/login");
        }
        // Any other failure (e.g. a dropped connection) is treated as transient:
        // keep polling until the give-up deadline rather than stopping for good.
      }
      if (Date.now() - startedAt > GIVE_UP_MS) {
        return giveUp("Analysis is taking longer than expected. The clips were uploaded — check the dashboard.");
      }
      pollTimer = setTimeout(poll, POLL_MS);
    }
    poll();

    return () => {
      cancelled = true;
      clearTimeout(pollTimer);
      clearInterval(ticker);
    };
  }, [sessionId]);

  return (
    <Screen center>
      <Text style={styles.eyebrow}>ANALYSING</Text>
      <AnalysisStages activeStage={stage} />
      {error && <Text style={styles.error}>{error}</Text>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  eyebrow: { color: "#9d93ae", fontSize: 11, fontWeight: "800", letterSpacing: 2 },
  error: { color: "#ff6b6b", marginTop: 24, lineHeight: 20 },
});
