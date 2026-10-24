// Supabase Edge Function: get-hazards (Deno runtime).
//
// Thin wiring around tested, app-side pieces:
//   1. parse + validate the JSON body with `getHazardsRequestSchema`
//      (@/server/http/dto-schemas) -> on failure return a validation_error.
//   2. build the services from env (@/_shared/services).
//   3. delegate to `hazardService.getHazards` (radius query -> row->domain map).
//      The service enforces the "center + radius required" policy and returns a
//      validation_error when they are absent.
//   4. return the service `Result<GetHazardsResponse>` as JSON via
//      `toHttpResponse`.
//
// Current Supabase Edge Function request contract: default export with an async
// `fetch(req)` returning a Web `Response`. All `@/...` specifiers resolve
// through this function's deno.json import map.

import { getHazardsRequestSchema } from '@/server/http/dto-schemas';
import { toHttpResponse } from '@/server/http/result-response';
import { err } from '@/types';

import { buildServices } from '../_shared/services.ts';
import { validateJson } from '../_shared/validate.ts';

export default {
  fetch: async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') {
      return toHttpResponse(
        err({ code: 'validation_error', message: 'Expected a POST request' }),
      );
    }

    const validated = await validateJson(req, getHazardsRequestSchema);
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

    const result = await services.hazardService.getHazards(validated.value);
    return toHttpResponse(result);
  },
};
