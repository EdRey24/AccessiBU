// ⚠️ SERVER-ONLY MODULE — Supabase Edge Functions (Deno runtime) ONLY. ⚠️
//
// Unlike the other services, routing has NO secrets: it is a pure algorithm
// over the shared `@/types` route graph. It lives under `@/server/*` purely
// because it runs inside the `request-route` Edge Function (which loads the
// graph + active hazards from the DB and feeds them in). It MUST NOT be bundled
// into the Expo client bundle; nothing under `src/app/` or `src/components/`
// should import `@/server/*`.
//
// ROLE (see design Component 5 "routingService", the routing.ts contract, and
// the request-route sequence diagram):
//   * computeRoute: run a Dijkstra shortest-path search over the node graph
//     using `RouteEdge.cost`, honoring the per-request `RouteConstraints`
//     (step-free / allowed traversal modes) and `AvoidancePolicy`
//     (soft_penalty reweight vs hard_block pruning around active hazards), and
//     return the discriminated `RouteResponse` ('route_found' |
//     'no_accessible_route').
//
// PURITY / DEPENDENCY INJECTION: the service takes the `RouteGraphNode[]`,
// `RouteEdge[]`, and the set of active hazards as parameters. The Edge Function
// / data layer is responsible for loading them; the service itself performs no
// I/O, so it is trivially unit-testable with small hand-built fixtures.
//
// ASSUMPTION: origin/destination are arbitrary `Coordinates`; we snap each to
// the nearest graph node by great-circle (haversine) distance and route
// between those two nodes. (Richer off-graph entry/exit modeling is a
// follow-up; this matches the design's graph-based contract.)

import type {
  AvoidancePolicy,
  BypassedNode,
  Coordinates,
  HazardSeverityLabel,
  RouteConstraints,
  RouteEdge,
  RouteGraphNode,
  RouteRequest,
  RouteResponse,
} from '@/types';
import { HAZARD_SEVERITY_LABELS } from '@/types';

// ---- geometry + severity helpers -------------------------------------------

const EARTH_RADIUS_METERS = 6_371_000;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle (haversine) distance between two {@link Coordinates}, in meters.
 * Used both to snap origin/destination to the nearest node and to decide which
 * nodes fall inside an {@link AvoidancePolicy} hazard radius.
 */
export function haversineMeters(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Compare two severity labels by their ordinal position in
 * {@link HAZARD_SEVERITY_LABELS} (low < moderate < high < critical). Returns a
 * negative/zero/positive number, mirroring `Array.prototype.sort` semantics.
 */
export function compareSeverity(a: HazardSeverityLabel, b: HazardSeverityLabel): number {
  return HAZARD_SEVERITY_LABELS.indexOf(a) - HAZARD_SEVERITY_LABELS.indexOf(b);
}

/** True iff `label` is at or above `threshold` in ordinal severity. */
const meetsThreshold = (label: HazardSeverityLabel, threshold: HazardSeverityLabel): boolean =>
  compareSeverity(label, threshold) >= 0;

// ---- inputs ----------------------------------------------------------------

/**
 * A single active hazard the policy may route around. Only the fields routing
 * needs are required (location + severity); the Edge Function maps full
 * `Hazard` rows down to this shape.
 */
export interface RoutableHazard {
  readonly location: Coordinates;
  readonly severityLabel: HazardSeverityLabel;
}

/**
 * The cost added to any edge touching a soft-penalized node. Chosen large
 * enough to reliably divert routing toward a hazard-free alternative when one
 * exists, while still letting the route pass THROUGH the hazard when it is the
 * only connection (soft_penalty never disconnects the graph).
 */
const SOFT_PENALTY_COST = 1_000_000;

// ---- internal helpers ------------------------------------------------------

/** Snap a coordinate to the id of the nearest graph node (or null if empty). */
function nearestNodeId(point: Coordinates, nodes: readonly RouteGraphNode[]): string | null {
  let bestId: string | null = null;
  let bestDistance = Infinity;
  for (const node of nodes) {
    const distance = haversineMeters(point, node.location);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestId = node.id;
    }
  }
  return bestId;
}

/** A node fails routing constraints if it is not step-free when required. */
function nodeViolatesConstraints(
  node: RouteGraphNode,
  constraints: RouteConstraints,
): boolean {
  return constraints.requireStepFree && !node.accessibility.isStepFree;
}

/**
 * Determine which nodes are "near" an at/above-threshold hazard under the
 * {@link AvoidancePolicy}. Returns the set of offending node ids.
 */
function nodesNearHazards(
  nodes: readonly RouteGraphNode[],
  hazards: readonly RoutableHazard[],
  policy: AvoidancePolicy,
): Set<string> {
  const near = new Set<string>();
  for (const node of nodes) {
    for (const hazard of hazards) {
      if (!meetsThreshold(hazard.severityLabel, policy.severityThreshold)) {
        continue; // below threshold → ignored entirely
      }
      if (haversineMeters(node.location, hazard.location) <= policy.radiusMeters) {
        near.add(node.id);
        break;
      }
    }
  }
  return near;
}

interface PreparedGraph {
  /** Nodes that remain traversable after applying constraints + hard_block. */
  readonly usableNodeIds: Set<string>;
  /** Adjacency list keyed by node id → outgoing usable edges. */
  readonly adjacency: Map<string, readonly RouteEdge[]>;
  /** Every node that was removed, with the reason it was bypassed. */
  readonly bypassed: readonly BypassedNode[];
  /** Per-node cost surcharge (soft_penalty). Absent → 0. */
  readonly nodePenalty: Map<string, number>;
}

/**
 * Apply constraints + avoidance policy to the raw graph, producing the pruned
 * adjacency structure Dijkstra runs over, plus the list of bypassed nodes.
 */
function prepareGraph(
  nodes: readonly RouteGraphNode[],
  edges: readonly RouteEdge[],
  hazards: readonly RoutableHazard[],
  constraints: RouteConstraints,
  policy: AvoidancePolicy,
): PreparedGraph {
  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
  const allowedModes = new Set(constraints.allowedModes);
  const hazardNodeIds = nodesNearHazards(nodes, hazards, policy);

  const bypassed: BypassedNode[] = [];
  const usableNodeIds = new Set<string>();
  const nodePenalty = new Map<string, number>();

  // 1. Classify every node: inaccessible (constraints) and hazard hard_block
  //    both remove the node; soft_penalty keeps it but records a surcharge.
  for (const node of nodes) {
    if (nodeViolatesConstraints(node, constraints)) {
      bypassed.push({ nodeId: node.id, reason: 'inaccessible' });
      continue;
    }
    if (hazardNodeIds.has(node.id) && policy.mode === 'hard_block') {
      bypassed.push({ nodeId: node.id, reason: 'hazard_hard_block' });
      continue;
    }
    usableNodeIds.add(node.id);
    if (hazardNodeIds.has(node.id) && policy.mode === 'soft_penalty') {
      nodePenalty.set(node.id, SOFT_PENALTY_COST);
    }
  }

  // 2. Build the adjacency list over edges whose endpoints are both usable and
  //    whose traversal mode is allowed. A disallowed-mode edge records a
  //    'mode_not_allowed' bypass for the endpoints it isolates.
  const adjacency = new Map<string, RouteEdge[]>();
  const modeBypassed = new Set<string>();
  for (const edge of edges) {
    const fromNode = nodeById.get(edge.from);
    const toNode = nodeById.get(edge.to);
    if (fromNode === undefined || toNode === undefined) {
      continue; // dangling edge → skip
    }
    if (!usableNodeIds.has(edge.from) || !usableNodeIds.has(edge.to)) {
      continue; // one endpoint was pruned by constraints/hard_block
    }
    if (!allowedModes.has(edge.mode)) {
      modeBypassed.add(edge.from);
      modeBypassed.add(edge.to);
      continue;
    }
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge);
    adjacency.set(edge.from, list);
  }

  // A node whose ONLY incident edges were all disallowed-mode has no usable
  // connection; record it as mode_not_allowed (deduped against other bypasses).
  const alreadyBypassed = new Set(bypassed.map((b) => b.nodeId));
  for (const nodeId of modeBypassed) {
    if (alreadyBypassed.has(nodeId)) {
      continue;
    }
    const hasUsableEdge =
      (adjacency.get(nodeId)?.length ?? 0) > 0 ||
      [...adjacency.values()].some((list) => list.some((e) => e.to === nodeId));
    if (!hasUsableEdge) {
      bypassed.push({ nodeId, reason: 'mode_not_allowed' });
    }
  }

  return { usableNodeIds, adjacency, bypassed, nodePenalty };
}

/**
 * Classic Dijkstra shortest path over the prepared adjacency list. Edge weight
 * is `edge.cost` plus any soft-penalty surcharge on the destination node.
 * Returns the ordered list of node ids from `start` to `goal`, or null if goal
 * is unreachable.
 *
 * The graph is small (a building's nodes), so a linear-scan frontier is plenty;
 * no binary heap needed.
 */
function dijkstra(
  start: string,
  goal: string,
  graph: PreparedGraph,
): { readonly path: readonly string[]; readonly cost: number } | null {
  const distance = new Map<string, number>();
  const previous = new Map<string, string>();
  const visited = new Set<string>();
  distance.set(start, 0);

  for (;;) {
    // Pick the unvisited node with the smallest tentative distance.
    let current: string | null = null;
    let currentDistance = Infinity;
    for (const [nodeId, dist] of distance) {
      if (!visited.has(nodeId) && dist < currentDistance) {
        currentDistance = dist;
        current = nodeId;
      }
    }
    if (current === null) {
      break; // no reachable unvisited nodes remain
    }
    if (current === goal) {
      break; // shortest distance to goal finalized
    }
    visited.add(current);

    for (const edge of graph.adjacency.get(current) ?? []) {
      if (visited.has(edge.to)) {
        continue;
      }
      const penalty = graph.nodePenalty.get(edge.to) ?? 0;
      const tentative = currentDistance + edge.cost + penalty;
      if (tentative < (distance.get(edge.to) ?? Infinity)) {
        distance.set(edge.to, tentative);
        previous.set(edge.to, current);
      }
    }
  }

  if (!distance.has(goal)) {
    return null; // goal unreachable
  }

  // Reconstruct the path by walking predecessors back from the goal.
  const path: string[] = [];
  let step: string | undefined = goal;
  while (step !== undefined) {
    path.unshift(step);
    step = previous.get(step);
  }
  return { path, cost: distance.get(goal) ?? 0 };
}

// ---- public service --------------------------------------------------------

/** The accessible routing service. Pure; no I/O. */
export interface RoutingService {
  computeRoute(
    request: RouteRequest,
    nodes: readonly RouteGraphNode[],
    edges: readonly RouteEdge[],
    hazards: readonly RoutableHazard[],
  ): RouteResponse;
}

/**
 * Create a {@link RoutingService}. Stateless, so this is really a namespace for
 * the pure `computeRoute` entry point; it mirrors the `makeXService` factory
 * pattern used by the other services for consistency.
 */
export function makeRoutingService(): RoutingService {
  return {
    computeRoute(
      request: RouteRequest,
      nodes: readonly RouteGraphNode[],
      edges: readonly RouteEdge[],
      hazards: readonly RoutableHazard[],
    ): RouteResponse {
      const graph = prepareGraph(
        nodes,
        edges,
        hazards,
        request.constraints,
        request.avoidance,
      );

      // Snap origin/destination to the nearest USABLE node. Snapping against
      // pruned nodes keeps the entry/exit points routable.
      const usableNodes = nodes.filter((n) => graph.usableNodeIds.has(n.id));
      const startId = nearestNodeId(request.origin, usableNodes);
      const goalId = nearestNodeId(request.destination, usableNodes);

      if (startId === null || goalId === null) {
        // No usable node to anchor on (everything pruned / empty graph).
        return { status: 'no_accessible_route', bypassedNodes: graph.bypassed };
      }

      const result = dijkstra(startId, goalId, graph);
      if (result === null) {
        // Origin and destination are disconnected under the active policy.
        return { status: 'no_accessible_route', bypassedNodes: graph.bypassed };
      }

      const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
      const path = result.path
        .map((id) => nodeById.get(id))
        .filter((n): n is RouteGraphNode => n !== undefined);

      return {
        status: 'route_found',
        path,
        totalCost: result.cost,
        bypassedNodes: graph.bypassed,
      };
    },
  };
}
