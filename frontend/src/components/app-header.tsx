import { useState } from 'react';
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BU, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ThemedText } from './themed-text';

/** Below this width the actions move into a menu so the header never overflows. */
const COMPACT_WIDTH = 640;

type AppHeaderProps = {
  /** Number of active hazards. */
  activeCount: number;
  /** Shows the Facilities dashboard action. */
  isAdmin: boolean;
  onMyReports: () => void;
  onFacilities: () => void;
  onSignOut: () => void;
};

/**
 * Top bar. On a wide screen the actions sit inline. On a phone they collapse
 * into a menu button, so nothing is squeezed, cut off, or pushed off screen.
 */
export function AppHeader({
  activeCount,
  isAdmin,
  onMyReports,
  onFacilities,
  onSignOut,
}: AppHeaderProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const compact = width < COMPACT_WIDTH;
  const [menuOpen, setMenuOpen] = useState(false);

  const choose = (action: () => void) => () => {
    setMenuOpen(false);
    action();
  };

  return (
    <View style={[styles.header, compact && styles.headerCompact]}>
      <View style={styles.brandBlock}>
        <ThemedText
          type="subtitle"
          numberOfLines={1}
          style={[styles.brand, compact && styles.brandCompact]}>
          AccessiBU
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          Boston University
        </ThemedText>
      </View>

      <View style={styles.actions}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.count}>
          {activeCount} active
        </ThemedText>

        {compact ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open menu"
            accessibilityState={{ expanded: menuOpen }}
            onPress={() => setMenuOpen(true)}
            style={[styles.button, styles.menuButton, { borderColor: theme.border }]}>
            <ThemedText type="smallBold">☰ Menu</ThemedText>
          </Pressable>
        ) : (
          <>
            {isAdmin ? (
              <HeaderButton label="Facilities" onPress={onFacilities} accent />
            ) : null}
            <HeaderButton label="My reports" onPress={onMyReports} />
            <HeaderButton label="Sign out" onPress={onSignOut} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Nearby alerts"
              style={[styles.button, { borderColor: theme.border }]}>
              <ThemedText type="small">🔔</ThemedText>
            </Pressable>
          </>
        )}
      </View>

      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}>
        <Pressable
          accessibilityLabel="Close menu"
          style={styles.backdrop}
          onPress={() => setMenuOpen(false)}>
          <View
            style={[
              styles.menu,
              {
                backgroundColor: theme.background,
                borderColor: theme.border,
                marginTop: insets.top + Spacing.five,
              },
            ]}>
            {isAdmin ? (
              <MenuItem label="Facilities dashboard" onPress={choose(onFacilities)} accent />
            ) : null}
            <MenuItem label="My reports" onPress={choose(onMyReports)} />
            <MenuItem label="Sign out" onPress={choose(onSignOut)} />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function HeaderButton({
  label,
  onPress,
  accent = false,
}: {
  label: string;
  onPress: () => void;
  accent?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.button, { borderColor: accent ? BU.red : theme.border }]}>
      <ThemedText type="small" style={accent ? { color: BU.red } : undefined}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function MenuItem({
  label,
  onPress,
  accent = false,
}: {
  label: string;
  onPress: () => void;
  accent?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.menuItem}>
      <ThemedText type="default" style={accent ? { color: BU.red } : undefined}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three,
  },
  headerCompact: { paddingHorizontal: Spacing.three, gap: Spacing.two },
  // minWidth 0 lets the brand shrink instead of pushing the actions off screen.
  brandBlock: { flexShrink: 1, minWidth: 0 },
  brand: { color: BU.red, fontSize: 28, lineHeight: 32, fontWeight: '800' },
  brandCompact: { fontSize: 24, lineHeight: 28 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexShrink: 0 },
  count: { flexShrink: 0 },
  button: {
    borderWidth: 1,
    borderRadius: Spacing.five,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 40,
    justifyContent: 'center',
  },
  menuButton: { minHeight: 44, minWidth: 44 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'flex-end' },
  menu: {
    marginRight: Spacing.three,
    minWidth: 220,
    maxWidth: '90%',
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.one,
    overflow: 'hidden',
  },
  menuItem: { minHeight: 48, justifyContent: 'center', paddingHorizontal: Spacing.four },
});
