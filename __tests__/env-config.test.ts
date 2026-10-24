/**
 * Unit tests for the server-only env config (`src/server/config/env.ts`).
 *
 * `loadEnv` parses SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and GEMINI_API_KEY
 * via a zod schema and fails fast on anything missing, empty, or malformed.
 *
 * SECURITY: SUPABASE_SERVICE_ROLE_KEY and GEMINI_API_KEY are SERVER-ONLY and
 * must never be bundled into the Expo client (Requirement 8.6). All values here
 * are obviously-fake test placeholders — no real secrets.
 *
 * Validates: Requirements 8.6, 8.7
 */

import { loadEnv } from '@/server/config/env';

/** A complete, obviously-fake environment. Not a real credential anywhere. */
const completeEnv = {
  SUPABASE_URL: 'https://fake-project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key-not-real',
  GEMINI_API_KEY: 'fake-gemini-api-key-not-real',
} as const;

describe('loadEnv', () => {
  test('parses a complete env into a typed config', () => {
    const config = loadEnv({ ...completeEnv });
    expect(config.supabaseUrl).toBe(completeEnv.SUPABASE_URL);
    expect(config.supabaseServiceRoleKey).toBe(completeEnv.SUPABASE_SERVICE_ROLE_KEY);
    expect(config.geminiApiKey).toBe(completeEnv.GEMINI_API_KEY);
  });

  test('returns a frozen config object', () => {
    const config = loadEnv({ ...completeEnv });
    expect(Object.isFrozen(config)).toBe(true);
  });

  test('throws when a required variable is missing', () => {
    const { GEMINI_API_KEY: _omitted, ...withoutGemini } = completeEnv;
    expect(() => loadEnv(withoutGemini)).toThrow();
  });

  test('throws when a required variable is an empty string', () => {
    expect(() => loadEnv({ ...completeEnv, SUPABASE_SERVICE_ROLE_KEY: '' })).toThrow();
  });

  test('throws when SUPABASE_URL is malformed', () => {
    expect(() => loadEnv({ ...completeEnv, SUPABASE_URL: 'not-a-url' })).toThrow();
  });
});
