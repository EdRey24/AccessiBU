/**
 * Shared-hazard sync with the backend.
 *
 * `listHazards` pulls every open hazard so each device draws the same pins.
 * `submitTextReport` stores a manual report: it opens a hazard at a real
 * coordinate and saves the member's description. Both go through `apiFetch`,
 * which attaches the bearer token and refreshes it on a 401.
 */

import type {
    Hazard,
    HazardType,
    StoredHazardType,
} from '@/constants/hazards';
import { storedHazardLabel } from '@/constants/hazards';
import { ApiError, apiFetch, apiUrl, errorDetail } from '@/services/api';

/** A hazard row as the backend returns it (GET /hazards). */
type HazardBody = {
  id: string;
  latitude: number;
  longitude: number;
  floor: number | null;
  position: { x: number; y: number } | null;
  status: 'open' | 'resolved';
  created_at: string;
  severity_score: number;
  summary: string | null;
};

/** A stored text report as the backend returns it (POST /reports/text). */
type TextReportBody = {
  id: string;
  hazard_id: string;
  hazard_type: StoredHazardType;
  category: number;
  description: string;
  created_at: string;
};

/** Numeric code stored alongside each backend hazard type. */
const HAZARD_CATEGORY: Record<StoredHazardType, number> = {
  spill: 1,
  blockage: 2,
  elevator: 3,
  entrance: 4,
  walking_surface: 5,
  other: 0,
};

/** Maps a UI hazard type to the backend's stored enum. */
const STORED_FROM_TYPE: Record<HazardType, StoredHazardType> = {
  Spill: 'spill',
  'Blocked path': 'blockage',
  'Broken elevator': 'elevator',
  'Broken door': 'entrance',
  'Wet floor': 'walking_surface',
  Debris: 'blockage',
  'Lighting out': 'other',
  Other: 'other',
};

/** Maps a UI hazard type to the value stored on a report. */
export function storedHazardType(type: HazardType): StoredHazardType {
  return STORED_FROM_TYPE[type];
}

/** Numeric category stored alongside a UI hazard type. */
export function hazardCategory(type: HazardType): number {
  return HAZARD_CATEGORY[STORED_FROM_TYPE[type]];
}

/** Maps the backend's stored enum back to a UI hazard type. */
const TYPE_FROM_STORED: Record<StoredHazardType, HazardType> = {
  spill: 'Spill',
  blockage: 'Blocked path',
  elevator: 'Broken elevator',
  entrance: 'Broken door',
  walking_surface: 'Wet floor',
  other: 'Other',
};

/** Keeps a severity on the 1–10 scale. */
export function severityScoreFromPin(severity: number): number {
  return Math.max(1, Math.min(10, Math.round(severity)));
}

/** Keeps a stored severity on the 1–10 pin color scale. */
export function pinSeverityFromScore(score: number): number {
  return Math.max(1, Math.min(10, Math.round(score)));
}

/** What a manual report needs to open a shared hazard. */
export type TextReportInput = {
  type: HazardType;
  description: string;
  severity: number; // 1–10
  latitude: number;
  longitude: number;
  /** Floor the pin sits on (null when outside / no plan). */
  floor?: number | null;
  /** Normalized pin position on the floor plan (null when none). */
  position?: { x: number; y: number } | null;
};

/** A hazard freshly opened by a manual report, ready for the local store. */
export type SubmittedHazard = {
  hazardId: string;
  hazardType: StoredHazardType;
  summary: string;
  createdAt: number;
  severityScore: number;
};

/** Loads the photo stored for a hazard, or null when it has none. */
export async function loadHazardPhoto(hazardId: string): Promise<string | null> {
  const response = await apiFetch(`/hazards/${hazardId}/photo`);
  if (response.status === 404) return null;
  if (!response.ok) throw new ApiError(response.status, await errorDetail(response));
  return readDataUrl(await response.blob());
}

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Lists every open hazard, mapped into the app's Hazard shape. */
export async function listHazards(): Promise<Hazard[]> {
  const response = await apiFetch('/hazards');
  if (!response.ok) throw new ApiError(response.status, await errorDetail(response));
  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new ApiError(response.status, 'The hazard list could not be read.');
  return body
    .map(parseHazard)
    .filter((row): row is HazardBody => row !== null)
    .map(toHazard);
}

/** Stores a manual report, opening a shared hazard at the coordinate. */
export async function submitTextReport(input: TextReportInput): Promise<SubmittedHazard> {
  if (!apiUrl) throw new ApiError(0, 'The API address is not configured.');
  const hazardType = STORED_FROM_TYPE[input.type];
  const severityScore = severityScoreFromPin(input.severity);
  const response = await apiFetch('/reports/text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hazard_type: hazardType,
      category: HAZARD_CATEGORY[hazardType],
      description: input.description,
      severity_score: severityScore,
      latitude: input.latitude,
      longitude: input.longitude,
      floor: input.floor ?? null,
      position_x: input.position?.x ?? null,
      position_y: input.position?.y ?? null,
    }),
  });
  if (!response.ok) throw new ApiError(response.status, await errorDetail(response));
  const report = parseTextReport(await response.json());
  if (!report) throw new ApiError(response.status, 'The report could not be read.');
  const createdAt = Date.parse(report.created_at);
  return {
    hazardId: report.hazard_id,
    hazardType: report.hazard_type,
    summary: report.description,
    createdAt: Number.isNaN(createdAt) ? Date.now() : createdAt,
    severityScore,
  };
}

/** Builds a local Hazard from a backend hazard row. */
function toHazard(row: HazardBody): Hazard {
  const createdAt = Date.parse(row.created_at);
  return {
    id: row.id,
    type: 'Other',
    severity: pinSeverityFromScore(row.severity_score),
    severityScore: row.severity_score,
    hazardType: null,
    description: row.summary?.trim() ? row.summary : 'Reported hazard',
    location: row.floor !== null ? 'inside' : 'outside',
    floor: row.floor,
    position: row.position,
    method: 'manual',
    photoUri: null,
    createdAt: Number.isNaN(createdAt) ? Date.now() : createdAt,
    spatialContext: null,
    room: null,
    coordinate: { longitude: row.longitude, latitude: row.latitude },
  };
}

/** Human label for a stored hazard type. Re-exported for callers. */
export function labelForStored(hazardType: StoredHazardType): string {
  return storedHazardLabel(hazardType);
}

/** UI hazard type for a stored enum. */
export function typeFromStored(hazardType: StoredHazardType): HazardType {
  return TYPE_FROM_STORED[hazardType];
}

function parseHazard(body: unknown): HazardBody | null {
  if (!body || typeof body !== 'object') return null;
  const row = body as Record<string, unknown>;
  if (
    typeof row.id !== 'string' ||
    typeof row.latitude !== 'number' ||
    typeof row.longitude !== 'number' ||
    (row.status !== 'open' && row.status !== 'resolved') ||
    typeof row.created_at !== 'string' ||
    typeof row.severity_score !== 'number'
  ) {
    return null;
  }
  const floor = typeof row.floor === 'number' ? row.floor : null;
  let position: { x: number; y: number } | null = null;
  if (row.position && typeof row.position === 'object') {
    const p = row.position as Record<string, unknown>;
    if (typeof p.x === 'number' && typeof p.y === 'number') {
      position = { x: p.x, y: p.y };
    }
  }
  return {
    id: row.id,
    latitude: row.latitude,
    longitude: row.longitude,
    floor,
    position,
    status: row.status,
    created_at: row.created_at,
    severity_score: row.severity_score,
    summary: typeof row.summary === 'string' ? row.summary : null,
  };
}

function parseTextReport(body: unknown): TextReportBody | null {
  if (!body || typeof body !== 'object') return null;
  const row = body as Record<string, unknown>;
  if (
    typeof row.id !== 'string' ||
    typeof row.hazard_id !== 'string' ||
    typeof row.hazard_type !== 'string' ||
    typeof row.category !== 'number' ||
    typeof row.description !== 'string' ||
    typeof row.created_at !== 'string'
  ) {
    return null;
  }
  return {
    id: row.id,
    hazard_id: row.hazard_id,
    hazard_type: row.hazard_type as StoredHazardType,
    category: row.category,
    description: row.description,
    created_at: row.created_at,
  };
}

