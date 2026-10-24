import { Pressable, StyleSheet, View } from 'react-native';

import type { Hazard } from '@/constants/hazards';
import { floorLabel, floorPlanImage } from '@/constants/hazards';
import { Spacing } from '@/constants/theme';

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
 */
export function FloorPlanView({ floor, hazards, onBack, onSelectHazard }: FloorPlanViewProps) {
  const floorHazards = hazards.filter(
    (h) => h.location === 'inside' && h.floor === floor && h.position
  );

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Pressable onPress={onBack} accessibilityLabel="Back to map" style={styles.backBtn}>
          <ThemedText type="smallBold">‹ Back to map</ThemedText>
        </Pressable>
        <ThemedText type="smallBold">{floorLabel(floor)}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {floorHazards.length} {floorHazards.length === 1 ? 'hazard' : 'hazards'}
        </ThemedText>
      </View>

      <View style={styles.planWrap}>
        <FloorPlan
          planImage={floorPlanImage(floor)}
          pins={floorHazards}
          onPinPress={onSelectHazard}
          caption={floorLabel(floor)}
        />
      </View>

      {floorHazards.length === 0 && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
          No hazards pinned on this floor.
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: Spacing.three, gap: Spacing.three },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { paddingVertical: Spacing.one },
  planWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { textAlign: 'center' },
});
