/**
 * Stores a photo report.
 *
 * POST /reports/photo takes the image and the place. Classification fills
 * the hazard type, category, summary, and severity. The severity is read
 * back from the hazard, because the photo report does not carry it.
 */

import { Platform } from 'react-native';

import type { StoredHazardType } from '@/constants/hazards';
import { ApiError, apiFetch, apiUrl } from '@/services/api';

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
}): Promise<StoredPhotoReport> {
  if (!apiUrl) throw new ApiError(0, 'The API address is not configured.');

  const form = new FormData();
  await appendImage(form, input.uri);
  form.append('latitude', String(input.latitude));
  form.append('longitude', String(input.longitude));

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

async function appendImage(form: FormData, uri: string): Promise<void> {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    if (!response.ok) throw new ApiError(0, 'The photo could not be read.');
    const blob = await response.blob();
    const type = blob.type || 'image/jpeg';
    const extension = type.includes('png') ? 'png' : type.includes('heic') ? 'heic' : 'jpg';
    form.append('image', new File([blob], `hazard.${extension}`, { type }));
    return;
  }
  const lower = uri.toLowerCase();
  const extension = lower.endsWith('.png') ? 'png' : lower.endsWith('.heic') ? 'heic' : 'jpg';
  const type =
    extension === 'png' ? 'image/png' : extension === 'heic' ? 'image/heic' : 'image/jpeg';
  form.append('image', { uri, name: `hazard.${extension}`, type } as unknown as Blob);
}

async function readSeverity(hazardId: string): Promise<number | null> {
  const response = await apiFetch(`/hazards/${hazardId}`);
  if (!response.ok) return null;
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || !('severity_score' in body)) return null;
  const score = (body as { severity_score: unknown }).severity_score;
  if (typeof score !== 'number' || score < 0 || score > 100) return null;
  return score;
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

async function errorDetail(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (payload && typeof payload === 'object' && 'detail' in payload) {
      const detail = (payload as { detail: unknown }).detail;
      if (typeof detail === 'string' && detail.length > 0) return detail;
      if (Array.isArray(detail)) {
        const first = detail.find(
          (item) => item && typeof item === 'object' && 'msg' in item,
        ) as { msg?: unknown } | undefined;
        if (first && typeof first.msg === 'string' && first.msg.length > 0) return first.msg;
      }
    }
  } catch {
    // The body was empty or not JSON.
  }
  return `Request failed (${response.status}).`;
}
