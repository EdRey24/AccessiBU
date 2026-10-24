import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { BU, Spacing } from '@/constants/theme';
import { useSession } from '@/hooks/use-session';
import { useTheme } from '@/hooks/use-theme';
import { ApiError } from '@/services/api';
import { emailError, normalizeEmail, passwordError } from '@/services/credentials';

type Mode = 'sign-in' | 'create' | 'forgot';

export default function SignInScreen() {
  const theme = useTheme();
  const { signIn, register, forgotPassword } = useSession();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  async function submit() {
    setError(null);
    setNotice(null);
    const address = normalizeEmail(email);
    const addressProblem = emailError(address);
    if (addressProblem) {
      setError(addressProblem);
      return;
    }
    if (mode !== 'forgot') {
      const passwordProblem = passwordError(password);
      if (passwordProblem) {
        setError(passwordProblem);
        return;
      }
    }

    setBusy(true);
    try {
      if (mode === 'forgot') {
        setNotice(await forgotPassword(address));
      } else if (mode === 'create') {
        await register(address, password);
      } else {
        await signIn(address, password);
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const title = mode === 'create' ? 'Create account' : mode === 'forgot' ? 'Reset password' : 'Sign in';
  const action = mode === 'create' ? 'Create account' : mode === 'forgot' ? 'Send reset mail' : 'Sign in';

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.center}>
        <View style={styles.card}>
          <ThemedText type="subtitle" style={styles.brand}>
            AccessiBU
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Boston University
          </ThemedText>
          <ThemedText type="default" style={styles.heading}>
            {title}
          </ThemedText>

          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="you@bu.edu"
            placeholderTextColor={theme.textSecondary}
            textContentType="username"
            accessibilityLabel="Email"
            style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
          />

          {mode !== 'forgot' ? (
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete={mode === 'create' ? 'new-password' : 'password'}
              placeholder="Password"
              placeholderTextColor={theme.textSecondary}
              textContentType={mode === 'create' ? 'newPassword' : 'password'}
              accessibilityLabel="Password"
              style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.backgroundElement }]}
            />
          ) : null}

          {error ? (
            <ThemedText type="small" style={styles.error} accessibilityRole="alert">
              {error}
            </ThemedText>
          ) : null}
          {notice ? (
            <ThemedText type="small" style={styles.notice} accessibilityRole="alert">
              {notice}
            </ThemedText>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action}
            disabled={busy}
            onPress={() => {
              void submit();
            }}
            style={[styles.button, busy && styles.buttonBusy]}>
            {busy ? (
              <ActivityIndicator color={BU.white} />
            ) : (
              <ThemedText type="smallBold" style={styles.buttonText}>
                {action}
              </ThemedText>
            )}
          </Pressable>

          {mode === 'sign-in' ? (
            <View style={styles.links}>
              <Pressable accessibilityRole="button" onPress={() => switchMode('create')}>
                <ThemedText type="small" style={styles.link}>
                  Create an account
                </ThemedText>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => switchMode('forgot')}>
                <ThemedText type="small" style={styles.link}>
                  Forgot password?
                </ThemedText>
              </Pressable>
            </View>
          ) : (
            <Pressable accessibilityRole="button" onPress={() => switchMode('sign-in')}>
              <ThemedText type="small" style={styles.link}>
                Back to sign in
              </ThemedText>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', padding: Spacing.four },
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
  notice: { color: BU.redDark },
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
  links: { gap: Spacing.two, marginTop: Spacing.two },
  link: { color: BU.red, textDecorationLine: 'underline' },
});
