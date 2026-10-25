import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppHeader } from '@/components/app-header';
import { CampusMap } from '@/components/campus-map';
import { FloorPlanView } from '@/components/floor-plan-view';
import { HazardAlertToast } from '@/components/hazard-alert-toast';
import { MyReportsModal } from '@/components/my-reports-modal';
import { NotificationsSheet } from '@/components/notifications-sheet';
import { ReportHazardModal } from '@/components/report-hazard-modal';
import { ThemedText } from '@/components/themed-text';
import { CDS_FLOORS, floorLabel, storedHazardLabel, type Hazard } from '@/constants/hazards';
import { BU, severityColor, Spacing } from '@/constants/theme';
import { useHazardAlerts } from '@/hooks/use-hazard-alerts';
import { useHazards } from '@/hooks/use-hazards';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import { failureMessage } from '@/services/api';
import { loadHazardPhoto } from '@/services/hazards';

/** Either the 3D campus map, or a specific floor's 2D plan. */
type Screen = { kind: 'map' } | { kind: 'floor'; floor: number };

export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { member, signOut } = useSession();
  const { hazards, refresh, loading, error } = useHazards();
  const { alerts, unseen, unseenCount, markAllSeen } = useHazardAlerts();
  const [screen, setScreen] = useState<Screen>({ kind: 'map' });
  const [reportOpen, setReportOpen] = useState(false);
  const [myReportsOpen, setMyReportsOpen] = useState(false);
  const [floorPickerOpen, setFloorPickerOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [detail, setDetail] = useState<Hazard | null>(null);
  // Snapshot of what was new when the sheet opened, so the "New" tags survive
  // acknowledging them on open.
  const [alertNewIds, setAlertNewIds] = useState<Set<string>>(new Set());

  const insideCount = hazards.filter((h) => h.location === 'inside').length;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      {/* Header: inline actions on wide screens, a menu on phones */}
      <AppHeader
        activeCount={hazards.length}
        isAdmin={member?.role === 'admin'}
        alertCount={unseenCount}
        onAlerts={() => {
          setAlertNewIds(new Set(unseen.map((h) => h.id)));
          setAlertsOpen(true);
          markAllSeen();
        }}
        onMyReports={() => setMyReportsOpen(true)}
        onFacilities={() => router.push('/facilities')}
        onSignOut={() => {
          void signOut();
        }}
      />

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
            onChangeFloor={() => setFloorPickerOpen(true)}
            onSelectHazard={(h) => setDetail(h)}
          />
        )}
      </View>

      {/* Bottom bar. Padded above the phone's gesture bar. */}
      <View
        style={[
          styles.bottomBar,
          { borderColor: theme.border, paddingBottom: Math.max(insets.bottom, Spacing.three) },
        ]}>
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
          {error ? (
            <ThemedText type="small" style={styles.loadError} accessibilityRole="alert">
              {error}
            </ThemedText>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              {insideCount === 0
                ? 'No active hazards reported. Tap to refresh.'
                : `${insideCount} report${insideCount === 1 ? '' : 's'} on CDS. Tap to refresh.`}
            </ThemedText>
          )}
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

      {/* The member's own reports: edit or delete */}
      <MyReportsModal visible={myReportsOpen} onClose={() => setMyReportsOpen(false)} />

      {/* Floor picker (tap building -> choose a floor) */}
      <FloorPickerSheet
        visible={floorPickerOpen}
        onClose={() => setFloorPickerOpen(false)}
        onPick={(floor) => {
          setFloorPickerOpen(false);
          setScreen({ kind: 'floor', floor });
        }}
        hazards={hazards}
        current={screen.kind === 'floor' ? screen.floor : null}
      />

      {/* Auto-appearing banner for newly reported high-severity hazards */}
      <HazardAlertToast
        alerts={unseen}
        onPress={(h) => {
          markAllSeen();
          if (h.floor !== null) setScreen({ kind: 'floor', floor: h.floor });
          setDetail(h);
        }}
      />

      {/* High-severity alerts */}
      <NotificationsSheet
        visible={alertsOpen}
        onClose={() => setAlertsOpen(false)}
        alerts={alerts}
        newIds={alertNewIds}
        onSelect={(h) => {
          setAlertsOpen(false);
          if (h.floor !== null) setScreen({ kind: 'floor', floor: h.floor });
          setDetail(h);
        }}
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
  current,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (floor: number) => void;
  hazards: Hazard[];
  /** The floor being viewed, if any. It is marked in the list. */
  current: number | null;
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
            {/* Every floor for the demo, Basement first (most used) up to the top floor. */}
            {[...CDS_FLOORS].sort((a, b) => a.value - b.value).map((f) => {
              const count = hazards.filter(
                (h) => h.location === 'inside' && h.floor === f.value
              ).length;
              return (
                <Pressable
                  key={f.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: f.value === current }}
                  onPress={() => onPick(f.value)}
                  style={[
                    styles.floorRow,
                    { borderColor: f.value === current ? BU.red : theme.border },
                    f.value === current && styles.floorRowCurrent,
                  ]}>
                  <ThemedText type={f.value === current ? 'smallBold' : 'default'}>
                    {floorLabel(f.value)}
                    {f.value === current ? '  (viewing)' : ''}
                  </ThemedText>
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
  const hazardId = hazard?.id ?? null;
  const localPhoto = hazard?.photoUri ?? null;
  const [loaded, setLoaded] = useState<{
    id: string;
    uri: string | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (!hazardId || localPhoto) return;
    let active = true;
    loadHazardPhoto(hazardId)
      .then((uri) => {
        if (active) setLoaded({ id: hazardId, uri, error: null });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoaded({
          id: hazardId,
          uri: null,
          error: failureMessage(error, 'The photo could not be loaded.'),
        });
      });
    return () => {
      active = false;
    };
  }, [hazardId, localPhoto]);

  const settled = loaded?.id === hazardId ? loaded : null;
  const photo = localPhoto ?? settled?.uri ?? null;
  const loadingPhoto = hazardId !== null && !localPhoto && settled === null;

  return (
    <Modal visible={!!hazard} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.detailBackdrop} onPress={onClose}>
        {hazard && (
          <View style={[styles.detailCard, { backgroundColor: theme.background }]}>
            <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailBody}>
              {photo ? (
                <Image
                  source={{ uri: photo }}
                  style={styles.detailPhoto}
                  contentFit="cover"
                  accessibilityLabel="Hazard photo"
                />
              ) : loadingPhoto ? (
                <ActivityIndicator color={BU.red} />
              ) : null}
              {settled?.error ? (
                <ThemedText type="small" style={styles.loadError} accessibilityRole="alert">
                  {settled.error}
                </ThemedText>
              ) : null}
              {hazard.description ? (
                <ThemedText type="default">{hazard.description}</ThemedText>
              ) : (
                <ThemedText type="default" themeColor="textSecondary">
                  No description provided.
                </ThemedText>
              )}
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
            </ScrollView>
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

  main: { flex: 1 },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    borderTopWidth: 1,
  },
  // minWidth 0 lets this text wrap instead of pushing the button off screen.
  reportsSummary: { flex: 1, minWidth: 0, gap: 2 },
  reportsHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  loadError: { color: BU.red },
  fab: {
    flexShrink: 0,
    minHeight: 48,
    justifyContent: 'center',
    backgroundColor: BU.red,
    borderRadius: Spacing.five,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  fabText: { color: '#fff' },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  detailBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.four,
  },
  sheet: {
    width: '100%',
    maxWidth: 560,
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
  floorRowCurrent: { borderWidth: 2 },
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
    width: '100%',
    maxWidth: 560,
    borderRadius: Spacing.four,
    padding: Spacing.four,
    gap: Spacing.two,
    maxHeight: '80%',
  },
  detailScroll: { flexGrow: 0, maxHeight: 480 },
  detailBody: { gap: Spacing.two },
  detailPhoto: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: Spacing.three,
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
