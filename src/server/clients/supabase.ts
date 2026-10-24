// ⚠️ SERVER-ONLY MODULE — Supabase Edge Functions (Deno runtime) ONLY. ⚠️
//
// This module constructs a Supabase client with the SERVICE ROLE key (via
// `@/server/config/env`). The service role key bypasses Postgres Row Level
// Security, so it MUST NEVER be bundled into, imported by, or referenced from
// the Expo client app or any UI/client code under `src/app/` or
// `src/components/`. Import this ONLY from Edge Function / server code; nothing
// in the client bundle should transitively import `@/server/*`.
//
// NOTE: this file deals with Supabase only — the Gemini key never appears here.
//
// API SURFACE (verified against the current Supabase docs, not training data):
//   * createClient(supabaseUrl, supabaseKey, options) — @supabase/supabase-js v2
//     https://supabase.com/docs/reference/javascript/initializing
//   * table queries return `{ data, error }`; `.single()` yields one row
//     https://supabase.com/docs/reference/javascript/insert
//     https://supabase.com/docs/reference/javascript/select
//   * storage `.createSignedUrl(path, expiresIn)` returns
//     `{ data: { signedUrl }, error }`
//     https://supabase.com/docs/reference/javascript/storage-from-createsignedurl
//
// Every method returns the shared `Result<T, AppError>` envelope from `@/types`,
// mapping any Supabase error to `AppError{ code: 'db_error' }`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';

import type { EnvConfig } from '@/server/config/env';
import type {
    AppError,
    Coordinates,
    HazardInsert,
    HazardRow,
    ReportInsert,
    ReportRow,
    Result,
} from '@/types';
import { err, ok } from '@/types';

/** Default signed-URL lifetime (seconds). Short-lived by design. */
const SIGNED_URL_TTL_SECONDS = 60;

/**
 * Minimal structural shape of a Supabase error (`PostgrestError` /
 * `StorageError` both expose a `message`). Kept local so the wrapper does not
 * leak the vendor error type across the boundary.
 */
interface SupabaseErrorLike {
  readonly message: string;
  readonly code?: string;
  readonly details?: unknown;
}

/** Map any Supabase error object to the shared `AppError{ code: 'db_error' }`. */
function toDbError(error: SupabaseErrorLike, fallbackMessage: string): AppError {
  return {
    code: 'db_error',
    message: error.message || fallbackMessage,
    details: error,
  };
}

/**
 * The Supabase client surface this gateway actually uses. Declaring it lets the
 * gateway accept either a real `SupabaseClient` or a lightweight test double via
 * dependency injection — no network, no real secrets needed in unit tests.
 */
export type SupabaseClientLike = Pick<SupabaseClient, 'from' | 'rpc' | 'storage'>;

/**
 * Typed accessor over the Supabase JS client, parameterized by the hand-written
 * `database.ts` row types so queries are checked against the agreed schema.
 *
 * See design Component 3 "Supabase Client Wrapper".
 */
export interface SupabaseGateway {
  insertReport(row: ReportInsert): Promise<Result<ReportRow>>;
  insertHazard(row: HazardInsert): Promise<Result<HazardRow>>;
  hazardsInRadius(center: Coordinates, radiusMeters: number): Promise<Result<HazardRow[]>>;
  createSignedUrl(path: string): Promise<Result<string>>;
}

/**
 * Create a {@link SupabaseGateway} backed by the given Supabase client.
 *
 * Accepts the client by injection so callers (and tests) control construction.
 * Use {@link createSupabaseGateway} to build the production client from
 * {@link EnvConfig}.
 */
export function makeSupabaseGateway(client: SupabaseClientLike): SupabaseGateway {
  return {
    async insertReport(row: ReportInsert): Promise<Result<ReportRow>> {
      const { data, error } = await client
        .from('reports')
        .insert(row)
        .select()
        .single();
      if (error) {
        return err(toDbError(error, 'Failed to insert report'));
      }
      return ok(data as ReportRow);
    },

    async insertHazard(row: HazardInsert): Promise<Result<HazardRow>> {
      const { data, error } = await client
        .from('hazards')
        .insert(row)
        .select()
        .single();
      if (error) {
        return err(toDbError(error, 'Failed to insert hazard'));
      }
      return ok(data as HazardRow);
    },

    // PostGIS radius search is a DB-side concern. The DB teammate OWNS the SQL
    // function `hazards_in_radius(lat, lng, radius_m)` (an ST_DWithin-based
    // PostGIS query); this wrapper only calls it as the agreed RPC interface and
    // maps the typed result. The exact SQL is deliberately NOT reinvented here —
    // the boundary with the DB teammate IS this RPC contract.
    async hazardsInRadius(
      center: Coordinates,
      radiusMeters: number,
    ): Promise<Result<HazardRow[]>> {
      const { data, error } = await client.rpc('hazards_in_radius', {
        lat: center.latitude,
        lng: center.longitude,
        radius_m: radiusMeters,
      });
      if (error) {
        return err(toDbError(error, 'Failed to query hazards in radius'));
      }
      return ok((data ?? []) as HazardRow[]);
    },

    async createSignedUrl(path: string): Promise<Result<string>> {
      const { data, error } = await client.storage
        .from('hazard-images')
        .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
      if (error) {
        return err(toDbError(error, 'Failed to create signed URL'));
      }
      if (!data?.signedUrl) {
        return err({
          code: 'db_error',
          message: 'Signed URL was not returned by Supabase Storage',
        });
      }
      return ok(data.signedUrl);
    },
  };
}

/**
 * Build a production {@link SupabaseGateway} from validated server env.
 *
 * Uses the service role key (server-only) and disables session persistence /
 * auto-refresh, which are browser concerns and have no place in an Edge
 * Function.
 */
export function createSupabaseGateway(env: EnvConfig): SupabaseGateway {
  const client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return makeSupabaseGateway(client);
}
