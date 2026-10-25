/**
 * Facilities calls. Every route here needs an admin account: the backend
 * answers 403 to anyone else, so hiding the screen is only a convenience.
 *
 * `listAdminHazards` returns open and resolved hazards. A resolve keeps the
 * hazard and marks it done, and a reopen undoes that. A delete hides it from
 * everyone; the backend keeps the data, so it can be restored.
 */

import type { Hazard, StoredHazardType } from '@/constants/hazards';
import { ApiError, apiFetch, errorDetail } from '@/services/api';
import { pinSeverityFromScore, typeFromStored } from '@/services/hazards';

export type StatusFilter = 'open' | 'resolved' | 'all';

/** A hazard as Facilities sees it (GET /admin/hazards). */
export type AdminHazard = {
  id: string;
  latitude: number;
  longitude: number;
  floor: number | null;
  position: { x: number; y: number } | null;
  status: 'open' | 'resolved';
  createdAt: number;
  severityScore: number;
  summary: string | null;
  hazardType: StoredHazardType | null;
  reportCount: number;
  resolvedAt: number | null;
};

const STORED_TYPES: readonly string[] = [
  'spill',
  'blockage',
  'elevator',
  'entrance',
  'walking_surface',
  'other',
];

/** Loads every hazard Facilities can act on, newest first. */
export async function listAdminHazards(status: StatusFilter = 'all'): Promise<AdminHazard[]> {
  const response = await apiFetch(`/admin/hazards?status=${status}`);
  if (!response.ok) throw new ApiError(response.status, await errorDetail(response));
  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new ApiError(response.status, 'The hazard list could not be read.');
  return body.map(parseAdminHazard).filter((row): row is AdminHazard => row !== null);
}

/** Marks a hazard resolved and returns the updated row. */
export async function resolveAdminHazard(id: string): Promise<AdminHazard> {
  const response = await apiFetch(`/admin/hazards/${id}/resolve`, { method: 'POST' });
  if (!response.ok) throw new ApiError(response.status, await errorDetail(response));
  const row = parseAdminHazard(await response.json());
  if (!row) throw new ApiError(response.status, 'The hazard could not be read.');
  return row;
}

/** Reopens a hazard that was resolved by mistake and returns the updated row. */
export async function reopenAdminHazard(id: string): Promise<AdminHazard> {
  const response = await apiFetch(`/admin/hazards/${id}/reopen`, { method: 'POST' });
  if (!response.ok) throw new ApiError(response.status, await errorDetail(response));
  const row = parseAdminHazard(await response.json());
  if (!row) throw new ApiError(response.status, 'The hazard could not be read.');
  return row;
}

/** Deletes a hazard. Its reports and photos stay on the server. */
export async function deleteAdminHazard(id: string): Promise<void> {
  const response = await apiFetch(`/admin/hazards/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new ApiError(response.status, await errorDetail(response));
}

/** Maps an admin row to the shape the floor plan draws pins from. */
export function toPinHazard(row: AdminHazard): Hazard {
  return {
    id: row.id,
    type: row.hazardType ? typeFromStored(row.hazardType) : 'Other',
    severity: pinSeverityFromScore(row.severityScore),
    severityScore: row.severityScore,
    hazardType: row.hazardType,
    description: row.summary?.trim() ? row.summary : 'Reported hazard',
    location: row.floor !== null ? 'inside' : 'outside',
    floor: row.floor,
    position: row.position,
    method: 'manual',
    photoUri: null,
    createdAt: row.createdAt,
    coordinate: { longitude: row.longitude, latitude: row.latitude },
  };
}

function time(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseAdminHazard(body: unknown): AdminHazard | null {
  if (!body || typeof body !== 'object') return null;
  const row = body as Record<string, unknown>;
  if (
    typeof row.id !== 'string' ||
    typeof row.latitude !== 'number' ||
    typeof row.longitude !== 'number' ||
    (row.status !== 'open' && row.status !== 'resolved') ||
    typeof row.severity_score !== 'number'
  ) {
    return null;
  }
  let position: { x: number; y: number } | null = null;
  if (row.position && typeof row.position === 'object') {
    const p = row.position as Record<string, unknown>;
    if (typeof p.x === 'number' && typeof p.y === 'number') position = { x: p.x, y: p.y };
  }
  return {
    id: row.id,
    latitude: row.latitude,
    longitude: row.longitude,
    floor: typeof row.floor === 'number' ? row.floor : null,
    position,
    status: row.status,
    createdAt: time(row.created_at) ?? Date.now(),
    severityScore: row.severity_score,
    summary: typeof row.summary === 'string' ? row.summary : null,
    hazardType:
      typeof row.hazard_type === 'string' && STORED_TYPES.includes(row.hazard_type)
        ? (row.hazard_type as StoredHazardType)
        : null,
    reportCount: typeof row.report_count === 'number' ? row.report_count : 0,
    resolvedAt: time(row.resolved_at),
  };
}
