import {
  clearRefreshToken,
  readRefreshToken,
  writeRefreshToken,
} from '@/services/session-store';

export const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? '';

export type Member = {
  id: string;
  email: string;
  role: 'member' | 'admin';
  mobility_preference: boolean;
};

export type Session = {
  accessToken: string;
  refreshToken: string;
  member: Member;
};

type MemberSessionBody = {
  access_token: string;
  refresh_token: string;
  member: Member;
};

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

type SessionListener = (session: Session | null) => void;

let accessToken: string | null = null;
let refreshTask: Promise<Session | null> | null = null;
let listener: SessionListener | null = null;

/** Registers the callback told about session changes. */
export function setSessionListener(next: SessionListener | null): void {
  listener = next;
}

function publish(session: Session | null): void {
  listener?.(session);
}

function toSession(body: MemberSessionBody): Session {
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    member: body.member,
  };
}

function join(path: string): string {
  return `${apiUrl.replace(/\/$/, '')}${path}`;
}

/** Reads a member-facing message from a failed API response. */
export async function errorDetail(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (payload && typeof payload === 'object' && 'detail' in payload) {
      const message = detailMessage((payload as { detail: unknown }).detail);
      if (message) return message;
    }
  } catch {
    // The body was empty or not JSON.
  }
  return `Request failed (${response.status}).`;
}

function detailMessage(detail: unknown): string | null {
  if (typeof detail === 'string' && detail.trim().length > 0) return detail;
  if (!Array.isArray(detail)) return null;
  const parts = detail
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object' && 'msg' in item && typeof item.msg === 'string') {
        return item.msg.trim();
      }
      return '';
    })
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts.join(' ') : null;
}

/** Sentence to show for a failed call. Hides raw browser errors. */
export function failureMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message.trim().length > 0) return error.message;
  return fallback;
}

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  if (!apiUrl) throw new ApiError(0, 'The API address is not configured.');
  try {
    return await fetch(join(path), init);
  } catch {
    throw new ApiError(0, 'Could not reach the server.');
  }
}

async function doRefresh(): Promise<Session | null> {
  const stored = await readRefreshToken();
  if (!stored || !apiUrl) {
    accessToken = null;
    return null;
  }
  const response = await send('/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: stored }),
  });
  if (!response.ok) {
    accessToken = null;
    await clearRefreshToken();
    publish(null);
    return null;
  }
  const session = toSession((await response.json()) as MemberSessionBody);
  accessToken = session.accessToken;
  await writeRefreshToken(session.refreshToken);
  publish(session);
  return session;
}

/**
 * Exchanges the saved refresh token for a session.
 * Only one refresh runs at a time: Supabase replaces the refresh token
 * on every use, and reusing an old one can revoke the whole session.
 */
export function refreshSession(): Promise<Session | null> {
  if (refreshTask) return refreshTask;
  refreshTask = doRefresh().finally(() => {
    refreshTask = null;
  });
  return refreshTask;
}

type ApiInit = RequestInit & { retry?: boolean };

/** Calls the API. A 401 refreshes once and retries the request. */
export async function apiFetch(path: string, init: ApiInit = {}): Promise<Response> {
  const { retry, ...request } = init;
  const headers = new Headers(request.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const response = await send(path, { ...request, headers });
  if (response.status !== 401 || retry) return response;
  const session = await refreshSession();
  if (!session) throw new ApiError(401, 'Invalid or expired token.');
  return apiFetch(path, { ...request, retry: true });
}

async function openSession(path: string, email: string, password: string): Promise<Session> {
  const response = await send(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new ApiError(response.status, await errorDetail(response));
  const session = toSession((await response.json()) as MemberSessionBody);
  accessToken = session.accessToken;
  await writeRefreshToken(session.refreshToken);
  publish(session);
  return session;
}

/** Signs in and saves the session. */
export function signIn(email: string, password: string): Promise<Session> {
  return openSession('/auth/login', email, password);
}

/** Registers a member and saves the session. */
export function register(email: string, password: string): Promise<Session> {
  return openSession('/auth/register', email, password);
}

/** Asks for a reset mail. The reply does not say whether the address exists. */
export async function forgotPassword(email: string): Promise<string> {
  const response = await send('/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) throw new ApiError(response.status, await errorDetail(response));
  const body = (await response.json()) as { detail?: string };
  return body.detail ?? 'If that address is registered, a reset mail is on its way.';
}

/** Sets a new password with the token from a reset link. Does not sign in. */
export async function resetPassword(token: string, password: string): Promise<void> {
  const response = await send('/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password }),
  });
  if (!response.ok) throw new ApiError(response.status, await errorDetail(response));
}

/** Revokes this session and forgets the saved refresh token. */
export async function signOut(): Promise<void> {
  try {
    if (accessToken && apiUrl) {
      await send('/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    }
  } catch {
    // The device still forgets the session when the server cannot be reached.
  } finally {
    accessToken = null;
    await clearRefreshToken();
    publish(null);
  }
}
