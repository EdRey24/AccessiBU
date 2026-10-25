import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import type { Hazard } from '@/constants/hazards';
import { CDS_LOCATION, MAPBOX_TOKEN } from '@/constants/hazards';
import { BU } from '@/constants/theme';

type CampusMapProps = {
  hazards: Hazard[];
  onSelectBuilding: () => void;
  onSelectHazard: (hazard: Hazard) => void;
};

const MAPBOX_VERSION = 'v3.9.0';
const CSS_ID = 'mapbox-gl-css';
const JS_ID = 'mapbox-gl-js';
/** Below this zoom the CDS chip hides (so it never mis-marks when zoomed out). */
const CHIP_MIN_ZOOM = 15;

function loadMapbox(): Promise<any> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('no window'));
      return;
    }
    const w = window as any;
    if (w.mapboxgl) {
      resolve(w.mapboxgl);
      return;
    }
    if (!document.getElementById(CSS_ID)) {
      const link = document.createElement('link');
      link.id = CSS_ID;
      link.rel = 'stylesheet';
      link.href = `https://api.mapbox.com/mapbox-gl-js/${MAPBOX_VERSION}/mapbox-gl.css`;
      document.head.appendChild(link);
    }
    const existing = document.getElementById(JS_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(w.mapboxgl));
      existing.addEventListener('error', reject);
      return;
    }
    const script = document.createElement('script');
    script.id = JS_ID;
    script.src = `https://api.mapbox.com/mapbox-gl-js/${MAPBOX_VERSION}/mapbox-gl.js`;
    script.async = true;
    script.onload = () => resolve(w.mapboxgl);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

/** Build the CDS chip DOM element (bubble + count). */
function makeChipEl(count: number, onPress: () => void): HTMLDivElement {
  const el = document.createElement('div');
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', `Data Sciences Center, ${count} hazards. Tap to browse floors.`);
  Object.assign(el.style, {
    background: '#fff',
    border: `2px solid ${BU.red}`,
    borderRadius: '14px',
    padding: '6px 14px',
    textAlign: 'center',
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
    fontFamily: 'system-ui, sans-serif',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  });
  const title = document.createElement('div');
  title.textContent = 'CDS';
  Object.assign(title.style, { color: BU.red, fontSize: '14px', fontWeight: '800' });
  const sub = document.createElement('div');
  sub.textContent = `${count} ${count === 1 ? 'hazard' : 'hazards'}`;
  Object.assign(sub.style, { color: '#1A1A1A', fontSize: '12px', fontWeight: '600' });
  el.appendChild(title);
  el.appendChild(sub);
  el.addEventListener('click', onPress);
  return el;
}

/**
 * Web 3D campus map. The CDS chip is a real Mapbox marker anchored at BOTTOM,
 * so the bubble floats on TOP of the building at the CDS coordinate. It's
 * toggled off below CHIP_MIN_ZOOM so it never mis-marks when zoomed out.
 */
export function CampusMap({ hazards, onSelectBuilding, onSelectHazard }: CampusMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const glRef = useRef<any>(null);
  const chipMarkerRef = useRef<any>(null);

  const inside = hazards.filter((h) => h.location === 'inside');
  const count = inside.length;
  // Latest count, readable from the one-time map 'load' handler. Without it the
  // chip is built with the count captured at mount (usually 0) and can miss
  // updates that arrive before the map finishes loading.
  const countRef = useRef(count);
  useEffect(() => {
    countRef.current = count;
  }, [count]);

  useEffect(() => {
    let cancelled = false;

    loadMapbox()
      .then((mapboxgl) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        glRef.current = mapboxgl;
        mapboxgl.accessToken = MAPBOX_TOKEN;

        const map = new mapboxgl.Map({
          container: containerRef.current,
          style: 'mapbox://styles/mapbox/standard',
          center: [CDS_LOCATION.longitude, CDS_LOCATION.latitude],
          zoom: 16.5,
          pitch: 55,
          bearing: 18,
          antialias: true,
        });
        mapRef.current = map;

        // Live user-location dot + control (like Google Maps). Keep the 3D
        // tilt — the control otherwise flattens to a top-down view when it
        // flies to the user, so we restore pitch/bearing after it locates.
        const geolocate = new mapboxgl.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: true,
          showUserHeading: true,
        });
        map.addControl(geolocate, 'top-right');
        geolocate.on('geolocate', () => {
          // Re-apply the 3D camera the next tick (after the control's easeTo).
          setTimeout(() => {
            map.easeTo({ pitch: 55, bearing: 18, duration: 600 });
          }, 50);
        });

        map.on('load', () => {
          // CDS chip marker — anchored bottom so the bubble sits above the point.
          const chipEl = makeChipEl(countRef.current, onSelectBuilding);
          chipMarkerRef.current = new mapboxgl.Marker({ element: chipEl, anchor: 'bottom' })
            .setLngLat([CDS_LOCATION.longitude, CDS_LOCATION.latitude])
            .addTo(map);

          const applyZoomVisibility = () => {
            const show = map.getZoom() >= CHIP_MIN_ZOOM;
            const elAny = chipMarkerRef.current?.getElement?.();
            if (elAny) elAny.style.display = show ? 'block' : 'none';
          };
          applyZoomVisibility();
          map.on('zoom', applyZoomVisibility);
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the chip count label current. Runs on every render (cheap DOM text
  // write) so it also catches a chip that was created after the last change.
  useEffect(() => {
    const el = chipMarkerRef.current?.getElement?.();
    const sub = el?.children?.[1] as HTMLElement | undefined;
    const label = `${count} ${count === 1 ? 'hazard' : 'hazards'}`;
    if (sub && sub.textContent !== label) sub.textContent = label;
  });

  // Individual hazards are not drawn on the 3D map — the CDS chip shows the
  // count, and hazards are viewed on the 2D floor plans.

  return (
    <View style={styles.container}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
