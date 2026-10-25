import { Pressable, StyleSheet, View } from 'react-native';

import type { Hazard } from '@/constants/hazards';
import { floorLabel, floorPlanImage } from '@/constants/hazards';
import { BU, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from './themed-text';
import { ZoomableFloorPlan } from './zoomable-floor-plan';

type FloorPlanViewProps = {
  floor: number;
  hazards: Hazard[];
  onBack: () => void;
  /** Opens the floor picker, so the member can jump to another floor. */
  onChangeFloor: () => void;
  onSelectHazard?: (hazard: Hazard) => void;
};

/**
 * Read-only 2D floor plan drill-down. Renders the real KPMB plan with every
 * hazard on this floor pinned at the reporter's exact normalized position.
 *
 * The plan fills all the space under the top bar and opens zoomed in, so on a
 * narrow phone it is large enough to read instead of a thin strip. Pinch,
 * scroll, or double-tap to zoom, and drag to move around. Tapping the floor
 * name switches floors without going back to the map.
 */
export function FloorPlanView({
  floor,
  hazards,
  onBack,
  onChangeFloor,
  onSelectHazard,
}: FloorPlanViewProps) {
  const theme = useTheme();
  const floorHazards = hazards.filter(
    (h) => h.location === 'inside' && h.floor === floor && h.position
  );

  return (
    <View style={styles.container}>
      {/* Fixed top bar — always visible, with a prominent Back button */}
      <View style={[styles.topBar, { borderColor: theme.border, backgroundColor: theme.background }]}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back to map"
          style={[styles.backBtn, { backgroundColor: BU.red }]}>
          <ThemedText type="smallBold" style={styles.backText}>
            ‹ Back to map
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={onChangeFloor}
          accessibilityRole="button"
          accessibilityLabel={`${floorLabel(floor)}. Change floor.`}
          style={[styles.floorBtn, { borderColor: theme.border }]}>
          <ThemedText type="smallBold">{floorLabel(floor)} ▾</ThemedText>
        </Pressable>
        <ThemedText type="small" themeColor="textSecondary">
          {floorHazards.length} {floorHazards.length === 1 ? 'hazard' : 'hazards'}
        </ThemedText>
      </View>

      <View style={styles.planArea}>
        <ZoomableFloorPlan
          fill
          planImage={floorPlanImage(floor)}
          floor={floor}
          pins={floorHazards}
          onPinPress={onSelectHazard}
          caption={floorLabel(floor)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: 1,
    gap: Spacing.two,
  },
  backBtn: {
    minHeight: 40,
    justifyContent: 'center',
    borderRadius: Spacing.five,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  backText: { color: '#fff' },
  floorBtn: {
    minHeight: 40,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: Spacing.five,
    paddingHorizontal: Spacing.three,
  },
  planArea: { flex: 1, padding: Spacing.two },
});
