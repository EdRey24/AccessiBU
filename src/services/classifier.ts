/**
 * AccessiBU hazard classifier client.
 *
 * Preview classifier for reports that are not stored through the report API.
 * A Floor 2 photo is stored by submitPhotoReport, which classifies the image.
 * This client sends the PHOTO, the member's DESCRIPTION, and the resolved
 * SPATIAL CONTEXT. Hazard type and severity come from the description and
 * the image together.
 *
 * Contract (POST multipart/form-data to ${EXPO_PUBLIC_API_URL}/classify):
 *   - field "image":       the captured photo (file)
 *   - field "description": what the member wrote
 *   - field "context":     JSON string of SpatialContext (see constants/hazards.ts)
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
import { ApiError, apiFetch, apiUrl, errorDetail } from '@/services/api';
import { appendPhoto } from '@/services/photo-form';

type ClassifierPayload = {
  type?: unknown;
  severity?: unknown;
  baseSeverity?: unknown;
  locationBonus?: unknown;
  description?: unknown;
  reason?: unknown;
};

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
  context: SpatialContext,
  description: string,
): Promise<ClassifierResult> {
  if (!apiUrl) throw new ApiError(0, 'The API address is not configured.');
  if (!photoUri) throw new ApiError(0, 'A photo is required.');
  if (!description.trim()) throw new ApiError(0, 'A description is required.');
  return callBackend(photoUri, context, description.trim());
}

async function callBackend(
  photoUri: string,
  context: SpatialContext,
  description: string,
): Promise<ClassifierResult> {
  const form = new FormData();
  await appendPhoto(form, photoUri);
  form.append('description', description);
  form.append('context', JSON.stringify(context));

  const res = await apiFetch('/classify', { method: 'POST', body: form });
  if (!res.ok) throw new ApiError(res.status, await errorDetail(res));
  let data: ClassifierPayload;
  try {
    data = (await res.json()) as ClassifierPayload;
  } catch {
    throw new ApiError(res.status, 'The classification could not be read.');
  }
  if (typeof data.type !== 'string' || typeof data.severity !== 'number') {
    throw new ApiError(res.status, 'The classification could not be read.');
  }
  return {
    type: data.type as HazardType,
    severity: clamp(data.severity),
    baseSeverity: clamp(typeof data.baseSeverity === 'number' ? data.baseSeverity : data.severity),
    locationBonus: typeof data.locationBonus === 'number' ? data.locationBonus : 0,
    description: typeof data.description === 'string' ? data.description : '',
    reason: typeof data.reason === 'string' ? data.reason : '',
  };
}

function clamp(n: number): number {
  return Math.max(1, Math.min(10, Math.round(n)));
}
