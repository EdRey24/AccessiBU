import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { BU, Spacing } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/services/api';
import { passwordError } from '@/services/credentials';

function recoveryToken(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  const token = new URLSearchParams(hash).get('access_token');
  return token && token.length > 0 ? token : null;
}

export default function ResetPasswordScreen() {
  const theme = useTheme();
  const { resetPassword } = useSession();
  const [token] = useState(recoveryToken);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    const passwordProblem = passwordError(password);
    if (passwordProblem) {
      setError(passwordProblem);
      return;
    }
    if (!token) {
      setError('This reset link is missing its token. Open the link from the email again.');
      return;
    }
    setBusy(true);
    try {
      await resetPassword(token, password);
      router.replace('/sign-in');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
      <View style={styles.card}>
        <ThemedText type="subtitle" style={styles.brand}>
          AccessiBU
        </ThemedText>
        <ThemedText type="default" style={styles.heading}>
          Choose a new password
        </ThemedText>
        {token ? (
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            placeholder="New password"
            placeholderTextColor={theme.textSecondary}
            textContentType="newPassword"
            accessibilityLabel="New password"
            style={[
              styles.input,
              { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement },
            ]}
          />
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            Open the reset link from your email in this browser. The link carries the token this page needs.
          </ThemedText>
        )}
        {error ? (
          <ThemedText type="small" style={styles.error} accessibilityRole="alert">
            {error}
          </ThemedText>
        ) : null}
        {token ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save password"
            disabled={busy}
            onPress={() => {
              void submit();
            }}
            style={[styles.button, busy && styles.buttonBusy]}>
            {busy ? (
              <ActivityIndicator color={BU.white} />
            ) : (
              <ThemedText type="smallBold" style={styles.buttonText}>
                Save password
              </ThemedText>
            )}
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" onPress={() => router.replace('/sign-in')}>
          <ThemedText type="small" style={styles.link}>
            Back to sign in
          </ThemedText>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: Spacing.four },
  card: { width: '100%', maxWidth: 420, alignSelf: 'center', gap: Spacing.two },
  brand: { color: BU.red, fontSize: 32, lineHeight: 38, fontWeight: '800' },
  heading: { marginTop: Spacing.three, marginBottom: Spacing.two },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    fontSize: 16,
  },
  error: { color: BU.red },
  button: {
    marginTop: Spacing.two,
    backgroundColor: BU.red,
    borderRadius: Spacing.five,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonBusy: { opacity: 0.7 },
  buttonText: { color: BU.white },
  link: { color: BU.red, textDecorationLine: 'underline', marginTop: Spacing.two },
});
