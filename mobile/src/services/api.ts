import axios from 'axios';
import EncryptedStorage from 'react-native-encrypted-storage';
import Config from 'react-native-config';
import { shouldRefreshToken } from '../utils/jwt';

// M7 FIX: The API base URL is no longer hardcoded.
// In a production build, set API_BASE_URL via your CI/CD build environment
// e.g. in an .env file or build secrets.
//
// CRASH FIX: this used to `throw` at module scope when API_BASE was empty.
// api.ts is imported transitively at app boot (App.tsx -> store/index.ts ->
// authSlice.ts -> services/api.ts), so a top-level throw here fires during
// the very first JS module evaluation, before any React component — even
// the root <App/> — has mounted. There is no error boundary above that
// point to catch it, and RN release builds have the red-box overlay
// disabled, so the *visible* symptom is just "the app closes" with zero
// indication why. This is exactly what happened in release APKs: the repo
// ships with no `.env` (it's gitignored on purpose — see root .gitignore —
// and was never created for release builds), so API_BASE silently resolved
// to '' and this throw fired on launch.
//
// Fix: never throw at module scope. Export a boolean + the (possibly empty)
// base URL, and let App.tsx render a real, visible "app not configured"
// screen via the new ConfigErrorScreen instead of the JS engine tearing
// down the whole app. The axios instance is still constructed (with an
// empty baseURL) so importing this module never throws; callers that
// actually try to make a request while misconfigured will get a normal
// rejected promise instead of a crash, which is recoverable by the UI.
const API_BASE = Config.API_BASE_URL || (__DEV__ ? 'https://mahathithi-production.up.railway.app/api' : '');

export const isApiConfigured = !!API_BASE;

if (!isApiConfigured) {
  // Log loudly (visible in `adb logcat`) instead of crashing. This is still
  // a real misconfiguration that must be fixed before shipping — see
  // mobile/.env.example — but it should never be the thing that makes the
  // app vanish on a user's device with no diagnosis path.
  console.error(
    '[CONFIG] API_BASE_URL is not set. The app will not be able to reach the server. ' +
    'Set it in mobile/.env (see mobile/.env.example) before building a release.'
  );
}

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});


// Request interceptor — attach JWT, renewing it first if it is about to expire
api.interceptors.request.use(async (config) => {
  try {
    let token = await EncryptedStorage.getItem('access_token');

    // Renew before sending rather than after failing. On app reopen the stored
    // token is usually already expired, and without this every queued startup
    // request would go out doomed, 401, and pile into the refresh path. The
    // single-flight latch in refreshAccessToken() means a burst of requests
    // triggers exactly one network refresh and then all proceed with the new
    // token. /auth/* is skipped: login has no token to renew, and refreshing
    // inside a refresh would recurse.
    const url = config.url || '';
    const isAuthRoute = url.includes('/auth/login') || url.includes('/auth/refresh');

    if (token && !isAuthRoute && shouldRefreshToken(token, 120)) {
      try {
        const fresh = await refreshAccessToken();
        if (fresh) token = fresh;
      } catch {
        // Could not renew (offline, or refresh rejected). Send the existing
        // token anyway: if it is merely stale the request 401s and the response
        // interceptor handles it; if we are offline the request fails as a
        // normal network error and the sync queue retries it later.
      }
    }

    if (token) {
      if (config.headers && typeof config.headers.set === 'function') {
        config.headers.set('Authorization', `Bearer ${token}`);
      } else {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
  } catch (e) { }
  return config;
});

// SYNC FIX (round 2): the refresh handler used to treat ANY error during
// token refresh — including a plain dropped connection, indistinguishable
// here from a genuinely invalid/expired refresh token — as a hard auth
// failure, wiping EncryptedStorage and calling clearAllData(), which deletes
// every unsynced survey, photo, video, and queue row on the device. With
// flaky connectivity, this could fire on an ordinary disconnect: an access
// token expires, the request 401s, the refresh call itself drops mid-flight,
// and the user's offline field work for that session (and everything else
// queued) is destroyed — not "failed to sync", just gone. The fix:
//   1. Retry the refresh call itself a few times with backoff if it's a
//      transient failure (no response at all / 5xx) — the same network blip
//      that caused the original 401 may well still be in effect a second later.
//   2. Only treat it as a genuine auth failure — and only then wipe local
//      data — if the refresh endpoint itself responds with an explicit
//      rejection (401/403: the refresh token is actually invalid/expired/
//      revoked). Any other failure (still no response after retries, 5xx,
//      timeout) is left as a normal transient error: reject and let the
//      original request fail through the normal sync-queue retry path
//      instead of nuking the device.
function isTransientRefreshError(err: any): boolean {
  if (!err.response) return true; // no response = network error/timeout/dropped connection
  return err.response.status >= 500;
}

async function attemptRefresh(refreshToken: string, attempt = 1): Promise<any> {
  const MAX_REFRESH_RETRIES = 3;
  try {
    return await axios.post(`${API_BASE}/auth/refresh`, { refreshToken }, { timeout: 15000 });
  } catch (err: any) {
    if (isTransientRefreshError(err) && attempt < MAX_REFRESH_RETRIES) {
      await new Promise((resolve) => setTimeout(() => resolve(undefined), 1000 * attempt));
      return attemptRefresh(refreshToken, attempt + 1);
    }
    throw err;
  }
}

// ============================================================================
// SINGLE-FLIGHT TOKEN REFRESH
// ============================================================================
// THIS IS THE FIX for "the app logs me out when I reopen it after a few hours".
//
// The access token lives 15 minutes. Reopening the app after longer than that
// means the stored token is already expired, and startup fires a burst of
// requests more or less simultaneously: checkSession, runInitialSync,
// connectRealtime, the dashboard query, and the sync heartbeat.
//
// Every one of those got a 401, and every one of them independently ran the
// refresh handler below with the SAME stored refresh token. The server rotates
// on refresh — it invalidates the presented session and issues a new one — so
// exactly one of those calls succeeded. The rest presented a token that had just
// been invalidated microseconds earlier, got a 401 back from /auth/refresh, were
// classified as a "confirmed auth failure", and emitted force_logout. The user
// was signed out despite holding a perfectly valid session.
//
// A single-flight promise collapses that burst into one network refresh. The
// first caller performs it; everyone else awaits the same promise and then
// retries with whatever token it produced. Combined with the server no longer
// rotating (see auth.service.ts), a concurrent burst can no longer invalidate
// the session.
let refreshPromise: Promise<string | null> | null = null;

/**
 * Refresh the access token, coalescing concurrent callers onto one request.
 *
 * Resolves with the new access token, or null when no refresh token is stored
 * (i.e. genuinely signed out).
 *
 * Throws only for a *confirmed* rejection (401/403 from /auth/refresh) or an
 * exhausted transient failure. Callers must treat a throw as "could not refresh
 * right now", NOT as "the user must be signed out" — that decision belongs to
 * the 401/403 branch alone, because an enumerator working offline for a week
 * must never lose their session (or their unsynced surveys) to a dropped packet.
 */
async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const refreshToken = await EncryptedStorage.getItem('refresh_token');
      if (!refreshToken) return null;

      const res = await attemptRefresh(refreshToken);
      const tokens = res.data?.data?.tokens;
      if (!tokens?.accessToken) {
        throw new Error('Refresh response did not contain an access token');
      }

      await EncryptedStorage.setItem('access_token', tokens.accessToken);
      // The server may or may not issue a new refresh token. It currently keeps
      // the same one (sliding expiry, no rotation); only overwrite when a new
      // value actually comes back so we never clobber a working token with
      // undefined if that behaviour changes.
      if (tokens.refreshToken) {
        await EncryptedStorage.setItem('refresh_token', tokens.refreshToken);
      }

      // PERF: deliberately do NOT reconnect the websocket here.
      //
      // This used to call reauthRealtime(), which tears the socket down and
      // rebuilds it — a fresh TCP connect, TLS handshake and Socket.IO handshake,
      // several hundred milliseconds of work. Socket.IO only reads `auth.token`
      // when the connection is established, so a live, already-authenticated
      // socket is completely unaffected by the access token being renewed. The
      // reconnect bought nothing.
      //
      // It also actively hurt: refreshes now happen proactively on every app
      // foreground, so every time the enumerator opened the app the realtime
      // connection was destroyed and rebuilt, dropping events during the gap.
      // The socket carries its own reconnection logic for genuine drops, and a
      // reconnect after a real disconnect picks up the newest stored token
      // anyway.

      return tokens.accessToken as string;
    } finally {
      // Clear the latch before resolving so the *next* expiry can refresh again.
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * Refresh the stored access token if it is expired or close to expiring.
 *
 * This is the proactive half of the strategy: called on app start, whenever the
 * app returns to the foreground, and on a periodic tick, so a token is renewed
 * *before* anything 401s. Reactive refresh in the interceptor remains as the
 * safety net for a token that expires mid-flight.
 *
 * Deliberately swallows every error. It runs speculatively in the background,
 * often with no network, and must never surface a failure or sign anyone out.
 * Returns true when a refresh actually happened.
 */
export async function ensureFreshToken(skewSeconds: number = 120): Promise<boolean> {
  try {
    const token = await EncryptedStorage.getItem('access_token');
    if (!token) return false;                       // signed out — nothing to do
    if (!shouldRefreshToken(token, skewSeconds)) return false; // still good

    await refreshAccessToken();
    return true;
  } catch {
    // Offline, server down, or refresh rejected. If it was a genuine rejection
    // the reactive path will handle it on the next real request; here we stay
    // silent so background ticks never disrupt the user.
    return false;
  }
}

// Response interceptor — reactive refresh for a token that expired in flight
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Never try to refresh a failed refresh call — that recurses.
    const isRefreshCall = typeof originalRequest?.url === 'string' &&
      originalRequest.url.includes('/auth/refresh');

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry && !isRefreshCall) {
      originalRequest._retry = true;
      try {
        const accessToken = await refreshAccessToken();

        // No refresh token stored: genuinely signed out. Surface the original
        // 401 rather than forcing a logout that would wipe cached data.
        if (!accessToken) return Promise.reject(error);

        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return api(originalRequest);
      } catch (refreshError: any) {
        // Only sign out on an explicit rejection from /auth/refresh (401/403):
        // the refresh token really is invalid, expired, or revoked. A network
        // drop, timeout, or 5xx is NOT proof of that, and must never cost the
        // user their session or their unsynced field work.
        const isConfirmedAuthFailure =
          refreshError.response?.status === 401 || refreshError.response?.status === 403;

        if (isConfirmedAuthFailure) {
          import('react-native').then(({ DeviceEventEmitter }) => {
            DeviceEventEmitter.emit('force_logout');
          });
        }
        // else: leave tokens and local data untouched. Reject below and let
        // the caller (e.g. the sync queue) treat this as an ordinary failed
        // request, eligible for normal retry/backoff.
      }
    }
    return Promise.reject(error);
  }
);

// SYNC FIX: retry transient failures in-process before letting them bubble up
// to syncThunks/syncQueueDao. Without this, a single dropped packet on a flaky
// mobile connection looks identical to a permanently broken request — both
// went straight to markFailed with zero attempt to just try again immediately.
// Only retries: no response at all (dropped connection, DNS hiccup, timeout)
// or 5xx (server-side blip). Never retries 4xx — those are real rejections
// (bad payload, auth, validation) and retrying them would just waste battery
// and bandwidth on something that will never succeed.
const MAX_TRANSIENT_RETRIES = 2;
const TRANSIENT_RETRY_DELAY_MS = 1500;

function isTransientError(error: any): boolean {
  if (!error.response) return true; // no response = network error/timeout/dropped connection
  return error.response.status >= 500;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(() => resolve(), ms));
}

api.interceptors.response.use(undefined, async (error) => {
  const config = error.config;
  if (!config || !isTransientError(error)) {
    return Promise.reject(error);
  }

  config._transientRetryCount = (config._transientRetryCount || 0) + 1;
  if (config._transientRetryCount > MAX_TRANSIENT_RETRIES) {
    return Promise.reject(error);
  }

  await delay(TRANSIENT_RETRY_DELAY_MS * config._transientRetryCount);
  return api(config);
});

// ============================================================================
// API SERVICES
// ============================================================================

export const authService = {
  login: (loginId: string, password: string) => {
    console.log('--- LOGIN REQUEST STARTED ---');
    console.log(`URL: ${api.defaults.baseURL}/auth/login`);
    console.log(`Method: POST`);
    console.log(`Payload:`, { loginId, password: '***' }); // hiding password in logs for security
    return api.post('/auth/login', { loginId, password })
      .then(res => {
        console.log('--- LOGIN SUCCESS ---');
        console.log('Response Status:', res.status);
        console.log('Response Data:', JSON.stringify(res.data, null, 2));
        return res;
      })
      .catch(err => {
        console.log('--- LOGIN FAILED ---');
        console.log('Error:', err.message);
        if (err.response) {
          console.log('Response Status:', err.response.status);
          console.log('Response Data:', JSON.stringify(err.response.data, null, 2));
        }
        throw err;
      });
  },
  logout: (refreshToken?: string) =>
    api.post('/auth/logout', { refreshToken }),
  getProfile: () => api.get('/auth/me'),
};

export const stakeholderService = {
  search: (params: Record<string, any>) =>
    api.get('/stakeholders/search', { params }),
  getById: (id: string) =>
    api.get(`/stakeholders/${id}`),
  getAssigned: (since?: string) =>
    api.get('/stakeholders/assigned', { params: { since } }),
  /**
   * Paginated sync — safe for 1 L+ records.
   *
   * Each page returns up to `pageSize` rows ordered by primaryKeyId.
   * Pass `after` = the `nextCursor` value from the previous response to
   * advance to the next page.  When the response `nextCursor` is null there
   * are no more pages.
   *
   * Uses a 5-minute timeout: a single 2 000-row page of full stakeholder
   * objects can be 3-4 MB of JSON on a slow mobile connection, and the
   * default 30-second timeout would fire before the transfer completes.
   */
  getAssignedPaged: (after: number = 0, pageSize: number = 2000, since?: string) =>
    api.get('/stakeholders/assigned/paged', {
      params: { after, page_size: pageSize, since },
      timeout: 300000, // 5 min — large page on a slow connection
    }),
  updateStakeholder: (id: string, data: any) =>
    api.patch(`/stakeholders/${id}`, data),
  /**
   * Create a stakeholder by hand.
   *
   * ONLINE ONLY. The sync queue can hold arbitrary entity types locally, but the
   * server's /sync/upload endpoint only processes surveys and media — there is no
   * handler for a queued stakeholder create, so anything queued here would sit
   * unsent forever and look like data loss. Callers must check connectivity first.
   *
   * The server assigns primary_key_id and confines non-admins to their assigned
   * districts, so an enumerator cannot create a record outside their area.
   */
  create: (data: any) =>
    api.post('/stakeholders', data),
  /**
   * Permanently delete a stakeholder. Admin-only server-side (403 otherwise), and
   * refused with 409 when any survey is attached. Online only, same reason as above.
   */
  remove: (id: string) =>
    api.delete(`/stakeholders/${id}`),
};

export const surveyService = {
  createOrUpdate: (data: any) =>
    api.post('/surveys', data),
  getByStakeholder: (stakeholderId: string) =>
    api.get(`/surveys/stakeholder/${stakeholderId}`),
  complete: (surveyId: string) =>
    api.post(`/surveys/${surveyId}/complete`),
  getMine: () =>
    api.get('/surveys/mine'),
};

export const mediaService = {
  upload: (formData: FormData) =>
    api.post('/media/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 180000, // 3 min max per file — prevents infinite hang on network drop
    }),
  getBySurvey: (surveyId: string) =>
    api.get(`/media/survey/${surveyId}`),
};

export const phoneValidationService = {
  create: (data: any) =>
    api.post('/phone-validation', data),
  getByStakeholder: (stakeholderId: string) =>
    api.get(`/phone-validation/stakeholder/${stakeholderId}`),
};

export const syncService = {
  upload: (data: any) =>
    api.post('/sync/upload', data),
  getChanges: (since?: string) =>
    api.get('/sync/changes', { params: { since } }),
};

export const facilityService = {
  syncOffline: () => api.get('/facilities/sync-offline'),
};

export const dashboardService = {
  getStats: () => api.get('/dashboard/stats'),
};

export default api;