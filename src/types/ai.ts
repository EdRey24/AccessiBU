import { z } from 'zod';
import type { Coordinates } from './geo';
import {
  HAZARD_CATEGORIES,
  HAZARD_SEVERITY_LABELS,
  type HazardSeverityLabel,
  type KnownHazardCategory,
} from './hazard';

// Gemini 1.5 Flash Vision contract.
//
// RESEARCH FINDING (verified at ai.google.dev): the JS/TS GenAI SDK accepts a
// Zod schema directly as the model's responseSchema. So `hazardClassificationResultSchema`
// does TWO jobs: it CONSTRAINS Gemini's structured output AND VALIDATES the
// returned JSON at our boundary. One schema, no drift.
//
// ZOD VERSION NOTE: this file is authored against zod v4 (installed 4.6.7). In v4
// `z.enum` accepts a readonly string array/tuple directly (signature
// `_enum<const T extends readonly string[]>`), so reusing the hazard.ts `as const`
// arrays as enum members works without constructing object-style enums.

/** Request carries a Storage signed URL / path — NOT raw image bytes. */
export interface HazardClassificationRequest {
  /** Supabase Storage signed URL (or storage path the server will sign). */
  readonly imageUrl: string;
  /** Optional reporter free-text hints ("elevator smells like smoke"). */
  readonly reporterHints?: string;
  /** Optional location context to improve classification. */
  readonly location?: Coordinates;
}

export interface HazardClassificationResult {
  /** Classified category or 'other' when the model is unsure of a known class. */
  readonly category: KnownHazardCategory | 'other';
  readonly severityLabel: HazardSeverityLabel;
  /** 0–100 severity score. */
  readonly severityScore: number;
  /** Model confidence, 0–1. */
  readonly confidence: number;
  /** Short human-readable justification. */
  readonly rationale: string;
  /** True when the model is not confident enough to auto-classify. */
  readonly isUncertain: boolean;
}

/**
 * ONE schema used as Gemini's responseSchema AND as the boundary validator.
 * Reuses the const arrays from hazard.ts via z.enum so lists never drift.
 */
export const hazardClassificationResultSchema = z.object({
  category: z.enum([...HAZARD_CATEGORIES, 'other'] as const),
  severityLabel: z.enum(HAZARD_SEVERITY_LABELS),
  severityScore: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  isUncertain: z.boolean(),
});

/** Inferred type from the zod schema. */
export type HazardClassificationResultParsed = z.infer<typeof hazardClassificationResultSchema>;

// Compile-time guard: the schema's inferred type MUST be assignable to the hand
// contract type. If either drifts, this line fails to type-check.
const _schemaMatchesContract: HazardClassificationResult = {} as HazardClassificationResultParsed;
void _schemaMatchesContract;
