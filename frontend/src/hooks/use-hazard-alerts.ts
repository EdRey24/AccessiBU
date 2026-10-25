/**
 * Watches the shared hazard list for newly reported HIGH-SEVERITY hazards.
 *
 * This is deliberately additive: it reads the existing hazard store and calls
 * its public `refresh()`, so nothing about the store, the Hazard type, or the
 * backend changes. Drop it into a screen and it reports what is new.
 *
 * "New" is scoped to the current session. The first populated list seeds the
 * baseline (pre-existing hazards are treated as already seen), and anything
 * high-severity that arrives after that counts as new until acknowledged.
 * Signing out clears the list, which resets the baseline.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { Hazard } from '@/constants/hazards';
import { useHazards } from '@/hooks/use-hazards';

/**
 * Threshold for "high severity", matching the critical band already used by
 * `severityColor` (8 and above on the 1–10 scale).
 */
export const HIGH_SEVERITY_SCORE = 8;
export const HIGH_SEVERITY_PIN = 8;

/** How often to re-pull the shared list so new reports actually arrive. */
const POLL_MS = 20_000;

/** Whether a hazard is severe enough to raise an alert. */
export function isHighSeverity(hazard: Hazard): boolean {
  return typeof hazard.severityScore === 'number'
    ? hazard.severityScore >= HIGH_SEVERITY_SCORE
    : hazard.severity >= HIGH_SEVERITY_PIN;
}

export type HazardAlerts = {
  /** Every current high-severity hazard, newest first. */
  alerts: Hazard[];
  /** High-severity hazards that arrived this session and are unacknowledged. */
  unseen: Hazard[];
  /** Badge count for the bell. */
  unseenCount: number;
  /** Acknowledges everything currently listed, clearing the badge. */
  markAllSeen: () => void;
};

export function useHazardAlerts(): HazardAlerts {
  const { hazards, refresh } = useHazards();

  // High-severity hazards already present when this session started looking.
  // `null` means "not seeded yet", which is also the signed-out state.
  const [baseline, setBaseline] = useState<ReadonlySet<string> | null>(null);
  // Alerts the user has explicitly acknowledged by opening the list.
  const [acknowledged, setAcknowledged] = useState<ReadonlySet<string>>(() => new Set());

  const alerts = useMemo(
    () => hazards.filter(isHighSeverity).sort((a, b) => b.createdAt - a.createdAt),
    [hazards],
  );

  // Keep pulling the shared list; without this a new report would only appear
  // when the user manually refreshed, and the bell would never light up.
  useEffect(() => {
    const timer = setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // Seed the baseline off the first populated list, and drop it when the list
  // empties so one account never inherits another's "new" set. The state write
  // is pushed past the current render the same way the shared hazard store
  // defers its own, which keeps this off the cascading-render path.
  useEffect(() => {
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (!active) return;
      if (hazards.length === 0) {
        setBaseline((prev) => (prev === null ? prev : null));
      } else {
        setBaseline((prev) => (prev === null ? new Set(alerts.map((h) => h.id)) : prev));
      }
    })();
    return () => {
      active = false;
    };
  }, [hazards.length, alerts]);

  const unseen = useMemo(
    () =>
      baseline === null
        ? []
        : alerts.filter((h) => !baseline.has(h.id) && !acknowledged.has(h.id)),
    [alerts, baseline, acknowledged],
  );

  const markAllSeen = useCallback(() => {
    setAcknowledged(new Set(alerts.map((h) => h.id)));
  }, [alerts]);

  return { alerts, unseen, unseenCount: unseen.length, markAllSeen };
}
