/**
 * Unit tests for the server-only AI domain service
 * (`src/server/services/ai-service.ts`).
 *
 * These tests inject a lightweight fake GeminiGateway (no network, no real API
 * key) and assert that the service:
 *   - delegates classification to the gateway and returns its result
 *   - applies the uncertainty policy: a low-confidence result the model did not
 *     flag is forced to isUncertain = true
 *   - leaves a confident, non-uncertain result unchanged
 *   - never lowers an already-uncertain flag
 *   - propagates a gateway error unchanged
 *
 * SECURITY: all values are obviously-fake placeholders — no real credentials,
 * no real network, and only a signed-URL string is ever passed (never bytes).
 *
 * Validates: Requirements 8.7
 */

import type { GeminiGateway } from '@/server/clients/gemini';
import type {
  HazardClassificationRequest,
  HazardClassificationResult,
  Result,
} from '@/types';
import { err, ok } from '@/types';
import {
  AUTO_CLASSIFY_CONFIDENCE_THRESHOLD,
  makeAiService,
} from '@/server/services/ai-service';

/** Build a fake GeminiGateway that resolves with a fixed Result. */
function fakeGemini(
  result: Result<HazardClassificationResult>,
): GeminiGateway {
  return {
    classifyHazard: () => Promise.resolve(result),
  };
}

const fakeRequest: HazardClassificationRequest = {
  imageUrl: 'https://fake.supabase.co/storage/signed/hazard.jpg',
  reporterHints: 'water on the floor',
  location: { latitude: 42.35, longitude: -71.1 },
};

const confidentResult: HazardClassificationResult = {
  category: 'spill',
  severityLabel: 'moderate',
  severityScore: 50,
  confidence: 0.9,
  rationale: 'A large puddle covers the walkway.',
  isUncertain: false,
};

describe('AiService.classifyReportImage', () => {
  test('returns a confident, non-uncertain result unchanged', async () => {
    const service = makeAiService(fakeGemini(ok(confidentResult)));
    const result = await service.classifyReportImage(fakeRequest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(confidentResult);
    }
  });

  test('forces isUncertain = true when confidence is below the threshold', async () => {
    const lowConfidence: HazardClassificationResult = {
      ...confidentResult,
      confidence: AUTO_CLASSIFY_CONFIDENCE_THRESHOLD - 0.1,
      isUncertain: false,
    };
    const service = makeAiService(fakeGemini(ok(lowConfidence)));
    const result = await service.classifyReportImage(fakeRequest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.isUncertain).toBe(true);
      // Only the flag changes; everything else is carried through.
      expect(result.data.category).toBe(lowConfidence.category);
      expect(result.data.confidence).toBe(lowConfidence.confidence);
    }
  });

  test('keeps isUncertain = false at exactly the threshold', async () => {
    const atThreshold: HazardClassificationResult = {
      ...confidentResult,
      confidence: AUTO_CLASSIFY_CONFIDENCE_THRESHOLD,
      isUncertain: false,
    };
    const service = makeAiService(fakeGemini(ok(atThreshold)));
    const result = await service.classifyReportImage(fakeRequest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.isUncertain).toBe(false);
    }
  });

  test('never lowers an already-uncertain flag even when confidence is high', async () => {
    const flaggedHighConfidence: HazardClassificationResult = {
      ...confidentResult,
      confidence: 0.99,
      isUncertain: true,
    };
    const service = makeAiService(fakeGemini(ok(flaggedHighConfidence)));
    const result = await service.classifyReportImage(fakeRequest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.isUncertain).toBe(true);
    }
  });

  test('propagates a gateway error unchanged', async () => {
    const service = makeAiService(
      fakeGemini(err({ code: 'ai_unavailable', message: 'service down' })),
    );
    const result = await service.classifyReportImage(fakeRequest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ai_unavailable');
      expect(result.error.message).toBe('service down');
    }
  });
});
