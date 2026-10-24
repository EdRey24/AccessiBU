import type { Coordinates, FloorId } from './geo';
import type { HazardSeverityLabel } from './hazard';

// Accessible-navigation data shapes. The A*/Dijkstra algorithm is OUT OF SCOPE
// here (it's the commit-2 routingService); these are only the data contracts.

export const NODE_KINDS = ['elevator', 'ramp', 'door', 'waypoint'] as const;
export type RouteNodeKind = (typeof NODE_KINDS)[number];

export const TRAVERSAL_MODES = ['walk', 'wheelchair', 'elevator', 'ramp'] as const;
export type TraversalMode = (typeof TRAVERSAL_MODES)[number];

export interface NodeAccessibility {
  readonly wheelchairAccessible: boolean;
  readonly hasTactilePaving: boolean;
  readonly isStepFree: boolean;
}

export interface RouteGraphNode {
  readonly id: string;
  readonly location: Coordinates;
  readonly floorId: FloorId;
  readonly kind: RouteNodeKind;
  readonly accessibility: NodeAccessibility;
}

export interface RouteEdge {
  readonly from: string; // RouteGraphNode.id
  readonly to: string;   // RouteGraphNode.id
  readonly cost: number;
  readonly mode: TraversalMode;
}

/**
 * DECISION: avoidance is CONFIGURABLE per request.
 *  - 'soft_penalty' adds to edge cost near hazards (route may still pass).
 *  - 'hard_block' removes edges within radius of hazards at/above threshold.
 */
export interface AvoidancePolicy {
  readonly severityThreshold: HazardSeverityLabel;
  readonly radiusMeters: number;
  readonly mode: 'soft_penalty' | 'hard_block';
}

export interface RouteConstraints {
  readonly requireStepFree: boolean;
  readonly allowedModes: readonly TraversalMode[];
}

export interface RouteRequest {
  readonly origin: Coordinates;
  readonly destination: Coordinates;
  readonly constraints: RouteConstraints;
  readonly avoidance: AvoidancePolicy;
}

export interface BypassedNode {
  readonly nodeId: string;
  readonly reason: 'hazard_hard_block' | 'inaccessible' | 'mode_not_allowed';
}

/** Discriminated by `status`: a route was found, or none is accessible. */
export type RouteResponse =
  | {
      readonly status: 'route_found';
      readonly path: readonly RouteGraphNode[]; // ordered
      readonly totalCost: number;
      readonly bypassedNodes: readonly BypassedNode[];
    }
  | {
      readonly status: 'no_accessible_route';
      readonly bypassedNodes: readonly BypassedNode[];
    };
