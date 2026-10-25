/**
 * Pin sizing for the floor plan.
 *
 * The marker follows the screen: a narrow phone gets a smaller pin than a
 * laptop. It also shrinks as the plan is zoomed in, so a close-up shows the
 * exact spot instead of a pin that covers it.
 */

/** Pin size used before the plan has been measured. */
const FALLBACK_PIN = 26;
const MIN_PIN = 12;
const MAX_PIN = 28;
/** Smallest pin at the fitted (unzoomed) size, so it stays tappable. */
const MIN_FIT_PIN = 16;
/** Share of the fitted plan width the pin takes up. */
const WIDTH_SHARE = 0.04;

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;

export type MarkerDims = {
  /** Diameter of the pin. */
  pin: number;
  /** White ring around the pin. */
  border: number;
  /** Diameter of the dot in the middle. */
  inner: number;
  /** Diameter of the soft halo behind the draft pin. */
  halo: number;
  /** Diameter of the ring that marks the selected pin. */
  ring: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Keeps a zoom level inside the supported range. */
export function clampZoom(zoom: number): number {
  return clamp(zoom, MIN_ZOOM, MAX_ZOOM);
}

/**
 * Pin diameter for a plan drawn `planWidth` pixels wide at `zoom` times its
 * fitted size.
 */
export function markerSize(planWidth: number, zoom: number = 1): number {
  if (!(planWidth > 0)) return FALLBACK_PIN;
  const level = clampZoom(zoom);
  const fitted = clamp((planWidth / level) * WIDTH_SHARE, MIN_FIT_PIN, MAX_PIN);
  return Math.round(clamp(fitted / Math.sqrt(level), MIN_PIN, MAX_PIN));
}

/** Every dimension of the marker, derived from one pin diameter. */
export function markerDims(planWidth: number, zoom: number = 1): MarkerDims {
  const pin = markerSize(planWidth, zoom);
  return {
    pin,
    border: Math.max(2, Math.round(pin * 0.115)),
    inner: Math.max(4, Math.round(pin * 0.23)),
    halo: pin * 2,
    ring: pin + Math.round(pin * 0.6),
  };
}
