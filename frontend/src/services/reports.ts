/**
 * Stores a photo report.
 *
 * POST /reports/photo takes the image and the place. Classification fills
 * the hazard type, category, summary, and severity. A confirmed type and
 * severity replace the vision values. The severity is read back from the
 * hazard, because the photo report does not carry it.
 */

import type { StoredHazardType } from '@/constants/hazards';
import { ApiError, apiFetch, apiUrl, errorDetail } from '@/services/api';
import { readDataUrl } from '@/services/hazards';
import { appendPhoto } from '@/services/photo-form';

const STORED_HAZARD_TYPES: readonly StoredHazardType[] = [
  'spill',
  'blockage',
  'elevator',
  'entrance',
  'walking_surface',
  'other',
];

export type StoredPhotoReport = {
  reportId: string;
  hazardId: string;
  hazardType: StoredHazardType;
  category: number;
  summary: string;
  severityScore: number | null;
  createdAt: number;
};

type PhotoReportBody = {
  id: string;
  hazard_id: string;
  hazard_type: StoredHazardType;
  category: number;
  summary: string;
  created_at: string;
};

/** Stores one photo as a new hazard at the given coordinate. */
export async function submitPhotoReport(input: {
  uri: string;
  latitude: number;
  longitude: number;
  floor?: number | null;
  position?: { x: number; y: number } | null;
  description?: string | null;
  /** Type the member confirmed after the preview. */
  hazardType?: StoredHazardType | null;
  /** Passage interference the member confirmed, from 1 through 10. */
  severityScore?: number | null;
  /**
   * False stores the photo as a plain attachment: no vision call, and the
   * member's type, severity, and description are kept as entered.
   */
  classify?: boolean;
  /** Numeric code stored with an unclassified photo. */
  category?: number | null;
}): Promise<StoredPhotoReport> {
  if (!apiUrl) throw new ApiError(0, 'The API address is not configured.');

  const form = new FormData();
  await appendPhoto(form, input.uri);
  form.append('latitude', String(input.latitude));
  form.append('longitude', String(input.longitude));
  if (input.floor != null) form.append('floor', String(input.floor));
  if (input.position) {
    form.append('position_x', String(input.position.x));
    form.append('position_y', String(input.position.y));
  }
  if (input.description?.trim()) form.append('description', input.description.trim());
  if (input.hazardType) form.append('hazard_type', input.hazardType);
  if (input.severityScore != null) {
    form.append('severity_score', String(input.severityScore));
  }
  if (input.classify === false) form.append('classify', 'false');
  if (input.category != null) form.append('category', String(input.category));

  const response = await apiFetch('/reports/photo', { method: 'POST', body: form });
  if (!response.ok) throw new ApiError(response.status, await errorDetail(response));

  const report = parsePhotoReport(await response.json());
  if (!report) throw new ApiError(response.status, 'The report could not be read.');

  const severityScore = await readSeverity(report.hazard_id);
  const createdAt = Date.parse(report.created_at);
  return {
    reportId: report.id,
    hazardId: report.hazard_id,
    hazardType: report.hazard_type,
    category: report.category,
    summary: report.summary,
    severityScore,
    createdAt: Number.isNaN(createdAt) ? Date.now() : createdAt,
  };
}

/** Keeps a stored severity on the 1–10 pin color scale. */
export function pinSeverity(score: number): number {
  return Math.max(1, Math.min(10, Math.round(score)));
}

async function readSeverity(hazardId: string): Promise<number | null> {
  try {
    const response = await apiFetch(`/hazards/${hazardId}`);
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || !('severity_score' in body)) return null;
    const score = (body as { severity_score: unknown }).severity_score;
    if (typeof score !== 'number' || score < 1 || score > 10) return null;
    return score;
  } catch {
    // The photo report is already stored. A missing score should not fail it.
    return null;
  }
}

function parsePhotoReport(body: unknown): PhotoReportBody | null {
  if (!body || typeof body !== 'object') return null;
  const row = body as Record<string, unknown>;
  if (
    typeof row.id !== 'string' ||
    typeof row.hazard_id !== 'string' ||
    typeof row.hazard_type !== 'string' ||
    !STORED_HAZARD_TYPES.includes(row.hazard_type as StoredHazardType) ||
    typeof row.category !== 'number' ||
    typeof row.summary !== 'string' ||
    typeof row.created_at !== 'string'
  ) {
    return null;
  }
  return {
    id: row.id,
    hazard_id: row.hazard_id,
    hazard_type: row.hazard_type as StoredHazardType,
    category: row.category,
    summary: row.summary,
    created_at: row.created_at,
  };
}


// ---------------------------------------------------------------------------
// A member's own reports. The backend only ever returns, changes, or deletes
// reports that belong to the signed-in member.
// ---------------------------------------------------------------------------

/** One of the signed-in member's reports, with the hazard facts they may edit. */
export type OwnReport = {
  id: string;
  kind: 'photo' | 'text';
  hazardId: string;
  createdAt: number;
  hazardType: StoredHazardType;
  /** What the member wrote, or the photo summary. */
  text: string;
  hasPhoto: boolean;
  hazardStatus: 'open' | 'resolved';
  floor: number | null;
  position: { x: number; y: number } | null;
  /** False once Facilities resolved the hazard. */
  editable: boolean;
  /** False when other members also reported this hazard. */
  canEditLocation: boolean;
};

/** Fields a member can change on their own report. Omitted fields stay as they are. */
export type ReportChanges = {
  description?: string;
  hazardType?: StoredHazardType;
  location?: {
    latitude: number;
    longitude: number;
    floor: number | null;
    position: { x: number; y: number } | null;
  };
};

/** Lists the signed-in member's own reports, newest first. */
export async function listMyReports(): Promise<OwnReport[]> {
  const response = await apiFetch('/reports/mine');
  if (!response.ok) throw new ApiError(response.status, await errorDetail(response));
  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new ApiError(response.status, 'Your reports could not be read.');
  return body.map(parseOwnReport).filter((row): row is OwnReport => row !== null);
}

/** Saves changes to one of the member's own reports. */
export async function updateMyReport(id: string, changes: ReportChanges): Promise<OwnReport> {
  const payload: Record<string, unknown> = {};
  if (changes.description !== undefined) payload.description = changes.description;
  if (changes.hazardType !== undefined) payload.hazard_type = changes.hazardType;
  if (changes.location) {
    payload.location = {
      latitude: changes.location.latitude,
      longitude: changes.location.longitude,
      floor: changes.location.floor,
      position_x: changes.location.position?.x ?? null,
      position_y: changes.location.position?.y ?? null,
    };
  }
  const response = await apiFetch(`/reports/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return readOwnReport(response);
}

/** Replaces the photo on one of the member's own photo reports. */
export async function replaceMyReportPhoto(id: string, uri: string): Promise<OwnReport> {
  const form = new FormData();
  await appendPhoto(form, uri);
  const response = await apiFetch(`/reports/${id}/photo`, { method: 'PUT', body: form });
  return readOwnReport(response);
}

/** Deletes one of the member's own reports. */
export async function deleteMyReport(id: string): Promise<void> {
  const response = await apiFetch(`/reports/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new ApiError(response.status, await errorDetail(response));
}

/** Loads the photo of one of the member's own reports as a data URL, or null. */
export async function loadMyReportPhoto(id: string): Promise<string | null> {
  const response = await apiFetch(`/reports/${id}/photo`);
  if (response.status === 404) return null;
  if (!response.ok) throw new ApiError(response.status, await errorDetail(response));
  return readDataUrl(await response.blob());
}

async function readOwnReport(response: Response): Promise<OwnReport> {
  if (!response.ok) throw new ApiError(response.status, await errorDetail(response));
  const report = parseOwnReport(await response.json());
  if (!report) throw new ApiError(response.status, 'The report could not be read.');
  return report;
}

function parseOwnReport(body: unknown): OwnReport | null {
  if (!body || typeof body !== 'object') return null;
  const row = body as Record<string, unknown>;
  if (
    typeof row.id !== 'string' ||
    (row.kind !== 'photo' && row.kind !== 'text') ||
    typeof row.hazard_id !== 'string' ||
    typeof row.hazard_type !== 'string' ||
    !STORED_HAZARD_TYPES.includes(row.hazard_type as StoredHazardType) ||
    typeof row.text !== 'string' ||
    (row.hazard_status !== 'open' && row.hazard_status !== 'resolved')
  ) {
    return null;
  }
  let position: { x: number; y: number } | null = null;
  if (row.position && typeof row.position === 'object') {
    const p = row.position as Record<string, unknown>;
    if (typeof p.x === 'number' && typeof p.y === 'number') position = { x: p.x, y: p.y };
  }
  const createdAt = typeof row.created_at === 'string' ? Date.parse(row.created_at) : NaN;
  return {
    id: row.id,
    kind: row.kind,
    hazardId: row.hazard_id,
    createdAt: Number.isNaN(createdAt) ? Date.now() : createdAt,
    hazardType: row.hazard_type as StoredHazardType,
    text: row.text,
    hasPhoto: row.has_photo === true,
    hazardStatus: row.hazard_status,
    floor: typeof row.floor === 'number' ? row.floor : null,
    position,
    editable: row.editable === true,
    canEditLocation: row.can_edit_location === true,
  };
}
