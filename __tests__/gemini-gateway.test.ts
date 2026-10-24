/**
 * Unit tests for the server-only Gemini client wrapper
 * (`src/server/clients/gemini.ts`).
 *
 * These tests inject a lightweight fake GenAI client (no network, no real API
 * key) and assert that the gateway maps the model's output onto the shared
 * `Result<T, AppError>` envelope from `@/types`:
 *   - a valid model JSON response -> ok with a parsed HazardClassificationResult
 *   - a malformed model response (bad category / out-of-range score / non-JSON)
 *       -> err with code 'validation_error' (schema parse fails at the boundary)
 *   - the client throwing / unavailable -> err with code 'ai_unavailable'
 *
 * SECURITY: all values are obviously-fake placeholders — no real credentials,
 * no real network, and only a signed-URL string is ever passed (never bytes).
 *
 * Validates: Requirements 3.1, 8.6, 8.7
 */

import type { HazardClassificationRequest } from '@/types';
import {
  makeGeminiGateway,
  type GenAiClientLike,
} from '@/server/clients/gemini';

/**
 * Build a fake GenAI client whose `generateContent` resolves with the given
 * `text`, or rejects with `throws` when provided.
 */
function fakeClient(opts: {
  text?: string | undefined;
  throws?: unknown;
}): GenAiClientLike {
  return {
    models: {
      generateContent: () => {
        if ('throws' in opts) {
          return Promise.reject(opts.throws);
        }
        return Promise.resolve({ text: opts.text });
      },
    },
  };
}

const fakeRequest: HazardClassificationRequest = {
  imageUrl: 'https://fake.supabase.co/storage/signed/hazard.jpg',
  reporterHints: 'elevator looks broken',
  location: { latitude: 42.35, longitude: -71.1 },
};

const validResult = {
  category: 'broken_elevator',
  severityLabel: 'high',
  severityScore: 80,
  confidence: 0.92,
  rationale: 'The elevator door is jammed open with a visible fault light.',
  isUncertain: false,
};

describe('GeminiGateway.classifyHazard', () => {
  test('returns ok with the parsed result on a valid model JSON response', async () => {
    const gateway = makeGeminiGateway(
      fakeClient({ text: JSON.stringify(validResult) }),
    );
    const result = await gateway.classifyHazard(fakeRequest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(validResult);
    }
  });

  test("maps an invalid category to err with code 'validation_error'", async () => {
    const gateway = makeGeminiGateway(
      fakeClient({
        text: JSON.stringify({ ...validResult, category: 'volcano' }),
      }),
    );
    const result = await gateway.classifyHazard(fakeRequest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation_error');
    }
  });

  test("maps an out-of-range severityScore to err with code 'validation_error'", async () => {
    const gateway = makeGeminiGateway(
      fakeClient({
        text: JSON.stringify({ ...validResult, severityScore: 150 }),
      }),
    );
    const result = await gateway.classifyHazard(fakeRequest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation_error');
    }
  });

  test("maps a non-JSON response to err with code 'validation_error'", async () => {
    const gateway = makeGeminiGateway(
      fakeClient({ text: 'not json at all {' }),
    );
    const result = await gateway.classifyHazard(fakeRequest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation_error');
    }
  });

  test("maps a thrown/unavailable client to err with code 'ai_unavailable'", async () => {
    const gateway = makeGeminiGateway(
      fakeClient({ throws: new Error('service unavailable') }),
    );
    const result = await gateway.classifyHazard(fakeRequest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ai_unavailable');
      expect(result.error.message).toBe('service unavailable');
    }
  });

  test("maps a missing response text to err with code 'ai_unavailable'", async () => {
    const gateway = makeGeminiGateway(fakeClient({ text: undefined }));
    const result = await gateway.classifyHazard(fakeRequest);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ai_unavailable');
    }
  });
});
