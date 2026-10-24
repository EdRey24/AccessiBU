// Curated barrel. Consumers import from '@/types'.
// `export type` for pure types; value exports for zod schemas, const arrays,
// and the ok/err helpers. Internal compile-time guards are NOT re-exported.

// geo
export type {
  Coordinates,
  BuildingId,
  FloorId,
  BuildingFootprint,
  GeoJsonPosition,
  GeoJsonPoint,
  GeoJsonPolygon,
} from './geo';

// hazard
export type {
  KnownHazardCategory,
  HazardSeverityLabel,
  ReportStatus,
  HazardCategory,
  HazardSeverityScore,
  Hazard,
} from './hazard';
export { HAZARD_CATEGORIES, HAZARD_SEVERITY_LABELS, REPORT_STATUSES } from './hazard';

// ai
export type {
  HazardClassificationRequest,
  HazardClassificationResult,
  HazardClassificationResultParsed,
} from './ai';
export { hazardClassificationResultSchema } from './ai';

// routing
export type {
  RouteNodeKind,
  TraversalMode,
  NodeAccessibility,
  RouteGraphNode,
  RouteEdge,
  AvoidancePolicy,
  RouteConstraints,
  RouteRequest,
  BypassedNode,
  RouteResponse,
} from './routing';
export { NODE_KINDS, TRAVERSAL_MODES } from './routing';

// database
export type {
  HazardRow, HazardInsert, HazardUpdate,
  ReportRow, ReportInsert, ReportUpdate,
  RouteNodeRow, RouteNodeInsert, RouteNodeUpdate,
  BuildingRow, BuildingInsert, BuildingUpdate,
  ConfirmationRow, ConfirmationInsert, ConfirmationUpdate,
  VoteRow, VoteInsert,
} from './database';

// api
export type {
  AppErrorCode,
  AppError,
  Result,
  SubmitReportRequest, SubmitReportResponse,
  GetHazardsRequest, GetHazardsResponse,
  RequestRouteRequest, RequestRouteResponse,
} from './api';
export { APP_ERROR_CODES, ok, err } from './api';
