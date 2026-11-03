import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { easeValue } from "../../lib/reportSequence";

export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => live && setReduce(v)).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

/** Animates a number toward `target` (from its current value). Jumps straight there when `still`. */
export function useTween(target: number, ms: number, still: boolean, restartKey: unknown = 0): number {
  const [value, setValue] = useState(still ? target : 0);
  const cur = useRef(value);
  cur.current = value;
  useEffect(() => {
    if (still) {
      setValue(target);
      return;
    }
    const from = cur.current;
    const t0 = Date.now();
    let raf: ReturnType<typeof setInterval> | undefined = setInterval(() => {
      const p = (Date.now() - t0) / ms;
      setValue(easeValue(from, target, p));
      if (p >= 1 && raf) {
        clearInterval(raf);
        raf = undefined;
      }
    }, 33);
    return () => raf && clearInterval(raf);
  }, [target, ms, still, restartKey]);
  return value;
}
