import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

import { gpsToPlanXY } from '@/constants/hazards';

export type UserLocation = {
  coords: { latitude: number; longitude: number; accuracy: number | null } | null;
  /** Projected onto the floor plan (normalized 0-1), or null if off-plan. */
  planXY: { x: number; y: number } | null;
  status: 'idle' | 'granted' | 'denied';
};

/**
 * Subscribes to the device location and projects it onto the CDS floor plan.
 * Used to render the live "you are here" blue dot on the 2D plan.
 */
export function useUserLocation(enabled: boolean = true): UserLocation {
  const [coords, setCoords] = useState<UserLocation['coords']>(null);
  const [status, setStatus] = useState<UserLocation['status']>('idle');

  useEffect(() => {
    if (!enabled) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;

    (async () => {
      const { status: perm } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (perm !== 'granted') {
        setStatus('denied');
        return;
      }
      setStatus('granted');
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 2, timeInterval: 3000 },
        (pos) => {
          setCoords({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? null,
          });
        }
      );
    })();

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [enabled]);

  return {
    coords,
    planXY: coords ? gpsToPlanXY(coords) : null,
    status,
  };
}
