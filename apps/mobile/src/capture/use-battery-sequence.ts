import { useEffect, useState } from "react";
import { getAssessmentBattery } from "../api/sessions";
import { resolveSequence, type ResolvedSequence } from "./battery-steps";

/**
 * Fetches the battery once and resolves the capture sequence from it.
 *
 * Starts as `null` rather than as the fallback, so a capture screen can WAIT
 * instead of starting a recording at the wrong duration and discovering the real
 * protocol a moment later. That ordering is the whole point: the previous code
 * read 30 seconds from a global while the battery said 15/5/5/5, and nothing
 * anywhere reported the difference.
 *
 * On failure it resolves to the built-in sequence with `source: "fallback"` and
 * a reason, which the screen shows. A fallback indistinguishable from the real
 * protocol is how the original drift survived.
 */
export function useBatterySequence(mode: "clinic" | "patient" = "clinic"): ResolvedSequence | null {
  const [sequence, setSequence] = useState<ResolvedSequence | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAssessmentBattery()
      .then((battery) => {
        if (!cancelled) setSequence(resolveSequence(battery, { mode }));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setSequence({
          ...resolveSequence(null, { mode }),
          reason:
            error instanceof Error
              ? `The assessment battery could not be loaded (${error.message}).`
              : "The assessment battery could not be loaded.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  return sequence;
}
