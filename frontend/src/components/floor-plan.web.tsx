import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { Hazard } from '@/constants/hazards';
import { floorFeatures, floorPlanSize } from '@/constants/hazards';
import { BU, severityColor, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { FLOOR2_ASPECT } from '@/services/floor-geo';

import { Floor2RoomsSvg } from './floor2-rooms-svg.web';

type Pos = { x: number; y: number };

type FloorPlanProps = {
  planImage?: number;
  floor?: number;
  pins?: Hazard[];
  draftPin?: Pos | null;
  onPlace?: (pos: Pos) => void;
  onPinPress?: (hazard: Hazard) => void;
  /** Show staircase/elevator feature markers used for severity context. */
  showFeatures?: boolean;
  /** "You are here" dot from GPS, normalized (0-1). Null = unknown. */
  userDot?: Pos | null;
  caption?: string;
};

const PIN = 26;

/**
 * Web floor plan. Uses raw DOM pointer events + getBoundingClientRect so taps
 * and drags map to EXACT normalized coordinates (react-native-web's locationX
 * is unreliable here and was pinning everything to 0,0). The draft pin is
 * draggable so the reporter can nudge it to the precise spot.
 */
export function FloorPlan({
  planImage,
  floor = 0,
  pins = [],
  draftPin = null,
  onPlace,
  onPinPress,
  showFeatures,
  userDot = null,
  caption,
}: FloorPlanProps) {
  const theme = useTheme();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const draggingRef = useRef(false);
  const placeable = !!onPlace;

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
    draggingRef.current = true;
    const pos = toNormalized(e.clientX, e.clientY);
    if (pos) onPlace?.(pos);
  };
  const handlePointerMove = (e: any) => {
    if (!placeable || !draggingRef.current) return;
    const pos = toNormalized(e.clientX, e.clientY);
    if (pos) onPlace?.(pos);
  };
  const endDrag = () => {
    draggingRef.current = false;
  };

  const px = (pos: Pos) => ({ left: pos.x * size.w - PIN / 2, top: pos.y * size.h - PIN / 2 });

  return (
    <View
      style={[
        styles.plan,
        {
          aspectRatio:
            floor === 2 ? FLOOR2_ASPECT : floorPlanSize(floor).width / floorPlanSize(floor).height,
          borderColor: theme.border,
        },
      ]}>

      <div
        ref={wrapRef}
        onPointerDown={placeable ? handlePointerDown : undefined}
        onPointerMove={placeable ? handlePointerMove : undefined}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        style={{
          position: 'absolute',
          inset: 0,
          cursor: placeable ? 'crosshair' : 'default',
          touchAction: 'none',
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
                style={[styles.pin, px(hz.position!), { cursor: 'pointer' } as any]}>
                <View style={[styles.pinDot, { backgroundColor: severityColor(hz.severity) }]}>
                  <View style={styles.pinInner} />
                </View>
              </View>
            ))}

        {/* Live "you are here" dot (GPS, approximate) */}
        {size.w > 0 && userDot && (
          <View
            style={[styles.userWrap, { left: userDot.x * size.w - 8, top: userDot.y * size.h - 8 }]}
            pointerEvents="none">
            <View style={styles.userHalo} />
            <View style={styles.userDot} />
          </View>
        )}

        {/* Draft pin (draggable) */}
        {size.w > 0 && draftPin && (
          <View style={[styles.pin, px(draftPin)]} pointerEvents="none">
            <View style={styles.draftHalo} />
            <View style={[styles.pinDot, { backgroundColor: BU.red }]}>
              <View style={styles.pinInner} />
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
    width: PIN,
    height: PIN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinDot: {
    width: PIN,
    height: PIN,
    borderRadius: PIN / 2,
    borderWidth: 3,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  pinInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  draftHalo: {
    position: 'absolute',
    width: PIN * 2,
    height: PIN * 2,
    borderRadius: PIN,
    backgroundColor: BU.red,
    opacity: 0.18,
  },
  userWrap: { position: 'absolute', width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  userHalo: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#2F7CF6',
    opacity: 0.22,
  },
  userDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#2F7CF6',
    borderWidth: 2,
    borderColor: '#fff',
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
