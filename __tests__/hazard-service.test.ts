/**
 * Unit tests for the server-only hazard domain service
 * (`src/server/services/hazard-service.ts`).
 *
 * These tests inject fake SupabaseGateway + AiService collaborators (no
 * network, no real secrets) and assert the submit-report orchestration and the
 * get-hazards query/mapping:
 *   - submitReport happy path: inserts report, signs URL, classifies, inserts
 *     hazard (status ai_classified), returns the SubmitReportResponse DTO
 *   - submitReport AI-failure path: report stays saved; a typed ai_unavailable
 *     error is returned
 *   - submitReport DB-failure path: a db_error from the report insert is
 *     surfaced
 *   - getHazards maps snake_case rows to camelCase Hazard domain entities and
 *     propagates db_error
 *
 * SECURITY: all values are obviously-fake placeholders — no real credentials.
 *
 * Validates: Requirements 8.7
 */

import type { SupabaseGateway } from '@/server/clients/supabase';
import type { AiService } from '@/server/services/ai-service';
import type {
  Coordinates,
  HazardClassificationResult,
  HazardInsert,
  HazardRow,
  ReportInsert,
  ReportRow,
  Result,
} from '@/types';
import { err, ok } from '@/types';
import { makeHazardService, mapHazardRow } from '@/server/services/hazard-service';

const fakeReportRow: ReportRow = {
  id: 'report-fake-1',
  hazard_id: null,
  reporter_id: null,
  image_path: 'reports/fake.png',
  reporter_hints: 'water on the floor',
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
  severity_label: 'moderate',
  severity_score: 50,
  status: 'ai_classified',
  latitude: 42.35,
  longitude: -71.1,
  building_id: null,
  floor_id: null,
  confirmation_count: 0,
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
};

const fakeClassification: HazardClassificationResult = {
  category: 'spill',
  severityLabel: 'moderate',
  severityScore: 50,
  confidence: 0.9,
  rationale: 'A large puddle covers the walkway.',
  isUncertain: false,
};

/** Capture-aware fake SupabaseGateway; each method is overridable per test. */
function fakeSupabase(overrides: Partial<SupabaseGateway>): SupabaseGateway {
  return {
    insertReport: () => Promise.resolve(ok(fakeReportRow)),
    insertHazard: () => Promise.resolve(ok(fakeHazardRow)),
    hazardsInRadius: () => Promise.resolve(ok([])),
    createSignedUrl: () =>
      Promise.resolve(ok('https://fake.supabase.co/signed/abc')),
    ...overrides,
  };
}

function fakeAi(
  result: Result<HazardClassificationResult> = ok(fakeClassification),
): AiService {
  return {
    classifyReportImage: () => Promise.resolve(result),
  };
}

const submitInput = {
  imagePath: 'reports/fake.png',
  location: { latitude: 42.35, longitude: -71.1 } as Coordinates,
  reporterHints: 'water on the floor',
};

describe('HazardService.submitReport', () => {
  test('happy path: persists report, signs url, classifies, persists hazard, returns DTO', async () => {
    let insertedReport: ReportInsert | undefined;
    let signedPath: string | undefined;
    let insertedHazard: HazardInsert | undefined;

    const supabase = fakeSupabase({
      insertReport: (row) => {
        insertedReport = row;
        return Promise.resolve(ok(fakeReportRow));
      },
      createSignedUrl: (path) => {
        signedPath = path;
        return Promise.resolve(ok('https://fake.supabase.co/signed/abc'));
      },
      insertHazard: (row) => {
        insertedHazard = row;
        return Promise.resolve(ok(fakeHazardRow));
      },
    });
    const service = makeHazardService(supabase, fakeAi());

    const result = await service.submitReport(submitInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.reportId).toBe('report-fake-1');
      expect(result.data.classification).toEqual(fakeClassification);
      expect(result.data.hazard).toEqual(mapHazardRow(fakeHazardRow));
    }
    // report persisted with status 'submitted'
    expect(insertedReport?.status).toBe('submitted');
    expect(insertedReport?.image_path).toBe('reports/fake.png');
    // signed URL requested for the uploaded path
    expect(signedPath).toBe('reports/fake.png');
    // hazard persisted with status 'ai_classified'
    expect(insertedHazard?.status).toBe('ai_classified');
    expect(insertedHazard?.category).toBe('spill');
  });

  test('AI-failure path: report stays saved and a typed ai_unavailable error is returned', async () => {
    let hazardInsertCalled = false;
    const supabase = fakeSupabase({
      insertHazard: () => {
        hazardInsertCalled = true;
        return Promise.resolve(ok(fakeHazardRow));
      },
    });
    const ai = fakeAi(err({ code: 'ai_unavailable', message: 'service down' }));
    const service = makeHazardService(supabase, ai);

    const result = await service.submitReport(submitInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ai_unavailable');
    }
    // No hazard row written when classification fails (report alone is saved).
    expect(hazardInsertCalled).toBe(false);
  });

  test('DB-failure path: a db_error on report insert is surfaced', async () => {
    const supabase = fakeSupabase({
      insertReport: () =>
        Promise.resolve(err({ code: 'db_error', message: 'insert failed' })),
    });
    const service = makeHazardService(supabase, fakeAi());

    const result = await service.submitReport(submitInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('db_error');
    }
  });
});

describe('HazardService.getHazards', () => {
  test('maps snake_case rows to camelCase Hazard domain entities', async () => {
    const supabase = fakeSupabase({
      hazardsInRadius: () => Promise.resolve(ok([fakeHazardRow])),
    });
    const service = makeHazardService(supabase, fakeAi());

    const result = await service.getHazards({
      center: { latitude: 42.35, longitude: -71.1 },
      radiusMeters: 100,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.hazards).toHaveLength(1);
      const hazard = result.data.hazards[0];
      expect(hazard.id).toBe('hazard-fake-1');
      expect(hazard.category).toEqual({ kind: 'spill' });
      expect(hazard.severityLabel).toBe('moderate');
      expect(hazard.location).toEqual({ latitude: 42.35, longitude: -71.1 });
      expect(hazard.confirmationCount).toBe(0);
      expect(hazard.createdAt).toBe('2024-01-01T00:00:00.000Z');
    }
  });

  test("maps an 'other' row into the discriminated category with description", async () => {
    const otherRow: HazardRow = {
      ...fakeHazardRow,
      category: 'other',
      other_description: 'strange smell near the stairwell',
    };
    const supabase = fakeSupabase({
      hazardsInRadius: () => Promise.resolve(ok([otherRow])),
    });
    const service = makeHazardService(supabase, fakeAi());

    const result = await service.getHazards({
      center: { latitude: 42.35, longitude: -71.1 },
      radiusMeters: 100,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.hazards[0].category).toEqual({
        kind: 'other',
        otherDescription: 'strange smell near the stairwell',
      });
    }
  });

  test('propagates a db_error from the radius query', async () => {
    const supabase = fakeSupabase({
      hazardsInRadius: () =>
        Promise.resolve(err({ code: 'db_error', message: 'rpc missing' })),
    });
    const service = makeHazardService(supabase, fakeAi());

    const result = await service.getHazards({
      center: { latitude: 42.35, longitude: -71.1 },
      radiusMeters: 100,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('db_error');
    }
  });

  test('returns validation_error when center/radius are missing', async () => {
    const service = makeHazardService(fakeSupabase({}), fakeAi());
    const result = await service.getHazards({ buildingId: 'bldg-1' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation_error');
    }
  });
});
