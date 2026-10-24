import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import {
    CDS_FLOORS,
    FLOOR_PLAN_SIZE,
    floorLabel,
    floorPlanImage,
    type FeatureKind,
    type FloorFeature,
} from '@/constants/hazards';
import { BU, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const KINDS: { kind: FeatureKind; label: string; icon: string }[] = [
  { kind: 'elevator', label: 'Elevator', icon: '🛗' },
  { kind: 'stair', label: 'Stair', icon: '🪜' },
  { kind: 'exit', label: 'Exit', icon: '🚪' },
];

type Placed = FloorFeature & { id: string };

/**
 * DEV TOOL — digitize per-floor accessibility features.
 * Pick a floor, pick a feature kind, tap the plan to drop points, then Copy
 * JSON and paste into src/constants/floor-features.ts (FLOOR_FEATURES[floor]).
 */
export default function FeatureCaptureTool() {
  const theme = useTheme();
  const router = useRouter();
  const [floor, setFloor] = useState(12);
  const [kind, setKind] = useState<FeatureKind>('elevator');
  const [byFloor, setByFloor] = useState<Record<number, Placed[]>>({});
  const wrapRef = useRef<any>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const placed = byFloor[floor] ?? [];

  const measure = useCallback(() => {
    if (Platform.OS !== 'web') return;
    const el = wrapRef.current as HTMLElement | null;
    if (el) setSize({ w: el.clientWidth, h: el.clientHeight });
  }, []);

  useEffect(() => {
    measure();
    if (Platform.OS === 'web') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
  }, [measure]);

  const addAt = (nx: number, ny: number) => {
    const count = placed.filter((p) => p.kind === kind).length + 1;
    const label =
      kind === 'elevator' ? 'Elevator bank' : kind === 'stair' ? `Stair ${count}` : `Exit ${count}`;
    const feature: Placed = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind,
      label,
      x: Number(nx.toFixed(4)),
      y: Number(ny.toFixed(4)),
    };
    setByFloor((prev) => ({ ...prev, [floor]: [...(prev[floor] ?? []), feature] }));
  };

  const handleWebPointer = (e: any) => {
    const el = wrapRef.current as HTMLElement | null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    addAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  };

  const removeFeature = (id: string) => {
    setByFloor((prev) => ({
      ...prev,
      [floor]: (prev[floor] ?? []).filter((p) => p.id !== id),
    }));
  };

  const clearFloor = () => setByFloor((prev) => ({ ...prev, [floor]: [] }));

  // Build the JSON for every floor that has captures.
  const buildJson = () => {
    const out: Record<number, { kind: FeatureKind; label: string; x: number; y: number }[]> = {};
    Object.entries(byFloor).forEach(([f, items]) => {
      if (items.length) {
        out[Number(f)] = items.map(({ kind, label, x, y }) => ({ kind, label, x, y }));
      }
    });
    return JSON.stringify(out, null, 2);
  };

  const copyJson = () => {
    const json = buildJson();
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(json);
    }
    // Always log so it's grabbable from the terminal/console too.
    console.log('FLOOR_FEATURES =\n' + json);
  };

  const planImage = floorPlanImage(floor);
  const px = (f: Placed) => ({ left: f.x * size.w - 11, top: f.y * size.h - 11 });

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Back">
          <ThemedText type="smallBold">‹ Back</ThemedText>
        </Pressable>
        <ThemedText type="smallBold">Feature capture · {floorLabel(floor)}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {placed.length} pts
        </ThemedText>
      </View>

      {/* Floor selector */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.floorBar}>
        {CDS_FLOORS.map((f) => (
          <Pressable
            key={f.value}
            onPress={() => setFloor(f.value)}
            style={[
              styles.floorChip,
              { borderColor: theme.border },
              f.value === floor && { backgroundColor: theme.text },
            ]}>
            <ThemedText
              type="small"
              style={{ color: f.value === floor ? theme.background : theme.textSecondary }}>
              {f.value === 0 ? 'G' : f.value === -1 ? 'B' : f.value}
            </ThemedText>
          </Pressable>
        ))}
      </ScrollView>

      {/* Kind selector */}
      <View style={styles.kindRow}>
        {KINDS.map((k) => (
          <Pressable
            key={k.kind}
            onPress={() => setKind(k.kind)}
            style={[
              styles.kindBtn,
              { borderColor: kind === k.kind ? BU.red : theme.border },
              kind === k.kind && { backgroundColor: BU.red },
            ]}>
            <ThemedText
              type="smallBold"
              style={{ color: kind === k.kind ? '#fff' : theme.text }}>
              {k.icon} {k.label}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      {/* Plan */}
      <View style={styles.planWrap}>
        <View
          style={[
            styles.plan,
            { aspectRatio: FLOOR_PLAN_SIZE.width / FLOOR_PLAN_SIZE.height, borderColor: theme.border },
          ]}>
          {Platform.OS === 'web' ? (
            <div
              ref={wrapRef}
              onClick={handleWebPointer}
              style={{ position: 'absolute', inset: 0, cursor: 'crosshair' }}>
              {planImage ? (
                <Image source={planImage} style={StyleSheet.absoluteFill} contentFit="fill" />
              ) : null}
              {size.w > 0 &&
                placed.map((f) => (
                  <View key={f.id} style={[styles.dot, px(f)]} pointerEvents="none">
                    <ThemedText type="small" style={styles.dotIcon}>
                      {f.kind === 'elevator' ? '🛗' : f.kind === 'stair' ? '🪜' : '🚪'}
                    </ThemedText>
                  </View>
                ))}
            </div>
          ) : (
            <Pressable
              onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
              onPress={(e) =>
                size.w > 0 &&
                addAt(e.nativeEvent.locationX / size.w, e.nativeEvent.locationY / size.h)
              }
              style={StyleSheet.absoluteFill}>
              {planImage ? (
                <Image source={planImage} style={StyleSheet.absoluteFill} contentFit="fill" />
              ) : null}
              {size.w > 0 &&
                placed.map((f) => (
                  <View key={f.id} style={[styles.dot, px(f)]} pointerEvents="none">
                    <ThemedText type="small" style={styles.dotIcon}>
                      {f.kind === 'elevator' ? '🛗' : f.kind === 'stair' ? '🪜' : '🚪'}
                    </ThemedText>
                  </View>
                ))}
            </Pressable>
          )}
        </View>
      </View>

      {/* Placed list */}
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {placed.map((f) => (
          <View key={f.id} style={[styles.listRow, { borderColor: theme.border }]}>
            <ThemedText type="small">
              {f.kind === 'elevator' ? '🛗' : f.kind === 'stair' ? '🪜' : '🚪'} {f.label} ·{' '}
              {f.x.toFixed(3)}, {f.y.toFixed(3)}
            </ThemedText>
            <Pressable onPress={() => removeFeature(f.id)} accessibilityLabel="Remove">
              <ThemedText type="small" style={{ color: BU.red }}>
                remove
              </ThemedText>
            </Pressable>
          </View>
        ))}
        {placed.length === 0 && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
            Tap the plan to drop {kind} points.
          </ThemedText>
        )}
      </ScrollView>

      {/* Actions */}
      <View style={styles.actions}>
        <Pressable onPress={clearFloor} style={[styles.actionBtn, { borderColor: theme.border }]}>
          <ThemedText type="smallBold">Clear floor</ThemedText>
        </Pressable>
        <Pressable onPress={copyJson} style={[styles.actionBtn, styles.copyBtn]}>
          <ThemedText type="smallBold" style={{ color: '#fff' }}>
            Copy JSON (all floors)
          </ThemedText>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  floorBar: { flexGrow: 0, paddingHorizontal: Spacing.three },
  floorChip: {
    minWidth: 36,
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    marginRight: Spacing.two,
  },
  kindRow: { flexDirection: 'row', gap: Spacing.two, paddingHorizontal: Spacing.four, paddingVertical: Spacing.three },
  kindBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  planWrap: { paddingHorizontal: Spacing.four },
  plan: { width: '100%', borderWidth: 1, borderRadius: Spacing.three, overflow: 'hidden', backgroundColor: '#fff' },
  dot: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(204,0,0,0.85)',
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotIcon: { fontSize: 11 },
  list: { flex: 1, marginTop: Spacing.three },
  listContent: { paddingHorizontal: Spacing.four, gap: Spacing.two, paddingBottom: Spacing.three },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  hint: { textAlign: 'center', paddingVertical: Spacing.three },
  actions: { flexDirection: 'row', gap: Spacing.three, padding: Spacing.four },
  actionBtn: { flex: 1, borderWidth: 1, borderRadius: Spacing.five, paddingVertical: Spacing.three, alignItems: 'center' },
  copyBtn: { backgroundColor: BU.red, borderColor: BU.red },
});
