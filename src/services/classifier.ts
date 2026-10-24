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
 *
 * If EXPO_PUBLIC_API_URL is unset, a local mock stands in so the app stays
 * demoable end-to-end. A configured API never falls back to the mock.
 */

import {
  type HazardType,
  type SpatialContext,
  proximityToFeatures,
} from '@/constants/hazards';
import { apiFetch, apiUrl } from '@/services/api';
import { appendPhoto } from '@/services/photo-form';

export type ClassifierResult = {
  type: HazardType;
  severity: number;
  baseSeverity: number;
  locationBonus: number;
  description: string;
  reason: string;
  /** True when this came from the real backend, false for the local mock. */
  fromBackend: boolean;
};

export async function classifyHazard(
  photoUri: string | null,
  context: SpatialContext
): Promise<ClassifierResult> {
  if (!apiUrl) return mockClassify(photoUri, context);
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
    fromBackend: true,
  };
}

/** Local stand-in mirroring the backend's expected behavior. */
function mockClassify(photoUri: string | null, context: SpatialContext): Promise<ClassifierResult> {
  const samples: { type: HazardType; base: number; description: string }[] = [
    { type: 'Spill', base: 5, description: 'Liquid spill detected — slip risk in a walking path.' },
    { type: 'Wet floor', base: 3, description: 'Wet floor surface detected; proceed with caution.' },
    { type: 'Blocked path', base: 6, description: 'Obstruction blocking an accessible route.' },
    { type: 'Debris', base: 4, description: 'Loose debris detected on the ground.' },
    { type: 'Broken elevator', base: 8, description: 'Elevator appears out of service — accessibility impact.' },
    { type: 'Lighting out', base: 3, description: 'Low lighting / outage detected in this area.' },
  ];
  const seed = (photoUri ?? 'manual').length;
  const pick = samples[seed % samples.length];

  // Apply the same location-aware logic the backend would, using the context.
  const prox = proximityToFeatures(context.floor, context.pin);
  let bonus = 0;
  let reason = 'Open area — standard severity.';
  if (prox.nearest) {
    if (prox.distance <= 0.06) {
      bonus = 3;
      reason = `Directly beside ${prox.nearest.label.toLowerCase()} — critical egress hazard.`;
    } else if (prox.distance <= 0.12) {
      bonus = 2;
      reason = `Close to ${prox.nearest.label.toLowerCase()} — elevated risk.`;
    } else if (prox.distance <= 0.22) {
      bonus = 1;
      reason = `Near ${prox.nearest.label.toLowerCase()}.`;
    }
  }
  const result: ClassifierResult = {
    type: pick.type,
    baseSeverity: pick.base,
    locationBonus: bonus,
    severity: clamp(pick.base + bonus),
    description: pick.description,
    reason,
    fromBackend: false,
  };
  return new Promise((resolve) => setTimeout(() => resolve(result), 1200));
}

function clamp(n: number): number {
  return Math.max(1, Math.min(10, Math.round(n)));
}
