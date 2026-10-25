/**
 * Puts a captured photo on a multipart form.
 *
 * A phone can send the { uri, name, type } object React Native understands.
 * A browser must send a real File, or the API receives the text
 * "[object Object]" and rejects the form.
 */

import { Platform } from 'react-native';

import { ApiError } from '@/services/api';

export async function appendPhoto(form: FormData, uri: string): Promise<void> {
  if (Platform.OS === 'web') {
    let response: Response;
    try {
      response = await fetch(uri);
    } catch {
      throw new ApiError(0, 'The photo could not be read.');
    }
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
