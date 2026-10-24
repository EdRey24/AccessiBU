// ⚠️ SERVER-ONLY MODULE — Supabase Edge Functions (Deno runtime) ONLY. ⚠️
//
// This service wraps the GeminiGateway (`@/server/clients/gemini`), which
// constructs a GenAI client with the server-only GEMINI_API_KEY. Like the
// gateway it depends on, this module MUST NEVER be bundled into, imported by,
// or referenced from the Expo client app or any UI/client code under
// `src/app/` or `src/components/`. Import it ONLY from Edge Function / server
// code; nothing in the client bundle should transitively import `@/server/*`.
//
// ROLE (see design Component 5 "Domain Services"):
//   `aiService` is the service-level seam over the Gemini wrapper. It owns the
//   UNCERTAINTY POLICY — deciding/propagating `isUncertain` on the
//   HazardClassificationResult. Prompt CONSTRUCTION itself lives in the gemini
//   wrapper (it needs the model/part APIs); this service does not duplicate the
//   prompt. It delegates classification to the gateway and then applies the
//   service-level policy: a result the model did not already flag is forced to
//   `isUncertain = true` when the model's confidence is below the auto-classify
//   threshold, so low-confidence classifications are consistently surfaced for
//   review no matter how the underlying model behaves.
//
// All methods return the shared `Result<T, AppError>` envelope from `@/types`
// and propagate the gateway's errors unchanged.

import type { GeminiGateway } from '@/server/clients/gemini';
import type {
  HazardClassificationRequest,
  HazardClassificationResult,
  Result,
} from '@/types';
import { ok } from '@/types';

/**
 * Service-level confidence floor for auto-classification. A successful
 * classification whose `confidence` is below this threshold is treated as
 * uncertain regardless of the model's own `isUncertain` flag, so low-confidence
 * results are always routed to community/human review.
 */
export const AUTO_CLASSIFY_CONFIDENCE_THRESHOLD = 0.6;

/**
 * Apply the service-level uncertainty policy to a classification result.
 *
 * The policy is monotonic: it only ever RAISES uncertainty. If the model
 * already flagged the result as uncertain, it stays uncertain; otherwise it
 * becomes uncertain when confidence is below
 * {@link AUTO_CLASSIFY_CONFIDENCE_THRESHOLD}.
 */
function applyUncertaintyPolicy(
  result: HazardClassificationResult,
): HazardClassificationResult {
  const isUncertain =
    result.isUncertain || result.confidence < AUTO_CLASSIFY_CONFIDENCE_THRESHOLD;
  if (isUncertain === result.isUncertain) {
    return result;
  }
  return { ...result, isUncertain };
}

/**
 * Domain AI service. Delegates image classification to the {@link GeminiGateway}
 * and applies the service-level uncertainty policy.
 *
 * See design Component 5 "Domain Services".
 */
export interface AiService {
  classifyReportImage(
    req: HazardClassificationRequest,
  ): Promise<Result<HazardClassificationResult>>;
}

/**
 * Create an {@link AiService} backed by the given {@link GeminiGateway}.
 *
 * The gateway is injected so the service is unit-testable with a fake gateway —
 * no network, no real API key — mirroring the `makeXGateway` pattern used by
 * the client wrappers.
 */
export function makeAiService(gemini: GeminiGateway): AiService {
  return {
    async classifyReportImage(
      req: HazardClassificationRequest,
    ): Promise<Result<HazardClassificationResult>> {
      const classified = await gemini.classifyHazard(req);
      if (!classified.ok) {
        // Propagate the gateway error (ai_unavailable / validation_error / ...)
        // unchanged — the uncertainty policy only applies to successes.
        return classified;
      }
      return ok(applyUncertaintyPolicy(classified.data));
    },
  };
}
