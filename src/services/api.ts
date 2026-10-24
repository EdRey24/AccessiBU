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

async function errorDetail(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (payload && typeof payload === 'object' && 'detail' in payload) {
      const detail = (payload as { detail: unknown }).detail;
      if (typeof detail === 'string' && detail.length > 0) return detail;
    }
  } catch {
    // The body was empty or not JSON.
  }
  return `Request failed (${response.status}).`;
}

async function doRefresh(): Promise<Session | null> {
  const stored = await readRefreshToken();
  if (!stored || !apiUrl) {
    accessToken = null;
    return null;
  }
  try {
    const response = await fetch(join('/auth/refresh'), {
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
  } catch {
    accessToken = null;
    await clearRefreshToken();
    publish(null);
    return null;
  }
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
  const response = await fetch(join(path), { ...request, headers });
  if (response.status !== 401 || retry) return response;
  const session = await refreshSession();
  if (!session) throw new ApiError(401, 'Invalid or expired token.');
  return apiFetch(path, { ...request, retry: true });
}

async function openSession(path: string, email: string, password: string): Promise<Session> {
  if (!apiUrl) throw new ApiError(0, 'The API address is not configured.');
  const response = await fetch(join(path), {
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
  if (!apiUrl) throw new ApiError(0, 'The API address is not configured.');
  const response = await fetch(join('/auth/forgot-password'), {
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
  if (!apiUrl) throw new ApiError(0, 'The API address is not configured.');
  const response = await fetch(join('/auth/reset-password'), {
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
      await fetch(join('/auth/logout'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    }
  } finally {
    accessToken = null;
    await clearRefreshToken();
    publish(null);
  }
}
