import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

import type { Hazard } from '@/constants/hazards';
import { severityColor, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { hazardMeta, hazardTitle } from './notifications-sheet';
import { ThemedText } from './themed-text';

/** How long one toast stays on screen before sliding away. */
const VISIBLE_MS = 6_000;

type HazardAlertToastProps = {
  /** Unacknowledged high-severity hazards. Each one toasts at most once. */
  alerts: Hazard[];
  /** Tapping the toast body. */
  onPress?: (hazard: Hazard) => void;
};

/**
 * Transient banner that announces a newly reported high-severity hazard, so
 * the reader is told without having to open the bell. Each hazard is shown at
 * most once; the bell badge is what persists until acknowledged.
 *
 * Overlays the screen from the top and lets touches through around itself, so
 * the map underneath stays usable.
 */
export function HazardAlertToast({ alerts, onPress }: HazardAlertToastProps) {
  const theme = useTheme();
  const [queue, setQueue] = useState<Hazard[]>([]);
  // Ids already announced, so a hazard that stays unacknowledged (and so stays
  // in `alerts`) does not toast again on every poll.
  const announced = useRef<Set<string>>(new Set());
  // Held in state rather than a ref: the value is read during render (it feeds
  // the animated style), and it is created once and never replaced.
  const [slide] = useState(() => new Animated.Value(0));

  // Queue anything that has not been announced yet, newest first.
  useEffect(() => {
    const fresh = alerts.filter((h) => !announced.current.has(h.id));
    if (fresh.length === 0) return;
    for (const h of fresh) announced.current.add(h.id);
    setQueue((prev) => [...prev, ...fresh]);
  }, [alerts]);

  const current = queue[0] ?? null;

  const dismiss = useCallback(() => {
    Animated.timing(slide, {
      toValue: 0,
      duration: 160,
      useNativeDriver: false,
    }).start(() => {
      setQueue((prev) => prev.slice(1));
    });
  }, [slide]);

  // Slide the current toast in, then auto-dismiss it.
  useEffect(() => {
    if (!current) return;
    slide.setValue(0);
    Animated.timing(slide, {
      toValue: 1,
      duration: 220,
      useNativeDriver: false,
    }).start();
    const timer = setTimeout(dismiss, VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [current, slide, dismiss]);

  if (!current) return null;

  const remaining = queue.length - 1;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Animated.View
        style={[
          styles.toast,
          {
            backgroundColor: theme.background,
            borderColor: severityColor(current.severity),
            opacity: slide,
            transform: [
              { translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) },
            ],
          },
        ]}>
        <Pressable
          style={styles.body}
          accessibilityRole="button"
          accessibilityLabel={`New high-severity hazard: ${hazardTitle(current)}. ${hazardMeta(
            current,
          )}. Open it.`}
          onPress={() => onPress?.(current)}>
          <View style={[styles.dot, { backgroundColor: severityColor(current.severity) }]} />
          <View style={styles.text}>
            <ThemedText type="smallBold">
              New high-severity hazard{remaining > 0 ? ` (+${remaining} more)` : ''}
            </ThemedText>
            <ThemedText type="small" numberOfLines={1}>
              {hazardTitle(current)}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {hazardMeta(current)}
            </ThemedText>
          </View>
        </Pressable>
        <Pressable
          onPress={dismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss alert"
          style={styles.close}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            ✕
          </ThemedText>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: Spacing.two,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    zIndex: 50,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    width: '100%',
    maxWidth: 520,
    borderWidth: 2,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.two,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  body: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  dot: { width: 12, height: 12, borderRadius: 6, marginTop: 4 },
  text: { flex: 1, gap: 2 },
  close: { paddingHorizontal: Spacing.one, paddingVertical: Spacing.half },
});
