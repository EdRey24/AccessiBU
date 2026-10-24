import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const REFRESH_TOKEN_KEY = 'accessibu.refreshToken';

/** Saves the refresh token. Phones use the keychain; web uses localStorage. */
export async function writeRefreshToken(token: string): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.setItem(REFRESH_TOKEN_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token);
}

/** Reads the saved refresh token, or null when there is none. */
export async function readRefreshToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  }
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
}

/** Forgets the saved refresh token. */
export async function clearRefreshToken(): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}
