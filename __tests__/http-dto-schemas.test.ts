/**
 * Unit tests for the Edge Function request-DTO zod schemas
 * (`@/server/http/dto-schemas`).
 *
 * Each schema mirrors a transport-neutral request DTO from `@/types`. These
 * tests assert well-formed bodies parse and malformed bodies are rejected,
 * exercising the boundary validation the Edge Functions rely on without needing
 * the Deno runtime.
 *
 * Validates: Requirements 6.5 (transport-neutral DTOs validated at the boundary).
 */

import {
  avoidancePolicySchema,
  coordinatesSchema,
  getHazardsRequestSchema,
  routeRequestSchema,
  submitReportRequestSchema,
} from '@/server/http/dto-schemas';

const validCoordinates = { latitude: 42.35, longitude: -71.1 } as const;

describe('coordinatesSchema', () => {
  test('accepts an in-range coordinate', () => {
    expect(coordinatesSchema.safeParse(validCoordinates).success).toBe(true);
  });

  test('rejects latitude above 90', () => {
    expect(
      coordinatesSchema.safeParse({ latitude: 91, longitude: 0 }).success,
    ).toBe(false);
  });

  test('rejects longitude below -180', () => {
    expect(
      coordinatesSchema.safeParse({ latitude: 0, longitude: -181 }).success,
    ).toBe(false);
  });
});

describe('submitReportRequestSchema', () => {
  test('accepts a well-formed submit-report body (hints optional)', () => {
    expect(
      submitReportRequestSchema.safeParse({
        imagePath: 'reports/abc.jpg',
        location: validCoordinates,
      }).success,
    ).toBe(true);
  });

  test('accepts an optional non-empty reporterHints', () => {
    expect(
      submitReportRequestSchema.safeParse({
        imagePath: 'reports/abc.jpg',
        location: validCoordinates,
        reporterHints: 'elevator out of service',
      }).success,
    ).toBe(true);
  });

  test('rejects an empty imagePath', () => {
    expect(
      submitReportRequestSchema.safeParse({
        imagePath: '',
        location: validCoordinates,
      }).success,
    ).toBe(false);
  });

  test('rejects a missing location', () => {
    expect(
      submitReportRequestSchema.safeParse({ imagePath: 'reports/abc.jpg' })
        .success,
    ).toBe(false);
  });
});

describe('getHazardsRequestSchema', () => {
  test('accepts an empty body (all fields optional)', () => {
    expect(getHazardsRequestSchema.safeParse({}).success).toBe(true);
  });

  test('accepts center + radiusMeters', () => {
    expect(
      getHazardsRequestSchema.safeParse({
        center: validCoordinates,
        radiusMeters: 250,
      }).success,
    ).toBe(true);
  });

  test('rejects a non-positive radiusMeters', () => {
    expect(
      getHazardsRequestSchema.safeParse({
        center: validCoordinates,
        radiusMeters: 0,
      }).success,
    ).toBe(false);
  });
});

describe('avoidancePolicySchema', () => {
  test('accepts a valid soft_penalty policy', () => {
    expect(
      avoidancePolicySchema.safeParse({
        severityThreshold: 'high',
        radiusMeters: 30,
        mode: 'soft_penalty',
      }).success,
    ).toBe(true);
  });

  test('rejects an unknown mode', () => {
    expect(
      avoidancePolicySchema.safeParse({
        severityThreshold: 'high',
        radiusMeters: 30,
        mode: 'teleport',
      }).success,
    ).toBe(false);
  });

  test('rejects an unknown severityThreshold', () => {
    expect(
      avoidancePolicySchema.safeParse({
        severityThreshold: 'catastrophic',
        radiusMeters: 30,
        mode: 'hard_block',
      }).success,
    ).toBe(false);
  });
});

describe('routeRequestSchema', () => {
  const validRoute = {
    origin: validCoordinates,
    destination: { latitude: 42.36, longitude: -71.09 },
    constraints: { requireStepFree: true, allowedModes: ['wheelchair', 'ramp'] },
    avoidance: { severityThreshold: 'moderate', radiusMeters: 20, mode: 'hard_block' },
  } as const;

  test('accepts a well-formed route request', () => {
    expect(routeRequestSchema.safeParse(validRoute).success).toBe(true);
  });

  test('rejects an unknown traversal mode in allowedModes', () => {
    expect(
      routeRequestSchema.safeParse({
        ...validRoute,
        constraints: { requireStepFree: true, allowedModes: ['hovercraft'] },
      }).success,
    ).toBe(false);
  });

  test('rejects a missing avoidance policy', () => {
    const { avoidance: _avoidance, ...withoutAvoidance } = validRoute;
    expect(routeRequestSchema.safeParse(withoutAvoidance).success).toBe(false);
  });
});
