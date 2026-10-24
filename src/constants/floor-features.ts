/**
 * Per-floor accessibility feature map for CDS.
 *
 * Each feature is a normalized (0-1) position on that floor's plan image,
 * marking a staircase, elevator, or exit. The app uses these to compute the
 * spatial context of a reported hazard (how close it is to critical egress),
 * which the backend severity classifier uses to raise or lower severity.
 *
 * HOW TO (RE)GENERATE THIS FILE:
 *   1. Run the app and open the dev tool at route `/dev/features`.
 *   2. Pick a floor, then tap each stair / elevator / exit on the plan.
 *   3. Press "Copy JSON" and paste the result into FLOOR_FEATURES below.
 *
 * Until digitized, floors fall back to the shared CDS core (the elevator/stair
 * bank sits roughly center on every floor), so the pipeline still works.
 */

export type FeatureKind = 'elevator' | 'stair' | 'exit';

export type FloorFeature = {
  kind: FeatureKind;
  label: string;
  /** Normalized position on the plan image (0-1). */
  x: number;
  y: number;
};

/**
 * Baseline for floors not yet digitized. Empty so no placeholder markers show
 * on the plan — real stair/elevator positions are captured per-floor with the
 * dev tool and go into FLOOR_FEATURES below.
 */
export const CDS_CORE_FEATURES: FloorFeature[] = [];

/**
 * Digitized features keyed by floor value. Fill these in with the dev tool.
 * Floors absent here use CDS_CORE_FEATURES as a fallback.
 */
export const FLOOR_FEATURES: Record<number, FloorFeature[]> = {
  // Example (replace with tool output):
  // 12: [
  //   { kind: 'elevator', label: 'Elevator bank', x: 0.46, y: 0.49 },
  //   { kind: 'stair', label: 'North stair', x: 0.33, y: 0.41 },
  // ],
};

export function floorFeatures(floor: number): FloorFeature[] {
  return FLOOR_FEATURES[floor] ?? CDS_CORE_FEATURES;
}

/** Whether a floor has been digitized (vs. using the core fallback). */
export function floorIsDigitized(floor: number): boolean {
  return !!FLOOR_FEATURES[floor];
}
