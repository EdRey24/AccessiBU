import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { floorLabel, storedHazardLabel, type Hazard } from '@/constants/hazards';
import { severityColor, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from './themed-text';

type NotificationsSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** High-severity hazards to list, newest first. */
  alerts: Hazard[];
  /** Ids that arrived this session and were unacknowledged when opened. */
  newIds: Set<string>;
  /** Jump to a hazard from the list. */
  onSelect?: (hazard: Hazard) => void;
};

/**
 * Bottom sheet listing high-severity hazards. Entries that arrived during this
 * session are flagged "New" so the reader can tell them apart from the ones
 * that were already on the map.
 */
export function NotificationsSheet({
  visible,
  onClose,
  alerts,
  newIds,
  onSelect,
}: NotificationsSheetProps) {
  const theme = useTheme();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={[styles.sheet, { backgroundColor: theme.background }]}>
          <View style={styles.sheetHeader}>
            <ThemedText type="smallBold">High-severity alerts</ThemedText>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
              <ThemedText type="smallBold" themeColor="textSecondary">
                ✕
              </ThemedText>
            </Pressable>
          </View>

          {alerts.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
              No high-severity hazards reported.
            </ThemedText>
          ) : (
            <ScrollView contentContainerStyle={styles.list}>
              {alerts.map((hazard) => (
                <Pressable
                  key={hazard.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${hazardTitle(hazard)}, severity ${hazard.severity} of 10, ${floorLabel(
                    hazard.floor,
                  )}`}
                  onPress={() => onSelect?.(hazard)}
                  style={[styles.row, { borderColor: theme.border }]}>
                  <View
                    style={[styles.dot, { backgroundColor: severityColor(hazard.severity) }]}
                  />
                  <View style={styles.rowBody}>
                    <View style={styles.rowTop}>
                      <ThemedText type="smallBold" style={styles.rowTitle}>
                        {hazardTitle(hazard)}
                      </ThemedText>
                      {newIds.has(hazard.id) ? (
                        <View style={[styles.newTag, { backgroundColor: severityColor(10) }]}>
                          <ThemedText type="small" style={styles.newTagText}>
                            New
                          </ThemedText>
                        </View>
                      ) : null}
                    </View>
                    <ThemedText type="small" themeColor="textSecondary">
                      {hazardMeta(hazard)}
                    </ThemedText>
                    {hazard.description ? (
                      <ThemedText type="small" themeColor="textSecondary">
                        {hazard.description}
                      </ThemedText>
                    ) : null}
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      </Pressable>
    </Modal>
  );
}

/** Best available name for a hazard. Shared with the alert toast. */
export function hazardTitle(hazard: Hazard): string {
  return hazard.hazardType ? storedHazardLabel(hazard.hazardType) : hazard.type;
}

/** Severity, place, and age on one line. Shared with the alert toast. */
export function hazardMeta(hazard: Hazard): string {
  const parts = [`Severity ${hazard.severity}/10`, floorLabel(hazard.floor)];
  if (hazard.room?.name) parts.push(hazard.room.name);
  parts.push(timeAgo(hazard.createdAt));
  return parts.join(' · ');
}

/** Short relative age, e.g. "4m ago". */
function timeAgo(createdAt: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - createdAt) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    maxHeight: '70%',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.four,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.three,
  },
  list: { gap: Spacing.two, paddingBottom: Spacing.three },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  dot: { width: 12, height: 12, borderRadius: 6, marginTop: 4 },
  rowBody: { flex: 1, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  rowTitle: { flexShrink: 1 },
  newTag: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  newTagText: { color: '#fff', fontWeight: '700' },
  empty: { textAlign: 'center', paddingVertical: Spacing.four },
});
