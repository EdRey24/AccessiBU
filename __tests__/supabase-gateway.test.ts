/**
 * Unit tests for the server-only typed Supabase client wrapper
 * (`src/server/clients/supabase.ts`).
 *
 * These tests inject a lightweight fake Supabase client (no network, no real
 * secrets) and assert that the gateway maps success/failure onto the shared
 * `Result<T, AppError>` envelope from `@/types`:
 *   - a successful insert returns `ok` with the returned row
 *   - a Supabase error maps to `err` with `code: 'db_error'`
 *   - createSignedUrl unwraps `{ signedUrl }` into `ok(string)`
 *
 * SECURITY: all values are obviously-fake placeholders — no real credentials.
 *
 * Validates: Requirements 8.7
 */

import type { HazardRow, ReportRow } from '@/types';
import {
  makeSupabaseGateway,
  type SupabaseClientLike,
} from '@/server/clients/supabase';

type QueryResult = { data: unknown; error: unknown };

/** Build a fake table query builder whose terminal call resolves to `result`. */
function fakeTable(result: QueryResult) {
  const builder = {
    insert: () => builder,
    select: () => builder,
    // `.single()` is the terminal awaited call in the wrapper.
    single: () => Promise.resolve(result),
  };
  return builder;
}

/** A fake Supabase client covering only the surface the gateway uses. */
function fakeClient(overrides: {
  table?: QueryResult;
  rpc?: QueryResult;
  signedUrl?: QueryResult;
}): SupabaseClientLike {
  return {
    from: (() => fakeTable(overrides.table ?? { data: null, error: null })) as unknown as SupabaseClientLike['from'],
    rpc: (() => Promise.resolve(overrides.rpc ?? { data: [], error: null })) as unknown as SupabaseClientLike['rpc'],
    storage: {
      from: () => ({
        createSignedUrl: () =>
          Promise.resolve(overrides.signedUrl ?? { data: null, error: null }),
      }),
    } as unknown as SupabaseClientLike['storage'],
  };
}

const fakeReportInsert = {
  reporter_id: null,
  image_path: 'reports/fake.png',
  reporter_hints: null,
  latitude: 42.35,
  longitude: -71.1,
  status: 'submitted',
} as const;

const fakeReportRow: ReportRow = {
  id: 'report-fake-1',
  hazard_id: null,
  reporter_id: null,
  image_path: 'reports/fake.png',
  reporter_hints: null,
  latitude: 42.35,
  longitude: -71.1,
  status: 'submitted',
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
};

const fakeHazardRow: HazardRow = {
  id: 'hazard-fake-1',
  category: 'spill',
  other_description: null,
  severity_label: 'high',
  severity_score: 72,
  status: 'ai_classified',
  latitude: 42.35,
  longitude: -71.1,
  building_id: null,
  floor_id: null,
  confirmation_count: 0,
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
};

describe('SupabaseGateway.insertReport', () => {
  test('returns ok with the inserted row on success', async () => {
    const gateway = makeSupabaseGateway(
      fakeClient({ table: { data: fakeReportRow, error: null } }),
    );
    const result = await gateway.insertReport({ ...fakeReportInsert });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(fakeReportRow);
    }
  });

  test("maps a Supabase error to err with code 'db_error'", async () => {
    const gateway = makeSupabaseGateway(
      fakeClient({ table: { data: null, error: { message: 'insert failed' } } }),
    );
    const result = await gateway.insertReport({ ...fakeReportInsert });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('db_error');
      expect(result.error.message).toBe('insert failed');
    }
  });
});

describe('SupabaseGateway.insertHazard', () => {
  test('returns ok with the inserted hazard row on success', async () => {
    const gateway = makeSupabaseGateway(
      fakeClient({ table: { data: fakeHazardRow, error: null } }),
    );
    const result = await gateway.insertHazard({
      category: 'spill',
      other_description: null,
      severity_label: 'high',
      severity_score: 72,
      status: 'ai_classified',
      latitude: 42.35,
      longitude: -71.1,
      building_id: null,
      floor_id: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(fakeHazardRow);
    }
  });

  test("maps a Supabase error to err with code 'db_error'", async () => {
    const gateway = makeSupabaseGateway(
      fakeClient({ table: { data: null, error: { message: 'constraint violation' } } }),
    );
    const result = await gateway.insertHazard({
      category: 'spill',
      other_description: null,
      severity_label: 'high',
      severity_score: 72,
      status: 'ai_classified',
      latitude: 42.35,
      longitude: -71.1,
      building_id: null,
      floor_id: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('db_error');
    }
  });
});

describe('SupabaseGateway.hazardsInRadius', () => {
  test('returns ok with the hazard rows from the RPC on success', async () => {
    const gateway = makeSupabaseGateway(
      fakeClient({ rpc: { data: [fakeHazardRow], error: null } }),
    );
    const result = await gateway.hazardsInRadius({ latitude: 42.35, longitude: -71.1 }, 100);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([fakeHazardRow]);
    }
  });

  test("maps a Supabase error to err with code 'db_error'", async () => {
    const gateway = makeSupabaseGateway(
      fakeClient({ rpc: { data: null, error: { message: 'rpc missing' } } }),
    );
    const result = await gateway.hazardsInRadius({ latitude: 42.35, longitude: -71.1 }, 100);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('db_error');
    }
  });
});

describe('SupabaseGateway.createSignedUrl', () => {
  test('unwraps { signedUrl } into ok(string) on success', async () => {
    const gateway = makeSupabaseGateway(
      fakeClient({
        signedUrl: { data: { signedUrl: 'https://fake.supabase.co/signed/abc' }, error: null },
      }),
    );
    const result = await gateway.createSignedUrl('hazards/fake.png');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe('https://fake.supabase.co/signed/abc');
    }
  });

  test("maps a storage error to err with code 'db_error'", async () => {
    const gateway = makeSupabaseGateway(
      fakeClient({ signedUrl: { data: null, error: { message: 'object not found' } } }),
    );
    const result = await gateway.createSignedUrl('hazards/missing.png');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('db_error');
    }
  });

  test("errs when no signedUrl is returned", async () => {
    const gateway = makeSupabaseGateway(
      fakeClient({ signedUrl: { data: {}, error: null } }),
    );
    const result = await gateway.createSignedUrl('hazards/fake.png');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('db_error');
    }
  });
});
