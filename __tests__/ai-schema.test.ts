/**
 * Runtime zod unit tests for `hazardClassificationResultSchema`.
 *
 * Covers the required cases from the design's "zod schema unit tests":
 *  - a well-formed object parses with success: true
 *  - an unknown category ('volcano') fails
 *  - out-of-range severityScore (150, -1) fails
 *  - out-of-range confidence (1.5, -0.1) fails
 *  - empty rationale fails
 *
 * Validates: Requirements 9.2, 9.3, 9.4, 9.5
 * (Full bounds coverage — Property 5 — lives in optional Task 8.3.)
 */

import { hazardClassificationResultSchema } from '@/types';

/** A fully valid, HazardClassificationResult-shaped object. */
const validResult = {
  category: 'spill',
  severityLabel: 'high',
  severityScore: 72,
  confidence: 0.84,
  rationale: 'Liquid pooled across the corridor near the elevator.',
  isUncertain: false,
} as const;

describe('hazardClassificationResultSchema (runtime)', () => {
  test('a well-formed classification object parses with success: true', () => {
    const parsed = hazardClassificationResultSchema.safeParse(validResult);
    expect(parsed.success).toBe(true);
  });

  test("accepts the 'other' category (flat enum includes 'other')", () => {
    const parsed = hazardClassificationResultSchema.safeParse({
      ...validResult,
      category: 'other',
    });
    expect(parsed.success).toBe(true);
  });

  test("rejects an unknown category ('volcano')", () => {
    const parsed = hazardClassificationResultSchema.safeParse({
      ...validResult,
      category: 'volcano',
    });
    expect(parsed.success).toBe(false);
  });

  test('rejects severityScore above the 0–100 range (150)', () => {
    const parsed = hazardClassificationResultSchema.safeParse({
      ...validResult,
      severityScore: 150,
    });
    expect(parsed.success).toBe(false);
  });

  test('rejects severityScore below the 0–100 range (-1)', () => {
    const parsed = hazardClassificationResultSchema.safeParse({
      ...validResult,
      severityScore: -1,
    });
    expect(parsed.success).toBe(false);
  });

  test('rejects confidence above the 0–1 range (1.5)', () => {
    const parsed = hazardClassificationResultSchema.safeParse({
      ...validResult,
      confidence: 1.5,
    });
    expect(parsed.success).toBe(false);
  });

  test('rejects confidence below the 0–1 range (-0.1)', () => {
    const parsed = hazardClassificationResultSchema.safeParse({
      ...validResult,
      confidence: -0.1,
    });
    expect(parsed.success).toBe(false);
  });

  test('rejects an empty rationale', () => {
    const parsed = hazardClassificationResultSchema.safeParse({
      ...validResult,
      rationale: '',
    });
    expect(parsed.success).toBe(false);
  });
});
