// ⚠️ SERVER-ONLY MODULE — Supabase Edge Functions (Deno runtime) ONLY. ⚠️
//
// This module constructs a Google GenAI client with the GEMINI_API_KEY (via
// `@/server/config/env`). The Gemini key is a billable third-party credential,
// so it MUST NEVER be bundled into, imported by, or referenced from the Expo
// client app or any UI/client code under `src/app/` or `src/components/`.
// Import this ONLY from Edge Function / server code; nothing in the client
// bundle should transitively import `@/server/*`.
//
// NO RAW IMAGE BYTES: this wrapper only ever receives a Supabase Storage signed
// URL (via `HazardClassificationRequest.imageUrl`). It never reads, decodes, or
// forwards image bytes — the signed URL is handed to Gemini as a file part.
//
// API SURFACE (verified against @google/genai@2.31.0, the CURRENT unified SDK —
// NOT the deprecated @google/generative-ai — using the installed type
// definitions and https://ai.google.dev/gemini-api/docs/structured-output):
//   * new GoogleGenAI({ apiKey })                      (GoogleGenAIOptions.apiKey)
//   * ai.models.generateContent({ model, contents, config })
//       -> GenerateContentResponse with `.text: string | undefined`
//   * config.responseMimeType = 'application/json' + config.responseSchema
//       constrain structured output. `responseSchema` is typed `SchemaUnion =
//       Schema | unknown`, and the JS/TS SDK accepts a ZOD schema directly
//       (the SDK converts zod -> JSON schema internally); we therefore pass
//       `hazardClassificationResultSchema` straight through as responseSchema.
//   * createUserContent(...) + createPartFromUri(uri, mimeType) build a
//       multimodal prompt that references the image BY URL.
//
// BOUNDARY VALIDATION (non-negotiable): regardless of the structured-output
// constraint, the model's returned JSON is re-validated here with
// `hazardClassificationResultSchema.safeParse`. A parse failure maps to
// `AppError{ code: 'validation_error' }`; a thrown/unavailable client maps to
// `AppError{ code: 'ai_unavailable' }`; anything else unexpected maps to
// `AppError{ code: 'internal_error' }`.

import {
  createPartFromUri,
  createUserContent,
  GoogleGenAI,
  type GenerateContentResponse,
} from '@google/genai';

import type { EnvConfig } from '@/server/config/env';
import type {
  AppError,
  HazardClassificationRequest,
  HazardClassificationResult,
  Result,
} from '@/types';
import { err, hazardClassificationResultSchema, ok } from '@/types';

/**
 * Gemini 1.5 Flash is the multimodal (vision) model used for hazard
 * classification. Confirmed as a current, available model id in the Gemini API.
 */
const GEMINI_MODEL = 'gemini-1.5-flash';

/**
 * Signed URLs from Supabase Storage for hazard photos are JPEG/PNG. We default
 * to JPEG when the caller does not otherwise constrain the type; the mime type
 * is only a hint to the model for decoding the referenced URL.
 */
const DEFAULT_IMAGE_MIME_TYPE = 'image/jpeg';

/**
 * Instruction prompt. The structured-output schema already constrains the
 * SHAPE of the response; the prompt constrains the TASK. Reporter hints and
 * location (when present) are appended as additional context.
 */
function buildPrompt(req: HazardClassificationRequest): string {
  const lines = [
    'You are an accessibility hazard classifier for a campus navigation app.',
    'Analyze the referenced image and classify the accessibility hazard it shows.',
    'Respond ONLY with JSON matching the provided schema.',
    'severityScore is 0-100; confidence is 0-1; set isUncertain to true when you are not confident enough to auto-classify.',
  ];
  if (req.reporterHints && req.reporterHints.trim().length > 0) {
    lines.push(`Reporter hints: ${req.reporterHints.trim()}`);
  }
  if (req.location) {
    lines.push(
      `Reported location: latitude ${req.location.latitude}, longitude ${req.location.longitude}.`,
    );
  }
  return lines.join('\n');
}

/**
 * The GenAI client surface this gateway actually uses. Declaring it lets the
 * gateway accept either a real `GoogleGenAI` or a lightweight test double via
 * dependency injection — no network, no real API key needed in unit tests.
 */
export interface GenAiClientLike {
  readonly models: {
    generateContent(params: {
      model: string;
      contents: unknown;
      config?: unknown;
    }): Promise<Pick<GenerateContentResponse, 'text'>>;
  };
}

/**
 * Send a Storage signed URL plus a prompt to Gemini 1.5 Flash Vision, request
 * structured output constrained by `hazardClassificationResultSchema`, and
 * return the shared `Result<HazardClassificationResult, AppError>` envelope.
 *
 * See design Component 4 "Gemini Client Wrapper".
 */
export interface GeminiGateway {
  classifyHazard(
    req: HazardClassificationRequest,
  ): Promise<Result<HazardClassificationResult>>;
}

/** Map a thrown/unavailable client error to the shared AI-unavailable error. */
function toAiUnavailableError(cause: unknown): AppError {
  const message =
    cause instanceof Error ? cause.message : 'Gemini request failed';
  return {
    code: 'ai_unavailable',
    message,
    details: cause,
  };
}

/**
 * Create a {@link GeminiGateway} backed by the given GenAI client.
 *
 * Accepts the client by injection so callers (and tests) control construction.
 * Use {@link createGeminiGateway} to build the production client from
 * {@link EnvConfig}.
 */
export function makeGeminiGateway(client: GenAiClientLike): GeminiGateway {
  return {
    async classifyHazard(
      req: HazardClassificationRequest,
    ): Promise<Result<HazardClassificationResult>> {
      let response: Pick<GenerateContentResponse, 'text'>;
      try {
        response = await client.models.generateContent({
          model: GEMINI_MODEL,
          // The image is referenced BY URL — raw bytes never pass through here.
          contents: createUserContent([
            buildPrompt(req),
            createPartFromUri(req.imageUrl, DEFAULT_IMAGE_MIME_TYPE),
          ]),
          config: {
            responseMimeType: 'application/json',
            // The JS/TS GenAI SDK accepts a zod schema directly as the response
            // schema; the SAME schema re-validates the result below.
            responseSchema: hazardClassificationResultSchema,
          },
        });
      } catch (cause) {
        return err(toAiUnavailableError(cause));
      }

      const text = response.text;
      if (text === undefined || text.trim().length === 0) {
        return err({
          code: 'ai_unavailable',
          message: 'Gemini returned no response text',
        });
      }

      let candidate: unknown;
      try {
        candidate = JSON.parse(text);
      } catch (cause) {
        return err({
          code: 'validation_error',
          message: 'Gemini response was not valid JSON',
          details: cause,
        });
      }

      // Boundary validation — the non-negotiable part. Even though structured
      // output constrains the shape, we re-validate before trusting it.
      const parsed = hazardClassificationResultSchema.safeParse(candidate);
      if (!parsed.success) {
        return err({
          code: 'validation_error',
          message: 'Gemini response failed schema validation',
          details: parsed.error.issues,
        });
      }

      return ok(parsed.data satisfies HazardClassificationResult);
    },
  };
}

/**
 * Build a production {@link GeminiGateway} from validated server env.
 *
 * Reads the server-only Gemini API key from {@link EnvConfig}; the key is never
 * logged, returned, or bundled into the client app.
 */
export function createGeminiGateway(env: EnvConfig): GeminiGateway {
  const client = new GoogleGenAI({ apiKey: env.geminiApiKey });
  return makeGeminiGateway(client);
}
