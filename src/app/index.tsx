import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CampusMap } from '@/components/campus-map';
import { FloorPlanView } from '@/components/floor-plan-view';
import { ReportHazardModal } from '@/components/report-hazard-modal';
import { ThemedText } from '@/components/themed-text';
import { CDS_FLOORS, floorLabel, storedHazardLabel, type Hazard } from '@/constants/hazards';
import { BU, severityColor, Spacing } from '@/constants/theme';
import { useHazards } from '@/hooks/use-hazards';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';

/** Either the 3D campus map, or a specific floor's 2D plan. */
type Screen = { kind: 'map' } | { kind: 'floor'; floor: number };

export default function HomeScreen() {
  const theme = useTheme();
  const { signOut } = useSession();
  const { hazards, refresh, loading } = useHazards();
  const [screen, setScreen] = useState<Screen>({ kind: 'map' });
  const [reportOpen, setReportOpen] = useState(false);
  const [floorPickerOpen, setFloorPickerOpen] = useState(false);
  const [detail, setDetail] = useState<Hazard | null>(null);

  const insideCount = hazards.filter((h) => h.location === 'inside').length;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <ThemedText type="subtitle" style={styles.brand}>
            AccessiBU
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Boston University
          </ThemedText>
        </View>
        <View style={styles.headerRight}>
          <ThemedText type="small" themeColor="textSecondary">
            {hazards.length} active
          </ThemedText>
          <Pressable
            style={[styles.alertsBtn, { borderColor: theme.border }]}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            onPress={() => {
              void signOut();
            }}>
            <ThemedText type="small">Sign out</ThemedText>
          </Pressable>
          <Pressable
            style={[styles.alertsBtn, { borderColor: theme.border }]}
            accessibilityRole="button"
            accessibilityLabel="Nearby alerts">
            <ThemedText type="small">🔔</ThemedText>
          </Pressable>
        </View>
      </View>

      {/* Main view: 3D map or 2D floor plan */}
      <View style={styles.main}>
        {screen.kind === 'map' ? (
          <CampusMap
            hazards={hazards}
            onSelectBuilding={() => setFloorPickerOpen(true)}
            onSelectHazard={(h) => {
              if (h.floor !== null) setScreen({ kind: 'floor', floor: h.floor });
              setDetail(h);
            }}
          />
        ) : (
          <FloorPlanView
            floor={screen.floor}
            hazards={hazards}
            onBack={() => setScreen({ kind: 'map' })}
            onSelectHazard={(h) => setDetail(h)}
          />
        )}
      </View>

      {/* Bottom bar */}
      <View style={[styles.bottomBar, { borderColor: theme.border }]}>
        <Pressable
          style={styles.reportsSummary}
          accessibilityRole="button"
          accessibilityLabel="Refresh reports"
          onPress={() => {
            void refresh();
          }}>
          <View style={styles.reportsHeader}>
            <ThemedText type="smallBold">Active reports</ThemedText>
            {loading ? (
              <ActivityIndicator size="small" color={BU.red} />
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                ↻
              </ThemedText>
            )}
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {insideCount === 0
              ? 'No active hazards reported. Tap to refresh.'
              : `${insideCount} report${insideCount === 1 ? '' : 's'} on CDS. Tap to refresh.`}
          </ThemedText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Report hazard"
          onPress={() => setReportOpen(true)}
          style={styles.fab}>
          <ThemedText type="smallBold" style={styles.fabText}>
            +  Report Hazard
          </ThemedText>
        </Pressable>
      </View>

      {/* Report flow */}
      <ReportHazardModal visible={reportOpen} onClose={() => setReportOpen(false)} />

      {/* Floor picker (tap building -> choose a floor) */}
      <FloorPickerSheet
        visible={floorPickerOpen}
        onClose={() => setFloorPickerOpen(false)}
        onPick={(floor) => {
          setFloorPickerOpen(false);
          setScreen({ kind: 'floor', floor });
        }}
        hazards={hazards}
      />

      {/* Hazard detail */}
      <HazardDetailSheet hazard={detail} onClose={() => setDetail(null)} />
    </SafeAreaView>
  );
}

function FloorPickerSheet({
  visible,
  onClose,
  onPick,
  hazards,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (floor: number) => void;
  hazards: Hazard[];
}) {
  const theme = useTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={[styles.sheet, { backgroundColor: theme.background }]}>
          <View style={styles.sheetHeader}>
            <ThemedText type="smallBold">Choose a floor</ThemedText>
            <Pressable onPress={onClose} accessibilityLabel="Close">
              <ThemedText type="smallBold" themeColor="textSecondary">
                ✕
              </ThemedText>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.floorList}>
            {CDS_FLOORS.map((f) => {
              const count = hazards.filter(
                (h) => h.location === 'inside' && h.floor === f.value
              ).length;
              return (
                <Pressable
                  key={f.value}
                  onPress={() => onPick(f.value)}
                  style={[styles.floorRow, { borderColor: theme.border }]}>
                  <ThemedText type="default">{floorLabel(f.value)}</ThemedText>
                  <ThemedText
                    type="small"
                    themeColor={count === 0 ? 'textSecondary' : undefined}
                    style={count > 0 && styles.floorCountActive}>
                    {count === 0 ? 'clear' : `${count} hazard${count > 1 ? 's' : ''}`}
                  </ThemedText>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

function severityLabel(hazard: Hazard): string {
  if (hazard.hazardType) {
    return hazard.severityScore != null
      ? `severity ${hazard.severityScore}/100`
      : 'severity stored on the hazard';
  }
  return `severity ${hazard.severity}/10`;
}

function HazardDetailSheet({
  hazard,
  onClose,
}: {
  hazard: Hazard | null;
  onClose: () => void;
}) {
  const theme = useTheme();
  return (
    <Modal visible={!!hazard} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {hazard && (
          <View style={[styles.detailCard, { backgroundColor: theme.background }]}>
            <View style={styles.detailHeader}>
              <View style={[styles.detailDot, { backgroundColor: severityColor(hazard.severity) }]} />
              <ThemedText type="subtitle" style={styles.detailTitle}>
                {hazard.hazardType ? storedHazardLabel(hazard.hazardType) : hazard.type}
              </ThemedText>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {floorLabel(hazard.floor)} · {severityLabel(hazard)}
            </ThemedText>
            {hazard.room && (
              <ThemedText type="small" themeColor="textSecondary">
                📍 {hazard.room.name} ({hazard.room.category})
              </ThemedText>
            )}
            {hazard.coordinate && (
              <ThemedText type="small" themeColor="textSecondary">
                {hazard.coordinate.latitude.toFixed(6)}, {hazard.coordinate.longitude.toFixed(6)}
              </ThemedText>
            )}
            {hazard.description ? (
              <ThemedText type="default">{hazard.description}</ThemedText>
            ) : (
              <ThemedText type="default" themeColor="textSecondary">
                No description provided.
              </ThemedText>
            )}
            <Pressable onPress={onClose} style={[styles.detailClose, { backgroundColor: BU.red }]}>
              <ThemedText type="smallBold" style={styles.fabText}>
                Close
              </ThemedText>
            </Pressable>
          </View>
        )}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  brand: { color: BU.red, fontSize: 28, lineHeight: 32, fontWeight: '800' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  alertsBtn: {
    borderWidth: 1,
    borderRadius: Spacing.five,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  main: { flex: 1 },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderTopWidth: 1,
  },
  reportsSummary: { flex: 1, gap: 2 },
  reportsHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  fab: {
    backgroundColor: BU.red,
    borderRadius: Spacing.five,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  fabText: { color: '#fff' },
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
  floorList: { gap: Spacing.two, paddingBottom: Spacing.three },
  floorCountActive: { color: BU.red, fontWeight: '700' },
  floorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  detailCard: {
    margin: Spacing.four,
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.two,
    marginBottom: Spacing.six,
  },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  detailDot: { width: 16, height: 16, borderRadius: 8 },
  detailTitle: { fontSize: 24, lineHeight: 30 },
  detailClose: {
    marginTop: Spacing.three,
    borderRadius: Spacing.five,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
});
