/**
 * Unit tests for the server-only accessible routing service
 * (`src/server/services/routing-service.ts`).
 *
 * The service is a PURE Dijkstra search over a hand-injected route graph, so
 * these tests build small, readable fixtures and assert the full avoidance /
 * constraint behavior from the design's routingService contract:
 *   - baseline shortest path with no hazards
 *   - soft_penalty diverts to an alternative (and passes THROUGH when there is
 *     no alternative)
 *   - hard_block prunes a node on the only-direct path, forcing a detour, and
 *     records it in bypassedNodes with reason 'hazard_hard_block'
 *   - hard_block with no alternative → status 'no_accessible_route'
 *   - requireStepFree excludes a non-step-free node ('inaccessible')
 *   - a disallowed traversal mode is bypassed ('mode_not_allowed')
 *   - severity threshold: a hazard BELOW the threshold does not affect routing;
 *     AT/ABOVE does
 *
 * Also exercises the two pure helpers (haversine distance, severity ordinal).
 *
 * Validates: Requirements 4.2, 4.4, 4.5
 */

import type {
  Coordinates,
  FloorId,
  NodeAccessibility,
  RouteConstraints,
  RouteEdge,
  RouteGraphNode,
  RouteRequest,
  TraversalMode,
} from '@/types';
import {
  compareSeverity,
  haversineMeters,
  makeRoutingService,
  type RoutableHazard,
} from '@/server/services/routing-service';

const FLOOR = 'floor-1' as FloorId;

const ACCESSIBLE: NodeAccessibility = {
  wheelchairAccessible: true,
  hasTactilePaving: true,
  isStepFree: true,
};

/** Build a graph node at the given coordinate with sensible accessible defaults. */
function node(
  id: string,
  latitude: number,
  longitude: number,
  overrides: Partial<NodeAccessibility> = {},
): RouteGraphNode {
  return {
    id,
    location: { latitude, longitude },
    floorId: FLOOR,
    kind: 'waypoint',
    accessibility: { ...ACCESSIBLE, ...overrides },
  };
}

/** Build a bidirectional pair of edges (undirected traversal) between two nodes. */
function biEdge(a: string, b: string, cost: number, mode: TraversalMode = 'walk'): RouteEdge[] {
  return [
    { from: a, to: b, cost, mode },
    { from: b, to: a, cost, mode },
  ];
}

const defaultConstraints: RouteConstraints = {
  requireStepFree: false,
  allowedModes: ['walk', 'wheelchair', 'elevator', 'ramp'],
};

function request(overrides: Partial<RouteRequest> = {}): RouteRequest {
  const origin: Coordinates = { latitude: 0, longitude: 0 };
  const destination: Coordinates = { latitude: 0, longitude: 0.0003 };
  return {
    origin,
    destination,
    constraints: defaultConstraints,
    avoidance: { severityThreshold: 'high', radiusMeters: 25, mode: 'soft_penalty' },
    ...overrides,
  };
}

const service = makeRoutingService();

// --- fixture: a diamond graph -----------------------------------------------
//
//        B (top, cheap)
//      /   \
//    A       D
//      \   /
//        C (bottom, pricey)
//
// A→B→D total 2, A→C→D total 6. Baseline picks the B path. We place A at the
// origin and D at the destination coordinate so snapping anchors there.

const A = node('A', 0, 0);
const B = node('B', 0.0002, 0.00015); // ~north-ish; a hazard will sit near here
const C = node('C', -0.0002, 0.00015);
const D = node('D', 0, 0.0003);
const diamondNodes: RouteGraphNode[] = [A, B, C, D];
const diamondEdges: RouteEdge[] = [
  ...biEdge('A', 'B', 1),
  ...biEdge('B', 'D', 1),
  ...biEdge('A', 'C', 3),
  ...biEdge('C', 'D', 3),
];

describe('routing helpers', () => {
  test('haversineMeters returns ~0 for identical points', () => {
    expect(haversineMeters({ latitude: 1, longitude: 1 }, { latitude: 1, longitude: 1 })).toBeCloseTo(0, 5);
  });

  test('haversineMeters measures a known-ish distance (~111km per degree lat)', () => {
    const meters = haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 });
    expect(meters).toBeGreaterThan(110_000);
    expect(meters).toBeLessThan(112_000);
  });

  test('compareSeverity orders low < moderate < high < critical', () => {
    expect(compareSeverity('low', 'critical')).toBeLessThan(0);
    expect(compareSeverity('critical', 'low')).toBeGreaterThan(0);
    expect(compareSeverity('high', 'high')).toBe(0);
  });
});

describe('routingService.computeRoute', () => {
  test('baseline: no hazards → cheapest path A→B→D', () => {
    const res = service.computeRoute(request(), diamondNodes, diamondEdges, []);
    expect(res.status).toBe('route_found');
    if (res.status !== 'route_found') return;
    expect(res.path.map((n) => n.id)).toEqual(['A', 'B', 'D']);
    expect(res.totalCost).toBe(2);
    expect(res.bypassedNodes).toHaveLength(0);
  });

  test('soft_penalty: a high hazard near B diverts routing to the C path', () => {
    const hazards: RoutableHazard[] = [{ location: B.location, severityLabel: 'high' }];
    const res = service.computeRoute(
      request({ avoidance: { severityThreshold: 'high', radiusMeters: 25, mode: 'soft_penalty' } }),
      diamondNodes,
      diamondEdges,
      hazards,
    );
    expect(res.status).toBe('route_found');
    if (res.status !== 'route_found') return;
    expect(res.path.map((n) => n.id)).toEqual(['A', 'C', 'D']);
    expect(res.totalCost).toBe(6);
    // soft_penalty never records bypassed nodes — it only reweights.
    expect(res.bypassedNodes).toHaveLength(0);
  });

  test('soft_penalty with no alternative: route still passes THROUGH the hazard', () => {
    // Linear graph A→B→D only; B is penalized but is the sole connection.
    const linearNodes = [A, B, D];
    const linearEdges = [...biEdge('A', 'B', 1), ...biEdge('B', 'D', 1)];
    const hazards: RoutableHazard[] = [{ location: B.location, severityLabel: 'critical' }];
    const res = service.computeRoute(
      request({ avoidance: { severityThreshold: 'high', radiusMeters: 25, mode: 'soft_penalty' } }),
      linearNodes,
      linearEdges,
      hazards,
    );
    expect(res.status).toBe('route_found');
    if (res.status !== 'route_found') return;
    expect(res.path.map((n) => n.id)).toEqual(['A', 'B', 'D']);
    // Cost includes the soft penalty surcharge for passing through B.
    expect(res.totalCost).toBeGreaterThan(2);
  });

  test('hard_block: a critical hazard near B prunes it and forces the C detour', () => {
    const hazards: RoutableHazard[] = [{ location: B.location, severityLabel: 'critical' }];
    const res = service.computeRoute(
      request({ avoidance: { severityThreshold: 'high', radiusMeters: 25, mode: 'hard_block' } }),
      diamondNodes,
      diamondEdges,
      hazards,
    );
    expect(res.status).toBe('route_found');
    if (res.status !== 'route_found') return;
    expect(res.path.map((n) => n.id)).toEqual(['A', 'C', 'D']);
    expect(res.totalCost).toBe(6);
    expect(res.bypassedNodes).toContainEqual({ nodeId: 'B', reason: 'hazard_hard_block' });
  });

  test('hard_block with no alternative → no_accessible_route', () => {
    // Linear A→B→D; blocking B disconnects A from D.
    const linearNodes = [A, B, D];
    const linearEdges = [...biEdge('A', 'B', 1), ...biEdge('B', 'D', 1)];
    const hazards: RoutableHazard[] = [{ location: B.location, severityLabel: 'critical' }];
    const res = service.computeRoute(
      request({ avoidance: { severityThreshold: 'high', radiusMeters: 25, mode: 'hard_block' } }),
      linearNodes,
      linearEdges,
      hazards,
    );
    expect(res.status).toBe('no_accessible_route');
    expect(res.bypassedNodes).toContainEqual({ nodeId: 'B', reason: 'hazard_hard_block' });
  });

  test('constraints: requireStepFree excludes a non-step-free node', () => {
    // Make B non-step-free; with requireStepFree the route must take C.
    const stepNodes = [A, node('B', 0.0002, 0.00015, { isStepFree: false }), C, D];
    const res = service.computeRoute(
      request({ constraints: { requireStepFree: true, allowedModes: defaultConstraints.allowedModes } }),
      stepNodes,
      diamondEdges,
      [],
    );
    expect(res.status).toBe('route_found');
    if (res.status !== 'route_found') return;
    expect(res.path.map((n) => n.id)).toEqual(['A', 'C', 'D']);
    expect(res.bypassedNodes).toContainEqual({ nodeId: 'B', reason: 'inaccessible' });
  });

  test('constraints: a disallowed traversal mode isolates a node (mode_not_allowed)', () => {
    // The only edges touching B are 'elevator' mode; disallow elevator.
    const elevatorEdges: RouteEdge[] = [
      ...biEdge('A', 'B', 1, 'elevator'),
      ...biEdge('B', 'D', 1, 'elevator'),
      ...biEdge('A', 'C', 3, 'walk'),
      ...biEdge('C', 'D', 3, 'walk'),
    ];
    const res = service.computeRoute(
      request({ constraints: { requireStepFree: false, allowedModes: ['walk', 'wheelchair', 'ramp'] } }),
      diamondNodes,
      elevatorEdges,
      [],
    );
    expect(res.status).toBe('route_found');
    if (res.status !== 'route_found') return;
    expect(res.path.map((n) => n.id)).toEqual(['A', 'C', 'D']);
    expect(res.bypassedNodes).toContainEqual({ nodeId: 'B', reason: 'mode_not_allowed' });
  });

  test('severity threshold: a hazard BELOW the threshold does not affect routing', () => {
    // 'moderate' hazard near B, threshold 'high' → ignored, cheapest path kept.
    const hazards: RoutableHazard[] = [{ location: B.location, severityLabel: 'moderate' }];
    const res = service.computeRoute(
      request({ avoidance: { severityThreshold: 'high', radiusMeters: 25, mode: 'hard_block' } }),
      diamondNodes,
      diamondEdges,
      hazards,
    );
    expect(res.status).toBe('route_found');
    if (res.status !== 'route_found') return;
    expect(res.path.map((n) => n.id)).toEqual(['A', 'B', 'D']);
    expect(res.bypassedNodes).toHaveLength(0);
  });

  test('severity threshold: a hazard AT the threshold DOES affect routing', () => {
    // 'high' hazard near B, threshold 'high' → blocked under hard_block.
    const hazards: RoutableHazard[] = [{ location: B.location, severityLabel: 'high' }];
    const res = service.computeRoute(
      request({ avoidance: { severityThreshold: 'high', radiusMeters: 25, mode: 'hard_block' } }),
      diamondNodes,
      diamondEdges,
      hazards,
    );
    expect(res.status).toBe('route_found');
    if (res.status !== 'route_found') return;
    expect(res.path.map((n) => n.id)).toEqual(['A', 'C', 'D']);
    expect(res.bypassedNodes).toContainEqual({ nodeId: 'B', reason: 'hazard_hard_block' });
  });

  test('a hazard outside the radius does not affect routing', () => {
    // High hazard but far from any node (radius 25m, hazard ~several hundred m away).
    const hazards: RoutableHazard[] = [
      { location: { latitude: 0.01, longitude: 0.01 }, severityLabel: 'critical' },
    ];
    const res = service.computeRoute(
      request({ avoidance: { severityThreshold: 'high', radiusMeters: 25, mode: 'hard_block' } }),
      diamondNodes,
      diamondEdges,
      hazards,
    );
    expect(res.status).toBe('route_found');
    if (res.status !== 'route_found') return;
    expect(res.path.map((n) => n.id)).toEqual(['A', 'B', 'D']);
    expect(res.bypassedNodes).toHaveLength(0);
  });
});
