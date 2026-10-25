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
  /** Passage interference the member confirmed, from 0 through 100. */
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

/** Maps a stored 0–100 score onto the 1–10 pin color scale. */
export function pinSeverity(score: number): number {
  return Math.max(1, Math.min(10, Math.round(score / 10)));
}

async function readSeverity(hazardId: string): Promise<number | null> {
  try {
    const response = await apiFetch(`/hazards/${hazardId}`);
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || !('severity_score' in body)) return null;
    const score = (body as { severity_score: unknown }).severity_score;
    if (typeof score !== 'number' || score < 0 || score > 100) return null;
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

