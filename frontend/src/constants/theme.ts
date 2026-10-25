/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://unistyl.es/), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#1A1A1A',
    background: '#ffffff',
    backgroundElement: '#F2F3F5',
    backgroundSelected: '#E4E6EA',
    textSecondary: '#5B6066',
    border: '#D9DCE1',
  },
  dark: {
    text: '#F5F5F5',
    background: '#121212',
    backgroundElement: '#1E1F22',
    backgroundSelected: '#2A2C30',
    textSecondary: '#A8ADB4',
    border: '#333639',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * Boston University brand palette. Used for AccessiBU branding and hazard
 * severity accents. These are intentionally theme-independent.
 */
export const BU = {
  red: '#CC0000',
  redDark: '#A30000',
  white: '#FFFFFF',
  darkGray: '#2B2B2B',
  lightGray: '#6E6E6E',
} as const;

/** Severity color scale (1-10) for hazard bubbles and badges. */
export function severityColor(severity: number): string {
  if (severity >= 8) return '#CC0000'; // critical - BU red
  if (severity >= 5) return '#E8820C'; // moderate - orange
  if (severity >= 3) return '#E0B000'; // minor - amber
  return '#3B9E4F'; // low - green
}

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
