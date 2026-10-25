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
 * `severityColor` (pin >= 8). The stored score is 0–100, the pin value 1–10.
 */
export const HIGH_SEVERITY_SCORE = 80;
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

  // Ids the user has already been shown. `null` means no baseline yet, which
  // happens before the first load and again after the list is cleared.
  const [seenIds, setSeenIds] = useState<Set<string> | null>(null);

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

  // Seed the baseline on the first populated list, and drop it on sign-out so
  // the next account does not inherit this one's "new" set.
  useEffect(() => {
    if (hazards.length === 0) {
      setSeenIds(null);
      return;
    }
    setSeenIds((prev) => prev ?? new Set(alerts.map((h) => h.id)));
  }, [hazards.length, alerts]);

  const unseen = useMemo(
    () => (seenIds === null ? [] : alerts.filter((h) => !seenIds.has(h.id))),
    [alerts, seenIds],
  );

  const markAllSeen = useCallback(() => {
    setSeenIds(new Set(alerts.map((h) => h.id)));
  }, [alerts]);

  return { alerts, unseen, unseenCount: unseen.length, markAllSeen };
}
