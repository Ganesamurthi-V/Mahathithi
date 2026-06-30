import axios from 'axios';
import EncryptedStorage from 'react-native-encrypted-storage';
import Config from 'react-native-config';

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
const API_BASE = Config.API_BASE_URL || (__DEV__ ? 'https://mahathithi-test.up.railway.app/api' : '');

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


// Request interceptor — attach JWT
api.interceptors.request.use(async (config) => {
  try {
    const token = await EncryptedStorage.getItem('access_token');
    if (token) {
      if (config.headers && typeof config.headers.set === 'function') {
        config.headers.set('Authorization', `Bearer ${token}`);
      } else {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
  } catch (e) {}
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

// Response interceptor — handle token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const refreshToken = await EncryptedStorage.getItem('refresh_token');
        if (refreshToken) {
          const res = await attemptRefresh(refreshToken);
          const { accessToken, refreshToken: newRefresh } = res.data.data.tokens;

          await EncryptedStorage.setItem('access_token', accessToken);
          await EncryptedStorage.setItem('refresh_token', newRefresh);

          import('./realtime').then(m => m.reauthRealtime());

          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
          return api(originalRequest);
        }
      } catch (refreshError: any) {
        // Only wipe local data if the refresh endpoint explicitly rejected
        // the refresh token (401/403) — a real, confirmed auth failure. A
        // network drop, timeout, or 5xx during refresh (even after retries
        // above) is NOT proof the refresh token is invalid, and must never
        // destroy unsynced field data on that basis alone.
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
  updateStakeholder: (id: string, data: any) =>
    api.patch(`/stakeholders/${id}`, data),
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
      timeout: 120000, // 2 min for large uploads
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