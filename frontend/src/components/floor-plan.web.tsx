import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { Hazard } from '@/constants/hazards';
import { floorFeatures, floorPlanSize } from '@/constants/hazards';
import { markerDims } from '@/constants/plan-marker';
import { BU, severityColor, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { FLOOR2_ASPECT } from '@/services/floor-geo';

import { Floor2RoomsSvg } from './floor2-rooms-svg.web';

type Pos = { x: number; y: number };

export type FloorPlanProps = {
  planImage?: number;
  floor?: number;
  pins?: Hazard[];
  draftPin?: Pos | null;
  onPlace?: (pos: Pos) => void;
  onPinPress?: (hazard: Hazard) => void;
  /** Show staircase/elevator feature markers used for severity context. */
  showFeatures?: boolean;
  caption?: string;
  /** Pin to ring so it stands out from the others. */
  selectedId?: string | null;
  /**
   * How far the plan is zoomed (1 = fitted). Pins get smaller as it grows so
   * the exact spot stays visible.
   */
  zoom?: number;
  /**
   * Place the pin with a tap instead of a drag. Used while zoomed, when a drag
   * has to scroll the plan instead.
   */
  tapToPlace?: boolean;
};

/** A press that moves farther than this many pixels is a scroll, not a tap. */
const TAP_SLOP = 8;

/** Width divided by height of the plan drawn for a floor. */
export function planAspect(floor: number): number {
  if (floor === 2) return FLOOR2_ASPECT;
  const size = floorPlanSize(floor);
  return size.width / size.height;
}

/**
 * Web floor plan. Uses raw DOM pointer events + getBoundingClientRect so taps
 * and drags map to EXACT normalized coordinates (react-native-web's locationX
 * is unreliable here and was pinning everything to 0,0). The draft pin is
 * draggable so the reporter can nudge it to the precise spot. When
 * `tapToPlace` is set only a tap places it, so a drag can scroll a zoomed plan.
 */
export function FloorPlan({
  planImage,
  floor = 0,
  pins = [],
  draftPin = null,
  onPlace,
  onPinPress,
  showFeatures,
  caption,
  selectedId = null,
  zoom = 1,
  tapToPlace = false,
}: FloorPlanProps) {
  const theme = useTheme();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const draggingRef = useRef(false);
  const tapStartRef = useRef<Pos | null>(null);
  const placeable = !!onPlace;
  const dims = markerDims(size.w, zoom);

  // Keep `size` exactly in sync with the rendered box via ResizeObserver, so
  // the size used to POSITION pins always matches the box taps are measured
  // against (a stale/too-short height was placing pins lower than tapped).
  const measure = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSize({ w: r.width, h: r.height });
  }, []);

  useEffect(() => {
    measure();
    const el = wrapRef.current;
    if (el && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => measure());
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  const toNormalized = (clientX: number, clientY: number): Pos | null => {
    const el = wrapRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    return { x, y };
  };

  const handlePointerDown = (e: any) => {
    if (!placeable) return;
    // Only the main button places. The middle button pans a zoomed plan.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (tapToPlace) {
      tapStartRef.current = { x: e.clientX, y: e.clientY };
      return;
    }
    draggingRef.current = true;
    const pos = toNormalized(e.clientX, e.clientY);
    if (pos) onPlace?.(pos);
  };
  const handlePointerMove = (e: any) => {
    if (!placeable || !draggingRef.current) return;
    const pos = toNormalized(e.clientX, e.clientY);
    if (pos) onPlace?.(pos);
  };
  const handlePointerUp = (e: any) => {
    draggingRef.current = false;
    const start = tapStartRef.current;
    tapStartRef.current = null;
    if (!tapToPlace || !start) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP) return;
    const pos = toNormalized(e.clientX, e.clientY);
    if (pos) onPlace?.(pos);
  };
  // The browser cancels the press when it takes the gesture to scroll.
  const cancelPress = () => {
    draggingRef.current = false;
    tapStartRef.current = null;
  };

  const px = (pos: Pos) => ({
    left: pos.x * size.w - dims.pin / 2,
    top: pos.y * size.h - dims.pin / 2,
  });
  const pinBox = { width: dims.pin, height: dims.pin };
  const pinDot = {
    width: dims.pin,
    height: dims.pin,
    borderRadius: dims.pin / 2,
    borderWidth: dims.border,
  };
  const pinInner = { width: dims.inner, height: dims.inner, borderRadius: dims.inner / 2 };

  return (
    <View
      style={[
        styles.plan,
        {
          aspectRatio: planAspect(floor),
          borderColor: theme.border,
        },
      ]}>

      <div
        ref={wrapRef}
        onPointerDown={placeable ? handlePointerDown : undefined}
        onPointerMove={placeable ? handlePointerMove : undefined}
        onPointerUp={handlePointerUp}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        style={{
          position: 'absolute',
          inset: 0,
          cursor: placeable ? 'crosshair' : 'default',
          // While zoomed the plan scrolls inside its frame, so let touch pan it.
          touchAction: tapToPlace ? 'pan-x pan-y' : 'none',
        }}>
        {floor === 2 ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <Floor2RoomsSvg />
          </View>
        ) : planImage ? (
          <Image source={planImage} style={StyleSheet.absoluteFill} contentFit="fill" />
        ) : (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.backgroundElement }]} />
        )}

        {/* Feature markers (stairs/elevators) for severity context */}
        {showFeatures &&
          size.w > 0 &&
          floorFeatures(floor).map((f, i) => (
            <View
              key={`${f.kind}-${i}`}
              style={[styles.feature, { left: f.x * size.w - 9, top: f.y * size.h - 9 }]}
              pointerEvents="none">
              <Text style={styles.featureIcon}>{f.kind === 'elevator' ? '🛗' : '🪜'}</Text>
            </View>
          ))}

        {/* Existing hazard pins */}
        {size.w > 0 &&
          pins
            .filter((h) => h.position)
            .map((hz) => (
              <View
                key={hz.id}
                onClick={() => onPinPress?.(hz)}
                style={[
                  styles.pin,
                  pinBox,
                  px(hz.position!),
                  hz.id === selectedId && styles.pinSelected,
                  { cursor: 'pointer' } as any,
                ]}>
                {hz.id === selectedId && (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.selectedRing,
                      { width: dims.ring, height: dims.ring, borderRadius: dims.ring / 2 },
                    ]}
                  />
                )}
                <View style={[styles.pinDot, pinDot, { backgroundColor: severityColor(hz.severity) }]}>
                  <View style={[styles.pinInner, pinInner]} />
                </View>
              </View>
            ))}

        {/* Draft pin (draggable) */}
        {size.w > 0 && draftPin && (
          <View style={[styles.pin, pinBox, px(draftPin)]} pointerEvents="none">
            <View
              style={[
                styles.draftHalo,
                { width: dims.halo, height: dims.halo, borderRadius: dims.halo / 2 },
              ]}
            />
            <View style={[styles.pinDot, pinDot, { backgroundColor: BU.red }]}>
              <View style={[styles.pinInner, pinInner]} />
            </View>
          </View>
        )}

        {caption && (
          <View style={styles.captionChip} pointerEvents="none">
            <View style={styles.captionBg}>
              <Text style={styles.captionText}>{caption}</Text>
            </View>
          </View>
        )}
      </div>
    </View>
  );
}

const styles = StyleSheet.create({
  plan: {
    width: '100%',
    borderWidth: 1,
    borderRadius: Spacing.three,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  pin: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinDot: {
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  pinInner: { backgroundColor: '#fff' },
  pinSelected: { zIndex: 10 },
  selectedRing: {
    position: 'absolute',
    borderWidth: 3,
    borderColor: '#111',
  },
  draftHalo: {
    position: 'absolute',
    backgroundColor: BU.red,
    opacity: 0.18,
  },
  feature: { position: 'absolute', width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  featureIcon: { fontSize: 16 },
  captionChip: { position: 'absolute', bottom: Spacing.two, left: Spacing.two },
  captionBg: {
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  captionText: { color: '#fff', fontSize: 12, fontWeight: '600' },
});
