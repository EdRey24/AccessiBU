// Shared Edge Function glue (Deno runtime).
//
// Per the Supabase guidance, utilities reused across Edge Functions live in
// `supabase/functions/_shared` and are imported by RELATIVE path; functions do
// not import each other. This module centralizes two things every handler
// needs: (1) loading + validating the Deno environment into the typed
// `EnvConfig`, and (2) constructing the domain services from that env.
//
// The `@/...` specifiers below resolve through each function's `deno.json`
// import map (`"@/": "../../../src/"`), so the Deno functions reuse the SAME
// app-side service/type modules as the source of truth — no logic is
// reimplemented here.
//
// Secrets (verified against current Supabase docs):
//   * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected into Edge
//     Functions by default.
//   * GEMINI_API_KEY is a custom secret set via `supabase secrets set` (or
//     supabase/functions/.env locally) and read with Deno.env.get.

import { createGeminiGateway } from '@/server/clients/gemini';
import { createSupabaseGateway } from '@/server/clients/supabase';
import { loadEnv } from '@/server/config/env';
import { makeAiService } from '@/server/services/ai-service';
import { makeHazardService, type HazardService } from '@/server/services/hazard-service';
import { makeRoutingService, type RoutingService } from '@/server/services/routing-service';
import type { SupabaseGateway } from '@/server/clients/supabase';

/** The collaborators an Edge Function handler needs, wired from env. */
export interface Services {
  readonly supabase: SupabaseGateway;
  readonly hazardService: HazardService;
  readonly routingService: RoutingService;
}

/**
 * Load + validate the Deno environment and construct the domain services.
 *
 * `loadEnv` throws (zod) on any missing/malformed secret so the handler fails
 * fast with a clear configuration error rather than a confusing runtime fault.
 */
export function buildServices(): Services {
  const env = loadEnv(Deno.env.toObject());
  const supabase = createSupabaseGateway(env);
  const gemini = createGeminiGateway(env);
  const ai = makeAiService(gemini);
  const hazardService = makeHazardService(supabase, ai);
  const routingService = makeRoutingService();
  return { supabase, hazardService, routingService };
}
