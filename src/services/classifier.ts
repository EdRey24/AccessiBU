/**
 * AccessiBU hazard classifier client.
 *
 * Preview classifier for reports that are not stored through the report API.
 * A Floor 2 photo is stored by submitPhotoReport, which classifies the image.
 * This client sends the PHOTO plus the resolved SPATIAL CONTEXT and expects
 * a hazard type, a 1–10 severity, and a short description.
 *
 * Contract (POST multipart/form-data to ${EXPO_PUBLIC_API_URL}/classify):
 *   - field "image":   the captured photo (file)
 *   - field "context": JSON string of SpatialContext (see constants/hazards.ts)
 *
 * Expected JSON response:
 *   {
 *     "type": "Spill",
 *     "severity": 8,              // final, model-assigned (already location-aware)
 *     "baseSeverity": 5,          // optional: image-only score before context
 *     "locationBonus": 3,         // optional: adjustment from spatial context
 *     "description": "Liquid spill beside the north stair — high slip risk.",
 *     "reason": "Within 0.04 of a staircase."   // optional explanation
 *   }
 */

import { type HazardType, type SpatialContext } from '@/constants/hazards';
import { ApiError, apiFetch, apiUrl } from '@/services/api';
import { appendPhoto } from '@/services/photo-form';

export type ClassifierResult = {
  type: HazardType;
  severity: number;
  baseSeverity: number;
  locationBonus: number;
  description: string;
  reason: string;
};

export async function classifyHazard(
  photoUri: string | null,
  context: SpatialContext
): Promise<ClassifierResult> {
  if (!apiUrl) throw new ApiError(0, 'The API address is not configured.');
  if (!photoUri) throw new Error('A photo is required.');
  return callBackend(photoUri, context);
}

async function callBackend(photoUri: string, context: SpatialContext): Promise<ClassifierResult> {
  const form = new FormData();
  await appendPhoto(form, photoUri);
  form.append('context', JSON.stringify(context));

  const res = await apiFetch('/classify', { method: 'POST', body: form });
  if (!res.ok) throw new Error(`classifier ${res.status}`);
  const data = await res.json();
  return {
    type: data.type,
    severity: clamp(data.severity),
    baseSeverity: clamp(data.baseSeverity ?? data.severity),
    locationBonus: data.locationBonus ?? 0,
    description: data.description ?? '',
    reason: data.reason ?? '',
  };
}

function clamp(n: number): number {
  return Math.max(1, Math.min(10, Math.round(n)));
}
