import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Linking,
    Pressable,
    ScrollView,
    StyleSheet,
    useWindowDimensions,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FloorPlan } from '@/components/floor-plan';
import { ThemedText } from '@/components/themed-text';
import { floorLabel, floorPlanImage, storedHazardLabel } from '@/constants/hazards';
import { BU, severityColor, Spacing } from '@/constants/theme';
import { useHazards } from '@/hooks/use-hazards';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import {
    deleteAdminHazard,
    listAdminHazards,
    reopenAdminHazard,
    resolveAdminHazard,
    toPinHazard,
    type AdminHazard,
    type StatusFilter
} from '@/services/admin';
import { ApiError, failureMessage } from '@/services/api';
import { resolveFloor2Location } from '@/services/floor-geo';
import { loadHazardPhoto, pinSeverityFromScore } from '@/services/hazards';

type SortKey = 'severity' | 'newest';

const WIDE_BREAKPOINT = 960;
const RESOLVED_GREEN = '#3B9E4F';

/** Facilities dashboard: every hazard, where it is, and resolve / delete. */
export default function FacilitiesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { signOut } = useSession();
  const { removeHazard, refresh } = useHazards();
  const wide = width >= WIDE_BREAKPOINT;

  const [hazards, setHazards] = useState<AdminHazard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('open');
  const [sort, setSort] = useState<SortKey>('severity');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setHazards(await listAdminHazards('all'));
      setError(null);
    } catch (caught) {
      setError(failureMessage(caught, 'Hazards could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  // State updates run after a microtask so the effect body never sets state
  // synchronously.
  useEffect(() => {
    let active = true;
    void (async () => {
      await Promise.resolve();
      if (active) await load();
    })();
    return () => {
      active = false;
    };
  }, [load]);

  const openCount = hazards.filter((h) => h.status === 'open').length;
  const resolvedCount = hazards.length - openCount;

  const visible = useMemo(() => {
    const rows = filter === 'all' ? hazards : hazards.filter((h) => h.status === filter);
    return [...rows].sort((a, b) =>
      sort === 'severity'
        ? b.severityScore - a.severityScore || b.createdAt - a.createdAt
        : b.createdAt - a.createdAt
    );
  }, [hazards, filter, sort]);

  const selected = hazards.find((h) => h.id === selectedId) ?? null;

  const choose = (id: string) => {
    setSelectedId(id);
    setConfirmDelete(false);
    setActionError(null);
  };

  const resolve = async (id: string) => {
    setBusy(true);
    setActionError(null);
    try {
      const updated = await resolveAdminHazard(id);
      setHazards((prev) => prev.map((h) => (h.id === id ? updated : h)));
      removeHazard(id);
    } catch (caught) {
      setActionError(failureMessage(caught, 'The hazard could not be resolved.'));
      if (caught instanceof ApiError && caught.status === 404) void load();
    } finally {
      setBusy(false);
    }
  };

  const reopen = async (id: string) => {
    setBusy(true);
    setActionError(null);
    try {
      const updated = await reopenAdminHazard(id);
      setHazards((prev) => prev.map((h) => (h.id === id ? updated : h)));
      // Resolving removed the pin from the shared map state; load it back.
      void refresh();
    } catch (caught) {
      setActionError(failureMessage(caught, 'The hazard could not be reopened.'));
      if (caught instanceof ApiError && caught.status === 404) void load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setActionError(null);
    try {
      await deleteAdminHazard(id);
      setHazards((prev) => prev.filter((h) => h.id !== id));
      removeHazard(id);
      setSelectedId(null);
      setConfirmDelete(false);
    } catch (caught) {
      setActionError(failureMessage(caught, 'The hazard could not be deleted.'));
      if (caught instanceof ApiError && caught.status === 404) void load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.header}>
        <View>
          <ThemedText type="subtitle" style={styles.brand}>
            Facilities
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {openCount} open · {resolvedCount} resolved
          </ThemedText>
        </View>
        <View style={styles.headerRight}>
          <HeaderButton label="Refresh" onPress={() => void load()} busy={loading} />
          <HeaderButton label="Back to map" onPress={() => router.replace('/')} />
          <HeaderButton label="Sign out" onPress={() => void signOut()} />
        </View>
      </View>

      <View style={[styles.toolbar, { borderColor: theme.border }]}>
        <View style={styles.chipGroup}>
          {(['open', 'resolved', 'all'] as const).map((key) => (
            <Chip
              key={key}
              label={key === 'open' ? 'Open' : key === 'resolved' ? 'Resolved' : 'All'}
              active={filter === key}
              onPress={() => setFilter(key)}
            />
          ))}
        </View>
        <View style={styles.chipGroup}>
          <ThemedText type="small" themeColor="textSecondary">
            Sort
          </ThemedText>
          <Chip label="Severity" active={sort === 'severity'} onPress={() => setSort('severity')} />
          <Chip label="Newest" active={sort === 'newest'} onPress={() => setSort('newest')} />
        </View>
      </View>

      {error ? (
        <ThemedText type="small" style={styles.error} accessibilityRole="alert">
          {error}
        </ThemedText>
      ) : null}

      <View style={[styles.body, wide && styles.bodyWide]}>
        <ScrollView
          style={wide ? styles.listWide : styles.listNarrow}
          contentContainerStyle={styles.listContent}>
          {loading && hazards.length === 0 ? <ActivityIndicator color={BU.red} /> : null}
          {!loading && !error && visible.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              {filter === 'open' ? 'No open hazards.' : 'No hazards to show.'}
            </ThemedText>
          ) : null}
          {visible.map((hazard) => (
            <HazardRow
              key={hazard.id}
              hazard={hazard}
              selected={hazard.id === selectedId}
              onPress={() => choose(hazard.id)}
            />
          ))}
        </ScrollView>

        <ScrollView
          style={wide ? styles.detailWide : styles.detailNarrow}
          contentContainerStyle={styles.detailContent}>
          {selected ? (
            <HazardDetail
              key={selected.id}
              hazard={selected}
              allHazards={hazards}
              busy={busy}
              confirmDelete={confirmDelete}
              actionError={actionError}
              onSelect={choose}
              onResolve={() => void resolve(selected.id)}
              onReopen={() => void reopen(selected.id)}
              onAskDelete={() => setConfirmDelete(true)}
              onCancelDelete={() => setConfirmDelete(false)}
              onDelete={() => void remove(selected.id)}
            />
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              Select a hazard to see its photo, location, and actions.
            </ThemedText>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function HeaderButton({
  label,
  onPress,
  busy = false,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={busy}
      style={[styles.headerButton, { borderColor: theme.border }]}>
      {busy ? <ActivityIndicator size="small" color={BU.red} /> : <ThemedText type="small">{label}</ThemedText>}
    </Pressable>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.chip,
        { borderColor: active ? BU.red : theme.border, backgroundColor: active ? BU.red : 'transparent' },
      ]}>
      <ThemedText type="smallBold" style={{ color: active ? '#fff' : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function StatusBadge({ status }: { status: AdminHazard['status'] }) {
  const open = status === 'open';
  return (
    <View style={[styles.badge, { backgroundColor: open ? BU.red : RESOLVED_GREEN }]}>
      <ThemedText type="smallBold" style={styles.badgeText}>
        {open ? 'Open' : 'Resolved'}
      </ThemedText>
    </View>
  );
}

function HazardRow({
  hazard,
  selected,
  onPress,
}: {
  hazard: AdminHazard;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const pin = pinSeverityFromScore(hazard.severityScore);
  const type = hazard.hazardType ? storedHazardLabel(hazard.hazardType) : 'Hazard';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${type}, severity ${hazard.severityScore} of 100, ${hazard.status}`}
      onPress={onPress}
      style={[
        styles.row,
        {
          borderColor: selected ? BU.red : theme.border,
          backgroundColor: selected ? theme.backgroundSelected : theme.background,
        },
      ]}>
      <View style={[styles.severityBadge, { backgroundColor: severityColor(pin) }]}>
        <ThemedText type="smallBold" style={styles.severityText}>
          {pin}
        </ThemedText>
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <ThemedText type="smallBold">{type}</ThemedText>
          <StatusBadge status={hazard.status} />
        </View>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
          {hazard.summary?.trim() ? hazard.summary : 'No description.'}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {floorLabel(hazard.floor)} · {ago(hazard.createdAt)}
          {hazard.reportCount > 1 ? ` · ${hazard.reportCount} reports` : ''}
        </ThemedText>
      </View>
    </Pressable>
  );
}

function HazardDetail({
  hazard,
  allHazards,
  busy,
  confirmDelete,
  actionError,
  onSelect,
  onResolve,
  onReopen,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  hazard: AdminHazard;
  allHazards: AdminHazard[];
  busy: boolean;
  confirmDelete: boolean;
  actionError: string | null;
  onSelect: (id: string) => void;
  onResolve: () => void;
  onReopen: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  const theme = useTheme();
  const pin = pinSeverityFromScore(hazard.severityScore);
  const type = hazard.hazardType ? storedHazardLabel(hazard.hazardType) : 'Hazard';
  const room =
    hazard.floor === 2 && hazard.position ? resolveFloor2Location(hazard.position).room : null;
  const planImage = hazard.floor !== null ? floorPlanImage(hazard.floor) : undefined;
  const hasPlan = hazard.floor !== null && hazard.position !== null && planImage !== undefined;
  const floorPins = useMemo(
    () =>
      hasPlan
        ? allHazards
            .filter(
              (h) =>
                h.floor === hazard.floor && h.position && (h.status === 'open' || h.id === hazard.id)
            )
            .map(toPinHazard)
        : [],
    [allHazards, hasPlan, hazard.floor, hazard.id]
  );
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${hazard.latitude},${hazard.longitude}`;
  const resolved = hazard.status === 'resolved';

  return (
    <View style={styles.detail}>
      <View style={styles.detailTitleRow}>
        <View style={[styles.severityBadge, { backgroundColor: severityColor(pin) }]}>
          <ThemedText type="smallBold" style={styles.severityText}>
            {pin}
          </ThemedText>
        </View>
        <View style={styles.rowBody}>
          <ThemedText type="subtitle" style={styles.detailTitle}>
            {type}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Severity {hazard.severityScore}/100 · {hazard.reportCount}{' '}
            {hazard.reportCount === 1 ? 'report' : 'reports'}
          </ThemedText>
        </View>
        <StatusBadge status={hazard.status} />
      </View>

      <HazardPhoto key={hazard.id} hazardId={hazard.id} />

      <ThemedText type="default">
        {hazard.summary?.trim() ? hazard.summary : 'No description provided.'}
      </ThemedText>

      <View style={[styles.facts, { borderColor: theme.border }]}>
        <Fact label="Floor" value={floorLabel(hazard.floor)} />
        {room ? <Fact label="Room" value={`${room.name} (${room.category})`} /> : null}
        <Fact
          label="Coordinates"
          value={`${hazard.latitude.toFixed(6)}, ${hazard.longitude.toFixed(6)}`}
        />
        <Fact label="Reported" value={new Date(hazard.createdAt).toLocaleString()} />
        {hazard.resolvedAt ? (
          <Fact label="Resolved" value={new Date(hazard.resolvedAt).toLocaleString()} />
        ) : null}
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Open in Google Maps"
          onPress={() => void Linking.openURL(mapsUrl)}>
          <ThemedText type="linkPrimary">Open in Google Maps</ThemedText>
        </Pressable>
      </View>

      {hasPlan ? (
        <View style={styles.planWrap}>
          <ThemedText type="smallBold">Location on the floor plan</ThemedText>
          <FloorPlan
            planImage={planImage}
            floor={hazard.floor ?? 0}
            pins={floorPins}
            selectedId={hazard.id}
            onPinPress={(pinHazard) => onSelect(pinHazard.id)}
            caption={floorLabel(hazard.floor)}
          />
        </View>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          No floor plan is available for this location. Use the coordinates above.
        </ThemedText>
      )}

      {actionError ? (
        <ThemedText type="small" style={styles.error} accessibilityRole="alert">
          {actionError}
        </ThemedText>
      ) : null}

      {confirmDelete ? (
        <View style={[styles.confirm, { borderColor: BU.red }]}>
          <ThemedText type="smallBold">Delete this hazard?</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            It disappears for everyone, including the map. The reports and photos stay in the
            database so it can be restored.
          </ThemedText>
          <View style={styles.actions}>
            <ActionButton label="Cancel" onPress={onCancelDelete} disabled={busy} />
            <ActionButton
              label={busy ? 'Deleting…' : 'Yes, delete'}
              onPress={onDelete}
              disabled={busy}
              tone="danger"
            />
          </View>
        </View>
      ) : (
        <View style={styles.actions}>
          {resolved ? (
            <ActionButton
              label={busy ? 'Reopening…' : 'Reopen'}
              onPress={onReopen}
              disabled={busy}
              tone="neutral"
            />
          ) : (
            <ActionButton
              label={busy ? 'Resolving…' : 'Mark resolved'}
              onPress={onResolve}
              disabled={busy}
              tone="primary"
            />
          )}
          <ActionButton label="Delete" onPress={onAskDelete} disabled={busy} tone="danger-outline" />
        </View>
      )}
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.factLabel}>
        {label}
      </ThemedText>
      <ThemedText type="small" style={styles.factValue}>
        {value}
      </ThemedText>
    </View>
  );
}

function ActionButton({
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
  const background = tone === 'primary' ? RESOLVED_GREEN : tone === 'danger' ? BU.red : 'transparent';
  const border = tone === 'danger-outline' ? BU.red : tone === 'neutral' ? theme.border : background;
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
        { backgroundColor: background, borderColor: border, opacity: disabled ? 0.55 : 1 },
      ]}>
      <ThemedText type="smallBold" style={{ color }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function HazardPhoto({ hazardId }: { hazardId: string }) {
  const [state, setState] = useState<{
    id: string;
    uri: string | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    let active = true;
    loadHazardPhoto(hazardId)
      .then((uri) => {
        if (active) setState({ id: hazardId, uri, error: null });
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setState({
          id: hazardId,
          uri: null,
          error: failureMessage(caught, 'The photo could not be loaded.'),
        });
      });
    return () => {
      active = false;
    };
  }, [hazardId]);

  const settled = state?.id === hazardId ? state : null;
  if (!settled) return <ActivityIndicator color={BU.red} />;
  if (settled.error) {
    return (
      <ThemedText type="small" style={styles.error} accessibilityRole="alert">
        {settled.error}
      </ThemedText>
    );
  }
  if (!settled.uri) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        No photo was submitted for this hazard.
      </ThemedText>
    );
  }
  return (
    <Image
      source={{ uri: settled.uri }}
      style={styles.photo}
      contentFit="cover"
      accessibilityLabel="Hazard photo"
    />
  );
}

/** Short relative age such as "5m ago" or "3d ago". */
function ago(timestamp: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  brand: { color: BU.red, fontSize: 28, lineHeight: 32, fontWeight: '800' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  headerButton: {
    borderWidth: 1,
    borderRadius: Spacing.five,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minWidth: 72,
    alignItems: 'center',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  chipGroup: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  chip: {
    borderWidth: 1,
    borderRadius: Spacing.five,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  error: { color: BU.red, paddingHorizontal: Spacing.four, paddingVertical: Spacing.two },
  body: { flex: 1 },
  bodyWide: { flexDirection: 'row' },
  listWide: { width: 420, flexGrow: 0 },
  listNarrow: { maxHeight: 280, flexGrow: 0 },
  listContent: { padding: Spacing.three, gap: Spacing.two },
  detailWide: { flex: 1 },
  detailNarrow: { flex: 1 },
  detailContent: { padding: Spacing.three },
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
  },
  rowBody: { flex: 1, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  severityBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  severityText: { color: '#fff' },
  badge: { borderRadius: Spacing.three, paddingHorizontal: Spacing.two, paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: 12, lineHeight: 16 },
  detail: { gap: Spacing.three, maxWidth: 760 },
  detailTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  detailTitle: { fontSize: 24, lineHeight: 30 },
  photo: { width: '100%', aspectRatio: 16 / 9, borderRadius: Spacing.three },
  facts: { borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.one },
  fact: { flexDirection: 'row', gap: Spacing.three },
  factLabel: { width: 96 },
  factValue: { flex: 1 },
  planWrap: { gap: Spacing.two },
  confirm: { borderWidth: 1, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  actions: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  action: {
    borderWidth: 1,
    borderRadius: Spacing.five,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
});
