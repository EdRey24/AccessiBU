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
import { BU, severityColor, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Pos = { x: number; y: number };

type FloorPlanProps = {
  planImage?: number;
  floor?: number;
  pins?: Hazard[];
  draftPin?: Pos | null;
  onPlace?: (pos: Pos) => void;
  onPinPress?: (hazard: Hazard) => void;
  showFeatures?: boolean;
  /** "You are here" dot from GPS, normalized (0-1). Null = unknown. */
  userDot?: Pos | null;
  caption?: string;
};

const PIN = 26;

/**
 * Native floor plan. A PanResponder handles both tap-to-place and drag, using
 * locationX/locationY against the measured layout so the pin lands exactly
 * under the finger and can be dragged to the precise spot.
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
  const [layout, setLayout] = useState<LayoutRectangle | null>(null);
  const layoutRef = useRef<LayoutRectangle | null>(null);
  const placeable = !!onPlace;

  const w = layout?.width ?? 0;
  const h = layout?.height ?? 0;

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

  const px = (pos: Pos) => ({ left: pos.x * w - PIN / 2, top: pos.y * h - PIN / 2 });

  return (
    <View
      {...(placeable ? responder.panHandlers : {})}
      onLayout={(e) => {
        layoutRef.current = e.nativeEvent.layout;
        setLayout(e.nativeEvent.layout);
      }}
      style={[
        styles.plan,
        { aspectRatio: floorPlanSize(floor).width / floorPlanSize(floor).height, borderColor: theme.border },
      ]}>
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
                onPress={() => onPinPress?.(hz)}
                style={[styles.pin, px(hz.position!)]}>
                <View style={[styles.pinDot, { backgroundColor: severityColor(hz.severity) }]}>
                  <View style={styles.pinInner} />
                </View>
              </Pressable>
            ))}

          {/* Live "you are here" dot (GPS, approximate) */}
          {userDot && (
            <View pointerEvents="none" style={[styles.userWrap, { left: userDot.x * w - 8, top: userDot.y * h - 8 }]}>
              <View style={styles.userHalo} />
              <View style={styles.userDot} />
            </View>
          )}

          {/* Draft pin */}
          {draftPin && (
            <View pointerEvents="none" style={[styles.pin, px(draftPin)]}>
              <View style={styles.draftHalo} />
              <View style={[styles.pinDot, { backgroundColor: BU.red }]}>
                <View style={styles.pinInner} />
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
    elevation: 5,
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
