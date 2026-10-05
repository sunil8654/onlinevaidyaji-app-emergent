import { useCallback, useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useFocusEffect } from "expo-router";

/**
 * Re-runs `load` when the screen mounts, regains focus, or the app returns to
 * the foreground.
 *
 * Those are exactly the three moments a doctor's view goes stale: a patient
 * books while the doctor is on another tab, the doctor switches tabs, or the
 * doctor comes back from a consultation. Previously each screen loaded once on
 * mount, so the dashboard kept showing yesterday's counts.
 *
 * Overlapping triggers collapse into the request already in flight (one extra
 * trigger is queued and re-run afterwards), so a fast tab switch - or a focus
 * event arriving together with a foreground event - cannot stack duplicate
 * loads of the same screen.
 */
export function useFocusRefresh(load: () => Promise<unknown>, enabled = true) {
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  const inFlight = useRef(false);
  const queued = useRef(false);
  // The queued re-run goes through a ref rather than calling `run` directly:
  // self-reference inside the callback defeats memoization preservation.
  const drainRef = useRef<() => void>(() => {});

  const run = useCallback(async () => {
    if (!enabled) return;
    if (inFlight.current) {
      queued.current = true;
      return;
    }
    inFlight.current = true;
    try {
      await loadRef.current();
    } finally {
      inFlight.current = false;
      if (queued.current) {
        queued.current = false;
        drainRef.current();
      }
    }
  }, [enabled]);

  useEffect(() => {
    drainRef.current = () => {
      void run();
    };
  }, [run]);

  useFocusEffect(
    useCallback(() => {
      void run();
    }, [run])
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s: AppStateStatus) => {
      if (s === "active") void run();
    });
    return () => sub.remove();
  }, [run]);

  return run;
}
