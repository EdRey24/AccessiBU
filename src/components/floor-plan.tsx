import { Image } from 'expo-image';
import { useState } from 'react';
import { LayoutRectangle, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Hazard } from '@/constants/hazards';
import { FLOOR_PLAN_SIZE } from '@/constants/hazards';
import { BU, severityColor, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Pos = { x: number; y: number };

type FloorPlanProps = {
  planImage?: number;
  /** Hazards to render as pins (normalized positions). */
  pins?: Hazard[];
  /** A pin being placed right now (edit mode). */
  draftPin?: Pos | null;
  /** Called with a normalized (0-1) position when the user taps to place. */
  onPlace?: (pos: Pos) => void;
  /** Called when an existing pin is tapped (view mode). */
  onPinPress?: (hazard: Hazard) => void;
  /** Caption shown bottom-left (e.g. floor label). */
  caption?: string;
};

const PIN = 24; // pin diameter in px

/**
 * Shared, crisp CDS floor-plan surface used by both the report picker and the
 * drill-down view. The container is locked to the plan's exact aspect ratio so
 * the image fills it with NO letterboxing — tap coordinates and pin coordinates
 * live in the same 0-1 space. Pins are positioned with measured PIXEL offsets
 * (not percentage strings, which render inconsistently across platforms), so a
 * dropped pin always lands and shows exactly where tapped.
 */
export function FloorPlan({
  planImage,
  pins = [],
  draftPin = null,
  onPlace,
  onPinPress,
  caption,
}: FloorPlanProps) {
  const theme = useTheme();
  const [layout, setLayout] = useState<LayoutRectangle | null>(null);
  const aspect = FLOOR_PLAN_SIZE.width / FLOOR_PLAN_SIZE.height;
  const placeable = !!onPlace;

  const w = layout?.width ?? 0;
  const h = layout?.height ?? 0;

  const handlePress = (locationX: number, locationY: number) => {
    if (!onPlace || !layout) return;
    const x = Math.min(1, Math.max(0, locationX / layout.width));
    const y = Math.min(1, Math.max(0, locationY / layout.height));
    onPlace({ x, y });
  };

  const pinStyle = (pos: Pos) => ({
    left: pos.x * w - PIN / 2,
    top: pos.y * h - PIN / 2,
  });

  return (
    <Pressable
      disabled={!placeable}
      accessibilityRole={placeable ? 'imagebutton' : 'image'}
      accessibilityLabel={caption ?? 'Floor plan'}
      onLayout={(e) => setLayout(e.nativeEvent.layout)}
      onPress={(e) => handlePress(e.nativeEvent.locationX, e.nativeEvent.locationY)}
      style={[styles.plan, { aspectRatio: aspect, borderColor: theme.border }]}>
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

      {/* Render pins only once we've measured the plan. */}
      {layout && (
        <>
          {pins
            .filter((h) => h.position)
            .map((hz) => (
              <Pressable
                key={hz.id}
                accessibilityRole="button"
                accessibilityLabel={`${hz.type}, severity ${hz.severity}`}
                onPress={() => onPinPress?.(hz)}
                style={[styles.pin, pinStyle(hz.position!)]}>
                <View style={[styles.pinDot, { backgroundColor: severityColor(hz.severity) }]}>
                  <View style={styles.pinInner} />
                </View>
              </Pressable>
            ))}

          {draftPin && (
            <View pointerEvents="none" style={[styles.pin, pinStyle(draftPin)]}>
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
    </Pressable>
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
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
  pinInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  captionChip: { position: 'absolute', bottom: Spacing.two, left: Spacing.two },
  captionBg: {
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  captionText: { color: '#fff', fontSize: 12, fontWeight: '600' },
});
