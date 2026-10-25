import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  floorLabel,
  floorPlanImage,
  HAZARD_TYPES,
  storedHazardLabel,
  type HazardType,
} from '@/constants/hazards';
import { BU, Spacing } from '@/constants/theme';
import { useHazards } from '@/hooks/use-hazards';
import { useTheme } from '@/hooks/use-theme';
import { failureMessage } from '@/services/api';
import { resolveFloor2Location } from '@/services/floor-geo';
import { storedHazardType, typeFromStored } from '@/services/hazards';
import {
  deleteMyReport,
  listMyReports,
  loadMyReportPhoto,
  replaceMyReportPhoto,
  updateMyReport,
  type OwnReport,
  type ReportChanges,
} from '@/services/reports';

import { CameraCapture } from './camera-capture';
import { Dropdown } from './dropdown';
import { ThemedText } from './themed-text';
import { ZoomableFloorPlan } from './zoomable-floor-plan';

type MyReportsModalProps = {
  visible: boolean;
  onClose: () => void;
};

const MAX_TEXT = 1000;
/** From this width up the sheet is a centered card, not full width. */
const WIDE_SCREEN = 768;

/** The member's own reports. Open ones can be edited or deleted. */
export function MyReportsModal({ visible, onClose }: MyReportsModalProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const wide = screenWidth >= WIDE_SCREEN;
  const { removeHazard, refresh } = useHazards();

  const [reports, setReports] = useState<OwnReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<OwnReport | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReports(await listMyReports());
      setError(null);
    } catch (caught) {
      setError(failureMessage(caught, 'Your reports could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  // State updates run after a microtask so the effect body never sets state
  // synchronously.
  useEffect(() => {
    if (!visible) return;
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (active) await load();
    })();
    return () => {
      active = false;
    };
  }, [visible, load]);

  // The shared map keeps local copies of hazards this device reported. Drop the
  // stale copy and reload so the map shows what the server now has.
  const syncMap = async (hazardId: string) => {
    removeHazard(hazardId);
    await refresh();
  };

  const close = () => {
    setEditing(null);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
      <View style={[styles.backdrop, wide && styles.backdropWide]}>
        <View
          style={[
            styles.sheet,
            wide && styles.sheetWide,
            { backgroundColor: theme.background, paddingBottom: insets.bottom + Spacing.four },
          ]}>
          <View style={styles.header}>
            <ThemedText type="subtitle" style={styles.title}>
              {editing ? 'Edit report' : 'My reports'}
            </ThemedText>
            <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close" style={styles.closeBtn}>
              <ThemedText type="subtitle" themeColor="textSecondary">
                ✕
              </ThemedText>
            </Pressable>
          </View>

          {editing ? (
            <ReportEditor
              key={editing.id}
              report={editing}
              onBack={() => setEditing(null)}
              onSaved={async (updated) => {
                setReports((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
                setEditing(null);
                await syncMap(updated.hazardId);
              }}
              onDeleted={async (deleted) => {
                setReports((prev) => prev.filter((r) => r.id !== deleted.id));
                setEditing(null);
                await syncMap(deleted.hazardId);
              }}
            />
          ) : (
            <ScrollView contentContainerStyle={styles.list}>
              {loading && reports.length === 0 ? <ActivityIndicator color={BU.red} /> : null}
              {error ? (
                <ThemedText type="small" style={styles.error} accessibilityRole="alert">
                  {error}
                </ThemedText>
              ) : null}
              {!loading && !error && reports.length === 0 ? (
                <ThemedText type="small" themeColor="textSecondary">
                  You have not submitted any reports yet.
                </ThemedText>
              ) : null}
              {reports.map((report) => (
                <ReportRow key={report.id} report={report} onPress={() => setEditing(report)} />
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function ReportRow({ report, onPress }: { report: OwnReport; onPress: () => void }) {
  const theme = useTheme();
  const resolved = !report.editable;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${storedHazardLabel(report.hazardType)}. ${
        resolved ? 'Resolved, cannot be changed.' : 'Tap to edit.'
      }`}
      accessibilityState={{ disabled: resolved }}
      disabled={resolved}
      onPress={onPress}
      style={[styles.row, { borderColor: theme.border, opacity: resolved ? 0.7 : 1 }]}>
      <View style={styles.rowTop}>
        <ThemedText type="smallBold">{storedHazardLabel(report.hazardType)}</ThemedText>
        <View style={[styles.badge, { backgroundColor: resolved ? '#3B9E4F' : BU.red }]}>
          <ThemedText type="smallBold" style={styles.badgeText}>
            {resolved ? 'Resolved' : 'Open'}
          </ThemedText>
        </View>
      </View>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
        {report.text || 'No description.'}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {floorLabel(report.floor)} · {new Date(report.createdAt).toLocaleDateString()}
        {resolved ? ' · Facilities resolved this, so it can no longer be changed' : ''}
      </ThemedText>
    </Pressable>
  );
}

function ReportEditor({
  report,
  onBack,
  onSaved,
  onDeleted,
}: {
  report: OwnReport;
  onBack: () => void;
  onSaved: (updated: OwnReport) => Promise<void>;
  onDeleted: (deleted: OwnReport) => Promise<void>;
}) {
  const theme = useTheme();
  const initialType = typeFromStored(report.hazardType);
  const [description, setDescription] = useState(report.text);
  const [type, setType] = useState<HazardType>(initialType);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(report.position);
  const [newPhoto, setNewPhoto] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The pin can be moved on the Floor 2 plan, and only when no one else has
  // reported this hazard.
  const canMovePin = report.canEditLocation && report.floor === 2 && report.position !== null;
  const note = description.trim();
  const pinMoved =
    canMovePin &&
    position !== null &&
    report.position !== null &&
    (Math.abs(position.x - report.position.x) > 1e-6 ||
      Math.abs(position.y - report.position.y) > 1e-6);
  const changed = note !== report.text || type !== initialType || pinMoved || newPhoto !== null;
  const canSave = changed && note.length > 0 && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      let updated = report;
      if (newPhoto) updated = await replaceMyReportPhoto(report.id, newPhoto);
      const changes: ReportChanges = {};
      if (note !== report.text) changes.description = note;
      if (type !== initialType) changes.hazardType = storedHazardType(type);
      if (pinMoved && position) {
        changes.location = {
          ...resolveFloor2Location(position).coordinate,
          floor: report.floor,
          position,
        };
      }
      if (Object.keys(changes).length > 0) updated = await updateMyReport(report.id, changes);
      await onSaved(updated);
    } catch (caught) {
      setError(failureMessage(caught, 'The report could not be saved.'));
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteMyReport(report.id);
      await onDeleted(report);
    } catch (caught) {
      setError(failureMessage(caught, 'The report could not be deleted.'));
      setBusy(false);
    }
  };

  return (
    <>
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        {report.hasPhoto ? (
          <>
            <ReportPhoto reportId={report.id} replacement={newPhoto} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retake photo"
              onPress={() => setCameraOpen(true)}
              disabled={busy}
              style={styles.retake}>
              <ThemedText type="small" style={{ color: BU.red }}>
                Retake photo
              </ThemedText>
            </Pressable>
          </>
        ) : null}

        <ThemedText type="smallBold">Description *</ThemedText>
        <TextInput
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={MAX_TEXT}
          editable={!busy}
          accessibilityLabel="Description"
          placeholder="Describe the hazard…"
          placeholderTextColor={theme.textSecondary}
          style={[
            styles.textArea,
            { borderColor: theme.border, color: theme.text, backgroundColor: theme.background },
          ]}
        />

        <ThemedText type="smallBold">Hazard type</ThemedText>
        <Dropdown
          value={type}
          onChange={setType}
          options={HAZARD_TYPES.map((option) => ({ value: option, label: option }))}
        />

        {canMovePin ? (
          <>
            <ThemedText type="smallBold">Drag the pin to the exact spot</ThemedText>
            <ZoomableFloorPlan
              planImage={floorPlanImage(report.floor)}
              floor={report.floor ?? 2}
              draftPin={position}
              onPlace={setPosition}
              showFeatures
              caption={floorLabel(report.floor)}
            />
          </>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            {report.canEditLocation
              ? 'The location of this report cannot be changed here.'
              : 'The location is locked because other members also reported this hazard.'}
          </ThemedText>
        )}
      </ScrollView>

      {error ? (
        <ThemedText type="small" style={styles.error} accessibilityRole="alert">
          {error}
        </ThemedText>
      ) : null}

      {confirmDelete ? (
        <View style={[styles.confirm, { borderColor: BU.red }]}>
          <ThemedText type="smallBold">Delete this report?</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            This cannot be undone. If it is the only report on this hazard, the hazard is removed
            from the map too.
          </ThemedText>
          <View style={styles.actions}>
            <EditorButton label="Cancel" onPress={() => setConfirmDelete(false)} disabled={busy} />
            <EditorButton
              label={busy ? 'Deleting…' : 'Yes, delete'}
              onPress={() => void remove()}
              disabled={busy}
              tone="danger"
            />
          </View>
        </View>
      ) : (
        <View style={styles.actions}>
          <EditorButton label="Back" onPress={onBack} disabled={busy} />
          <EditorButton
            label="Delete"
            onPress={() => setConfirmDelete(true)}
            disabled={busy}
            tone="danger-outline"
          />
          <EditorButton
            label={busy ? 'Saving…' : 'Save changes'}
            onPress={() => void save()}
            disabled={!canSave}
            tone="primary"
          />
        </View>
      )}

      <CameraCapture
        visible={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(uri) => {
          setNewPhoto(uri);
          setCameraOpen(false);
        }}
      />
    </>
  );
}

function ReportPhoto({ reportId, replacement }: { reportId: string; replacement: string | null }) {
  const [state, setState] = useState<{ id: string; uri: string | null; error: string | null } | null>(
    null
  );

  useEffect(() => {
    let active = true;
    loadMyReportPhoto(reportId)
      .then((uri) => {
        if (active) setState({ id: reportId, uri, error: null });
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setState({
          id: reportId,
          uri: null,
          error: failureMessage(caught, 'The photo could not be loaded.'),
        });
      });
    return () => {
      active = false;
    };
  }, [reportId]);

  if (replacement) {
    return <Image source={{ uri: replacement }} style={styles.photo} contentFit="cover" />;
  }
  const settled = state?.id === reportId ? state : null;
  if (!settled) return <ActivityIndicator color={BU.red} />;
  if (settled.error) {
    return (
      <ThemedText type="small" style={styles.error} accessibilityRole="alert">
        {settled.error}
      </ThemedText>
    );
  }
  if (!settled.uri) return null;
  return (
    <Image
      source={{ uri: settled.uri }}
      style={styles.photo}
      contentFit="cover"
      accessibilityLabel="Report photo"
    />
  );
}

function EditorButton({
  label,
  onPress,
  disabled,
  tone = 'neutral',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'neutral' | 'primary' | 'danger' | 'danger-outline';
}) {
  const theme = useTheme();
  const filled = tone === 'primary' || tone === 'danger';
  const background = tone === 'primary' || tone === 'danger' ? BU.red : 'transparent';
  const border = tone === 'neutral' ? theme.border : BU.red;
  const color = filled ? '#fff' : tone === 'danger-outline' ? BU.red : theme.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.action,
        { backgroundColor: background, borderColor: border, opacity: disabled ? 0.5 : 1 },
      ]}>
      <ThemedText type="smallBold" style={{ color }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  backdropWide: { justifyContent: 'center', padding: Spacing.four },
  sheet: {
    width: '100%',
    maxWidth: 720,
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    maxHeight: '92%',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
  },
  sheetWide: {
    borderRadius: Spacing.four,
    maxHeight: '100%',
    paddingBottom: Spacing.four,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.three,
  },
  title: { fontSize: 28, lineHeight: 34 },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  list: { gap: Spacing.two, paddingBottom: Spacing.three },
  row: { borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { borderRadius: Spacing.three, paddingHorizontal: Spacing.two, paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: 12, lineHeight: 16 },
  form: { gap: Spacing.three, paddingBottom: Spacing.three },
  photo: { width: '100%', aspectRatio: 16 / 9, maxHeight: 280, borderRadius: Spacing.three },
  retake: { alignSelf: 'flex-start', marginTop: -Spacing.two },
  textArea: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    minHeight: 84,
    textAlignVertical: 'top',
    fontSize: 16,
  },
  error: { color: BU.red, marginBottom: Spacing.two },
  confirm: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  actions: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap', marginTop: Spacing.two },
  action: {
    borderWidth: 1,
    borderRadius: Spacing.five,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
});
