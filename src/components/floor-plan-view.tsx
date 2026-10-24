import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type { Hazard } from '@/constants/hazards';
import { floorLabel, floorPlanImage } from '@/constants/hazards';
import { BU, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useUserLocation } from '@/hooks/use-user-location';

import { FloorPlan } from './floor-plan';
import { ThemedText } from './themed-text';

type FloorPlanViewProps = {
  floor: number;
  hazards: Hazard[];
  onBack: () => void;
  onSelectHazard?: (hazard: Hazard) => void;
};

/**
 * Read-only 2D floor plan drill-down. Renders the real KPMB plan with every
 * hazard on this floor pinned at the reporter's exact normalized position.
 * A fixed top bar always shows a clear way back to the map; the plan is
 * centered and size-capped so it never overflows or hides the controls.
 */
export function FloorPlanView({ floor, hazards, onBack, onSelectHazard }: FloorPlanViewProps) {
  const theme = useTheme();
  const { planXY: userDot } = useUserLocation();
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
        <ThemedText type="smallBold">{floorLabel(floor)}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {floorHazards.length} {floorHazards.length === 1 ? 'hazard' : 'hazards'}
        </ThemedText>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        maximumZoomScale={3}
        minimumZoomScale={1}>
        <View style={styles.planWrap}>
          <FloorPlan
            planImage={floorPlanImage(floor)}
            floor={floor}
            pins={floorHazards}
            userDot={userDot}
            onPinPress={onSelectHazard}
            caption={floorLabel(floor)}
          />
        </View>
        {floorHazards.length === 0 && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            No hazards pinned on this floor yet.
          </ThemedText>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: 1,
    gap: Spacing.three,
  },
  backBtn: {
    borderRadius: Spacing.five,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  backText: { color: '#fff' },
  scroll: { flex: 1 },
  scrollContent: {
    padding: Spacing.three,
    alignItems: 'center',
  },
  planWrap: {
    width: '100%',
    // Cap the plan so it stays readable and centered on very wide monitors,
    // but allow it to grow large — the wide Floor 2 plan (≈2.4:1) looks cramped
    // at a small cap, so give it generous room.
    maxWidth: 1000,
    alignSelf: 'center',
  },
  empty: { textAlign: 'center', marginTop: Spacing.three },
});
