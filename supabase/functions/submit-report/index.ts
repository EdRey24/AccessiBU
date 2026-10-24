// Supabase Edge Function: submit-report (Deno runtime).
//
// Thin wiring around tested, app-side pieces (see the submit-report sequence
// diagram in design.md):
//   1. parse + validate the JSON body with `submitReportRequestSchema`
//      (@/server/http/dto-schemas) -> on failure return a validation_error.
//   2. build the services from env (@/_shared/services -> loadEnv +
//      createSupabaseGateway/createGeminiGateway + makeAiService/
//      makeHazardService).
//   3. delegate to `hazardService.submitReport` (persist report -> signed URL ->
//      classify -> persist classification).
//   4. return the service `Result<SubmitReportResponse>` as JSON via
//      `toHttpResponse` (@/server/http/result-response).
//
// The GEMINI_API_KEY stays a Supabase secret, read only inside `buildServices`.
// This handler uses the current Supabase Edge Function request contract: a
// default export with an async `fetch(req)` returning a Web `Response`.
//
// All `@/...` specifiers resolve through this function's deno.json import map.

import { submitReportRequestSchema } from '@/server/http/dto-schemas';
import { toHttpResponse } from '@/server/http/result-response';
import { err } from '@/types';

import { buildServices, type Services } from '../_shared/services.ts';
import { validateJson } from '../_shared/validate.ts';

export default {
  fetch: async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') {
      return toHttpResponse(
        err({ code: 'validation_error', message: 'Expected a POST request' }),
      );
    }

    const validated = await validateJson(req, submitReportRequestSchema);
    if (!validated.ok) {
      return toHttpResponse(validated.error);
    }

    let services: Services;
    try {
      services = buildServices();
    } catch (cause) {
      return toHttpResponse(
        err({
          code: 'internal_error',
          message: 'Server is misconfigured',
          details: String(cause),
        }),
      );
    }

    const result = await services.hazardService.submitReport(validated.value);
    return toHttpResponse(result);
  },
};
