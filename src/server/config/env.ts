// ⚠️ SERVER-ONLY MODULE — Supabase Edge Functions (Deno runtime) ONLY. ⚠️
//
// This module reads SUPABASE_SERVICE_ROLE_KEY and GEMINI_API_KEY. Both bypass
// security boundaries (the service role key bypasses Postgres Row Level
// Security; the Gemini key is a billable third-party credential), so they MUST
// NEVER be bundled into, imported by, or referenced from the Expo client app
// or any UI/client code under `src/app/` or `src/components/`.
//
// Import this ONLY from Edge Function / server code. Nothing under the client
// bundle should transitively import `@/server/*`.
//
// RUNTIME NOTE (verified against the current Supabase docs —
// https://supabase.com/docs/guides/functions/secrets):
//   * Edge Functions read env vars with `Deno.env.get("NAME")`.
//   * `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into Edge
//     Functions by default (the service_role key bypasses RLS — Edge Functions
//     only, never a browser).
//   * Custom secrets such as `GEMINI_API_KEY` are provided via
//     `supabase secrets set` (or `supabase/functions/.env` locally) and read at
//     runtime with `Deno.env.get`. (Custom secret names may not start with the
//     reserved `SUPABASE_` prefix.)
//
// `loadEnv` is intentionally runtime-agnostic: it accepts a plain record (e.g.
// the result of `Deno.env.toObject()`), so it is unit-testable without a Deno
// runtime and fails fast at startup on any missing/malformed value.

import { z } from 'zod';

/** Validated, typed server environment. Frozen; never carries client secrets. */
export interface EnvConfig {
  readonly supabaseUrl: string;
  readonly supabaseServiceRoleKey: string; // server-only (bypasses RLS)
  readonly geminiApiKey: string; // SERVER-ONLY, never bundled into the Expo app
}

/**
 * Schema for the raw server environment. Fails fast on missing / empty /
 * malformed values:
 *   * SUPABASE_URL must be a non-empty, valid URL.
 *   * SUPABASE_SERVICE_ROLE_KEY and GEMINI_API_KEY must be non-empty strings.
 */
const envSchema = z.object({
  SUPABASE_URL: z.string().min(1, 'SUPABASE_URL is required').url('SUPABASE_URL must be a valid URL'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),
});

/**
 * Parse and validate the server environment, returning a typed, frozen config.
 *
 * @param raw The raw environment record (e.g. `Deno.env.toObject()`).
 * @returns A frozen {@link EnvConfig}.
 * @throws {z.ZodError} if any variable is missing, empty, or malformed — the
 *   intent is to fail fast at Edge Function startup rather than surface a
 *   partially-configured runtime later.
 */
export function loadEnv(raw: Record<string, string | undefined>): EnvConfig {
  const parsed = envSchema.parse(raw);
  return Object.freeze({
    supabaseUrl: parsed.SUPABASE_URL,
    supabaseServiceRoleKey: parsed.SUPABASE_SERVICE_ROLE_KEY,
    geminiApiKey: parsed.GEMINI_API_KEY,
  });
}
