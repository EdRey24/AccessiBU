/**
 * Unit tests for the Result -> HTTP mapping helper
 * (`@/server/http/result-response`).
 *
 * Covers the design's Edge Function status mapping: a successful Result is 200
 * and carries the envelope; each closed AppError code maps to its documented
 * HTTP status; the body is always the Result envelope JSON.
 *
 * Validates: Requirements 6.5 (transport of the Result envelope).
 */

import { statusForResult, toHttpResponse } from '@/server/http/result-response';
import type { AppErrorCode, Result } from '@/types';
import { err, ok } from '@/types';

describe('statusForResult', () => {
  test('a successful Result maps to HTTP 200', () => {
    expect(statusForResult(ok({ hello: 'world' }))).toBe(200);
  });

  test.each<[AppErrorCode, number]>([
    ['validation_error', 400],
    ['unauthorized', 401],
    ['not_found', 404],
    ['rate_limited', 429],
    ['ai_unavailable', 503],
    ['db_error', 500],
    ['internal_error', 500],
  ])('error code %s maps to HTTP %i', (code, expectedStatus) => {
    const result: Result<never> = err({ code, message: 'boom' });
    expect(statusForResult(result)).toBe(expectedStatus);
  });
});

describe('toHttpResponse', () => {
  test('serializes a success Result as the envelope with status 200', async () => {
    const response = toHttpResponse(ok({ reportId: 'r-1' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { reportId: 'r-1' },
    });
  });

  test('serializes a failure Result as the envelope with the mapped status', async () => {
    const response = toHttpResponse(
      err({ code: 'ai_unavailable', message: 'model down' }),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: { code: 'ai_unavailable', message: 'model down' },
    });
  });
});
