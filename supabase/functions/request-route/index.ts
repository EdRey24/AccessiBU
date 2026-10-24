// Supabase Edge Function: request-route (Deno runtime).
//
// Thin wiring around tested, app-side pieces (see the request-route sequence
// diagram in design.md):
//   1. parse + validate the JSON body with `routeRequestSchema`
//      (@/server/http/dto-schemas) -> on failure return a validation_error.
//   2. build the services from env (@/_shared/services).
//   3. load the routing graph (nodes + edges) and the active hazards, then call
//      `routingService.computeRoute(request, nodes, edges, hazards)`.
//   4. wrap the returned `RouteResponse` in `ok(...)` and return it as JSON via
//      `toHttpResponse`. (A `no_accessible_route` RouteResponse is a SUCCESSFUL
//      computation with a negative result — HTTP 200 — not an AppError, per the
//      design's Error Handling Scenario 3.)
//
// GRAPH LOADING — DB-TEAMMATE BOUNDARY (TODO):
//   The routing graph (RouteGraphNode[] + RouteEdge[]) is persisted in Postgres
//   as `RouteNodeRow`/edge rows (see database.ts). The query that loads and maps
//   those rows into the `@/types` graph shapes is owned jointly with the DB
//   teammate and is NOT part of this skeleton's gateway surface yet
//   (`SupabaseGateway` today exposes insert/radius/signed-URL only, not a graph
//   loader). Until that query lands, nodes/edges are loaded as empty; with an
//   empty graph `computeRoute` returns `no_accessible_route`, which is the
//   correct, well-typed behavior. Active hazards ARE loaded via the existing
//   `hazardsInRadius` gateway method so the AvoidancePolicy has real data to act
//   on once the graph loader is wired.
//
// Current Supabase Edge Function request contract: default export with an async
// `fetch(req)` returning a Web `Response`. All `@/...` specifiers resolve
// through this function's deno.json import map.

import { routeRequestSchema } from '@/server/http/dto-schemas';
import { toHttpResponse } from '@/server/http/result-response';
import type { RoutableHazard } from '@/server/services/routing-service';
import type { RouteEdge, RouteGraphNode } from '@/types';
import { err, ok } from '@/types';

import { buildServices } from '../_shared/services.ts';
import { validateJson } from '../_shared/validate.ts';

/**
 * Radius (meters) used to pull active hazards near the route origin so the
 * AvoidancePolicy has candidates to route around. Generous enough to cover a
 * campus-scale route; the hard/soft avoidance radius itself comes from the
 * per-request policy.
 */
const HAZARD_LOAD_RADIUS_METERS = 2_000;

export default {
  fetch: async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') {
      return toHttpResponse(
        err({ code: 'validation_error', message: 'Expected a POST request' }),
      );
    }

    const validated = await validateJson(req, routeRequestSchema);
    if (!validated.ok) {
      return toHttpResponse(validated.error);
    }
    const request = validated.value;

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

    // Load active hazards near the origin (real gateway call today). A DB error
    // here is surfaced as-is; everything else is a successful computation.
    const hazardsResult = await services.supabase.hazardsInRadius(
      request.origin,
      HAZARD_LOAD_RADIUS_METERS,
    );
    if (!hazardsResult.ok) {
      return toHttpResponse(hazardsResult);
    }
    const hazards: RoutableHazard[] = hazardsResult.data.map((row) => ({
      location: { latitude: row.latitude, longitude: row.longitude },
      // Loose DB string -> domain label narrowing happens in the service layer;
      // the routing service compares by severity ordinal and tolerates this.
      severityLabel: row.severity_label as RoutableHazard['severityLabel'],
    }));

    // TODO(db-teammate): load + map RouteNodeRow/edges into these shapes.
    const nodes: readonly RouteGraphNode[] = [];
    const edges: readonly RouteEdge[] = [];

    const route = services.routingService.computeRoute(request, nodes, edges, hazards);
    return toHttpResponse(ok(route));
  },
};
