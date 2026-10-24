// ⚠️ SERVER-ONLY MODULE — Supabase Edge Functions (Deno runtime) ONLY. ⚠️
//
// This service orchestrates the SupabaseGateway (`@/server/clients/supabase`,
// service-role key) and the AiService (`@/server/services/ai-service`, which
// wraps the server-only Gemini key). Like everything it depends on, this module
// MUST NEVER be bundled into, imported by, or referenced from the Expo client
// app or any UI/client code under `src/app/` or `src/components/`. Import it
// ONLY from Edge Function / server code; nothing in the client bundle should
// transitively import `@/server/*`.
//
// ROLE (see design Component 5 "Domain Services" + the submit-report sequence
// diagram):
//   * submitReport: insert a ReportRow (status 'submitted') -> create a signed
//     URL for the image path -> classify via aiService -> on success insert a
//     Hazard row (status 'ai_classified') and return the SubmitReportResponse
//     DTO. If AI classification fails, the report STAYS SAVED and a typed
//     `ai_unavailable` error is returned (the report awaits a later retry),
//     matching the sequence diagram's failure branch.
//   * getHazards: query via the Supabase gateway (radius search today) and map
//     snake_case DB rows to the camelCase domain `Hazard` entity. Per the
//     `database.ts` header note, snake_case -> camelCase mapping is the data
//     layer's job, so the small typed mapper lives here.
//
// All methods return the shared `Result<T, AppError>` envelope from `@/types`.
// The gateways are injected (factory params) so the service is unit-testable
// with fakes — no network, no real secrets — mirroring the `makeXGateway`
// pattern.

import type { AiService } from '@/server/services/ai-service';
import type { SupabaseGateway } from '@/server/clients/supabase';
import type {
  BuildingId,
  FloorId,
  GetHazardsRequest,
  GetHazardsResponse,
  Hazard,
  HazardCategory,
  HazardClassificationResult,
  HazardInsert,
  HazardRow,
  HazardSeverityLabel,
  HazardSeverityScore,
  KnownHazardCategory,
  ReportRow,
  ReportStatus,
  Result,
  SubmitReportRequest,
  SubmitReportResponse,
} from '@/types';
import { HAZARD_SEVERITY_LABELS, REPORT_STATUSES, err, ok } from '@/types';

// ---- snake_case (DB) -> camelCase (domain) mappers -------------------------
//
// The row columns are hand-written `string`/`number` (see database.ts), so the
// mappers narrow those loose DB types onto the domain unions. Unknown/garbled
// enum values fall back to safe defaults rather than throwing, keeping a single
// malformed row from failing an entire query.

const DEFAULT_SEVERITY_LABEL: HazardSeverityLabel = 'low';
const DEFAULT_REPORT_STATUS: ReportStatus = 'submitted';

function toSeverityLabel(value: string): HazardSeverityLabel {
  return (HAZARD_SEVERITY_LABELS as readonly string[]).includes(value)
    ? (value as HazardSeverityLabel)
    : DEFAULT_SEVERITY_LABEL;
}

function toReportStatus(value: string): ReportStatus {
  return (REPORT_STATUSES as readonly string[]).includes(value)
    ? (value as ReportStatus)
    : DEFAULT_REPORT_STATUS;
}

/** Clamp a DB severity score into the branded 0-100 domain type. */
function toSeverityScore(value: number): HazardSeverityScore {
  const clamped = Math.min(100, Math.max(0, value));
  return clamped as HazardSeverityScore;
}

/**
 * Reconstruct the discriminated {@link HazardCategory} from the flat DB columns
 * (`category` + nullable `other_description`). The `'other'` escape hatch
 * requires a non-empty description; a missing one is backfilled so the union
 * invariant holds.
 */
function toHazardCategory(category: string, otherDescription: string | null): HazardCategory {
  if (category === 'other') {
    return {
      kind: 'other',
      otherDescription: otherDescription ?? 'Unspecified',
    };
  }
  return { kind: category as KnownHazardCategory };
}

/** Map a snake_case {@link HazardRow} to the camelCase domain {@link Hazard}. */
export function mapHazardRow(row: HazardRow): Hazard {
  return {
    id: row.id,
    category: toHazardCategory(row.category, row.other_description),
    severityLabel: toSeverityLabel(row.severity_label),
    severityScore: toSeverityScore(row.severity_score),
    status: toReportStatus(row.status),
    location: { latitude: row.latitude, longitude: row.longitude },
    buildingId: row.building_id === null ? null : (row.building_id as BuildingId),
    floorId: row.floor_id === null ? null : (row.floor_id as FloorId),
    confirmationCount: row.confirmation_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---- classification -> HazardInsert ----------------------------------------
//
// Flatten the domain classification result back onto the snake_case insert
// shape, carrying over the report's location and the 'ai_classified' status.

function toHazardInsert(
  report: ReportRow,
  classification: HazardClassificationResult,
): HazardInsert {
  const isOther = classification.category === 'other';
  return {
    category: classification.category,
    // The classification result has no free-text field; 'other' is stored with
    // the model's rationale as the human-readable description.
    other_description: isOther ? classification.rationale : null,
    severity_label: classification.severityLabel,
    severity_score: classification.severityScore,
    status: 'ai_classified',
    latitude: report.latitude,
    longitude: report.longitude,
    building_id: null,
    floor_id: null,
  };
}

/**
 * Domain hazard service. Orchestrates report submission (persist -> classify ->
 * persist classification) and hazard queries.
 *
 * See design Component 5 "Domain Services".
 */
export interface HazardService {
  submitReport(input: SubmitReportRequest): Promise<Result<SubmitReportResponse>>;
  getHazards(req: GetHazardsRequest): Promise<Result<GetHazardsResponse>>;
}

/**
 * Create a {@link HazardService} backed by the given gateways.
 *
 * Both collaborators are injected so the service is unit-testable with fakes —
 * no network, no real secrets — mirroring the `makeXGateway` pattern.
 */
export function makeHazardService(
  supabase: SupabaseGateway,
  ai: AiService,
): HazardService {
  return {
    async submitReport(
      input: SubmitReportRequest,
    ): Promise<Result<SubmitReportResponse>> {
      // 1. Persist the report FIRST (status 'submitted') so the submission is
      //    durable even if AI classification later fails.
      const reportResult = await supabase.insertReport({
        reporter_id: null,
        image_path: input.imagePath,
        reporter_hints: input.reporterHints ?? null,
        latitude: input.location.latitude,
        longitude: input.location.longitude,
        status: 'submitted',
      });
      if (!reportResult.ok) {
        return reportResult;
      }
      const report = reportResult.data;

      // 2. Create a short-lived signed URL for the stored image path (the AI
      //    boundary only ever sees a URL, never raw bytes).
      const signedUrlResult = await supabase.createSignedUrl(input.imagePath);
      if (!signedUrlResult.ok) {
        return signedUrlResult;
      }

      // 3. Classify via the AI service (which applies the uncertainty policy).
      const classificationResult = await ai.classifyReportImage({
        imageUrl: signedUrlResult.data,
        reporterHints: input.reporterHints,
        location: input.location,
      });
      if (!classificationResult.ok) {
        // AI failure: the report stays saved and awaits a later retry. Surface
        // a typed error (gateway already maps to ai_unavailable / etc.).
        return classificationResult;
      }
      const classification = classificationResult.data;

      // 4. Persist the classified hazard (status 'ai_classified').
      const hazardResult = await supabase.insertHazard(
        toHazardInsert(report, classification),
      );
      if (!hazardResult.ok) {
        return hazardResult;
      }

      return ok({
        reportId: report.id,
        hazard: mapHazardRow(hazardResult.data),
        classification,
      } satisfies SubmitReportResponse);
    },

    async getHazards(
      req: GetHazardsRequest,
    ): Promise<Result<GetHazardsResponse>> {
      // The Supabase gateway currently exposes a radius search; a center +
      // radius is required to scope the query. (Building-only filtering is a
      // follow-up once the gateway grows a building query.)
      if (req.center === undefined || req.radiusMeters === undefined) {
        return err({
          code: 'validation_error',
          message: 'getHazards requires a center coordinate and radiusMeters',
        });
      }

      const rowsResult = await supabase.hazardsInRadius(req.center, req.radiusMeters);
      if (!rowsResult.ok) {
        return rowsResult;
      }

      return ok({
        hazards: rowsResult.data.map(mapHazardRow),
      } satisfies GetHazardsResponse);
    },
  };
}
