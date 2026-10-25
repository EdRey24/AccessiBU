import { Image } from 'expo-image';
import { useMemo, useRef, useState } from 'react';
import {
  GestureResponderEvent,
  LayoutRectangle,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { Hazard } from '@/constants/hazards';
import { floorFeatures, floorPlanSize } from '@/constants/hazards';
import { markerDims } from '@/constants/plan-marker';
import { BU, severityColor, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Pos = { x: number; y: number };

export type FloorPlanProps = {
  planImage?: number;
  floor?: number;
  pins?: Hazard[];
  draftPin?: Pos | null;
  onPlace?: (pos: Pos) => void;
  onPinPress?: (hazard: Hazard) => void;
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

/** Width divided by height of the plan drawn for a floor. */
export function planAspect(floor: number): number {
  const size = floorPlanSize(floor);
  return size.width / size.height;
}

/**
 * Native floor plan. A PanResponder handles both tap-to-place and drag, using
 * locationX/locationY against the measured layout so the pin lands exactly
 * under the finger and can be dragged to the precise spot. When `tapToPlace`
 * is set only a tap places the pin, so a drag is free to scroll a zoomed plan.
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
  const [layout, setLayout] = useState<LayoutRectangle | null>(null);
  const layoutRef = useRef<LayoutRectangle | null>(null);
  const placeable = !!onPlace;

  const w = layout?.width ?? 0;
  const h = layout?.height ?? 0;
  const dims = markerDims(w, zoom);

  const place = (e: GestureResponderEvent) => {
    const l = layoutRef.current;
    if (!onPlace || !l) return;
    const x = Math.min(1, Math.max(0, e.nativeEvent.locationX / l.width));
    const y = Math.min(1, Math.max(0, e.nativeEvent.locationY / l.height));
    onPlace({ x, y });
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => placeable,
        onMoveShouldSetPanResponder: () => placeable,
        onPanResponderGrant: place,
        onPanResponderMove: place,
      }),
    // place closes over onPlace; layoutRef keeps it current without re-creating
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [placeable, onPlace]
  );

  const px = (pos: Pos) => ({
    left: pos.x * w - dims.pin / 2,
    top: pos.y * h - dims.pin / 2,
  });
  const pinBox = { width: dims.pin, height: dims.pin };
  const pinDot = {
    width: dims.pin,
    height: dims.pin,
    borderRadius: dims.pin / 2,
    borderWidth: dims.border,
  };
  const pinInner = { width: dims.inner, height: dims.inner, borderRadius: dims.inner / 2 };

  const onLayout = (e: { nativeEvent: { layout: LayoutRectangle } }) => {
    layoutRef.current = e.nativeEvent.layout;
    setLayout(e.nativeEvent.layout);
  };
  const planStyle = [
    styles.plan,
    { aspectRatio: planAspect(floor), borderColor: theme.border },
  ];

  const body = (
    <>
      {planImage ? (
        <Image
          source={planImage}
          style={StyleSheet.absoluteFill}
          contentFit="fill"
          allowDownscaling={false}
          cachePolicy="memory-disk"
          pointerEvents="none"
        />
      ) : (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.backgroundElement }]}
        />
      )}

      {layout && (
        <>
          {/* Feature markers (stairs/elevators) for severity context */}
          {showFeatures &&
            floorFeatures(floor).map((f, i) => (
              <View
                key={`${f.kind}-${i}`}
                pointerEvents="none"
                style={[styles.feature, { left: f.x * w - 9, top: f.y * h - 9 }]}>
                <Text style={styles.featureIcon}>{f.kind === 'elevator' ? '🛗' : '🪜'}</Text>
              </View>
            ))}

          {/* Existing hazard pins */}
          {pins
            .filter((hz) => hz.position)
            .map((hz) => (
              <Pressable
                key={hz.id}
                accessibilityRole="button"
                accessibilityLabel={`${hz.type}, severity ${hz.severity}`}
                hitSlop={8}
                onPress={() => onPinPress?.(hz)}
                style={[styles.pin, pinBox, px(hz.position!), hz.id === selectedId && styles.pinSelected]}>
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
              </Pressable>
            ))}

          {/* Draft pin */}
          {draftPin && (
            <View pointerEvents="none" style={[styles.pin, pinBox, px(draftPin)]}>
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
        </>
      )}

      {caption && (
        <View style={styles.captionChip} pointerEvents="none">
          <View style={styles.captionBg}>
            <Text style={styles.captionText}>{caption}</Text>
          </View>
        </View>
      )}
    </>
  );

  if (placeable && tapToPlace) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Floor plan. Tap a spot to place the pin."
        onPress={place}
        onLayout={onLayout}
        style={planStyle}>
        {body}
      </Pressable>
    );
  }

  return (
    <View {...(placeable ? responder.panHandlers : {})} onLayout={onLayout} style={planStyle}>
      {body}
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
    elevation: 5,
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
