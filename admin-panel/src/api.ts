import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

// ============================================================================
// SESSION KEEP-ALIVE
// ============================================================================
// THIS IS THE FIX for the panel signing itself out after ~15 minutes.
//
// The panel authenticates with an httpOnly `admin_session` cookie holding the
// ACCESS token, whose lifetime is 15 minutes. There was no refresh logic here at
// all — no interceptor, no timer, nothing. Once that cookie lapsed, every request
// 401'd, App.tsx's getProfile().catch() left `user` null, and the operator was
// dropped on the login screen mid-task. Reloading the page did the same.
//
// The server side now also issues a long-lived httpOnly `admin_refresh` cookie
// and lets POST /auth/refresh mint a new access cookie from it (see
// auth.controller.ts). This half does two things with that:
//
//   1. Reactive  — a 401 triggers one refresh, then the original request is retried.
//   2. Proactive — a timer and a visibility handler renew the cookie before it
//                  lapses, so in normal use nothing ever 401s in the first place.
//
// Note the browser cannot read an httpOnly cookie, so unlike the mobile client we
// cannot decode the JWT to see its expiry. Renewal is therefore time-based, on an
// interval comfortably shorter than the 15-minute lifetime.

// Bare axios instance: the refresh call must NOT pass through the interceptor
// below, or a failing refresh would recurse into itself.
const refreshClient = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

/** Fires when the session is definitively gone, so App.tsx can show LoginPage. */
export const SESSION_EXPIRED_EVENT = 'mahaatithi:session-expired';

let refreshPromise: Promise<boolean> | null = null;

/**
 * Renew the access cookie, coalescing concurrent callers onto one request.
 *
 * The panel fires several queries at once on load and on navigation (analytics,
 * enumerators, stakeholders...). Without this latch, a stale cookie would make
 * every one of them 401 and every one of them POST /auth/refresh independently.
 *
 * Resolves true on success, false when the refresh was rejected outright.
 * Rethrows nothing — callers treat false as "could not renew right now".
 */
export async function refreshSession(): Promise<boolean> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      // The refresh token travels as the httpOnly admin_refresh cookie; there is
      // deliberately no body, since JS cannot read the cookie to send one.
      await refreshClient.post('/auth/refresh', {});
      return true;
    } catch (err: any) {
      const status = err?.response?.status;
      // 401/403 means the refresh token really is invalid, expired or revoked.
      // Anything else (network down, 5xx, timeout) is transient and must NOT end
      // the session — the operator may just be on a flaky connection.
      if (status === 401 || status === 403) {
        window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      }
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// A 401 on these paths is normal and must never trigger a refresh attempt:
// /auth/me is how we probe for an existing session before login, and refreshing
// inside a refresh recurses.
function isAuthProbe(url?: string): boolean {
  if (!url) return false;
  return url.includes('/auth/refresh') || url.includes('/auth/login');
}

// Reactive refresh. Note the previous version of this interceptor did
// `window.location.href = '/login'` on every 401, which caused an infinite
// reload loop: there is no /login route, Vercel's SPA rewrite served index.html,
// the app remounted, getProfile() 401'd again, and it redirected again. The
// rejection is still allowed to propagate so callers surface their own errors.
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;

    if (
      error.response?.status === 401 &&
      original &&
      !original._retry &&
      !isAuthProbe(original.url)
    ) {
      original._retry = true;
      const renewed = await refreshSession();
      if (renewed) {
        // Cookie has been replaced by Set-Cookie; just replay the request.
        return api(original);
      }
    }

    return Promise.reject(error);
  }
);

/**
 * Start background renewal. Returns a cleanup function.
 *
 * Called once the user is authenticated (see App.tsx). Two triggers:
 *
 *   • interval — 10 minutes, comfortably inside the 15-minute cookie lifetime.
 *   • visibilitychange — a laptop resumed from sleep, or a tab left in the
 *     background for an hour, has a dead cookie and no timer will have fired on
 *     schedule. Browsers throttle timers in background tabs, so this is the case
 *     the interval alone cannot cover.
 */
export function startSessionKeepAlive(): () => void {
  const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

  const tick = () => { void refreshSession(); };

  const interval = window.setInterval(tick, REFRESH_INTERVAL_MS);

  const onVisible = () => {
    if (document.visibilityState === 'visible') tick();
  };
  document.addEventListener('visibilitychange', onVisible);

  // Coming back online after a drop is another good moment to re-establish.
  window.addEventListener('online', tick);

  return () => {
    window.clearInterval(interval);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', tick);
  };
}

// Auth
// PERF/SECURITY: verbose request/response tracing is gated behind DEV so
// production builds don't run console I/O on the login path or print response
// payloads into the browser console.
export const login = (loginId: string, password: string) => {
  const debug = import.meta.env.DEV;
  if (debug) {
    console.log('--- ADMIN LOGIN REQUEST STARTED ---');
    console.log(`URL: ${api.defaults.baseURL || API_BASE}/auth/login`);
    console.log(`Method: POST`);
    console.log(`Payload:`, { loginId, password: '***' }); // hiding password in logs for security
  }
  return api.post('/auth/login', { loginId, password })
    .then(res => {
      if (debug) {
        console.log('--- ADMIN LOGIN SUCCESS ---');
        console.log('Response Status:', res.status);
        console.log('Response Data:', res.data);
      }
      return res;
    })
    .catch(err => {
      if (debug) {
        console.log('--- ADMIN LOGIN FAILED ---');
        console.log('Error:', err.message);
        if (err.response) {
          console.log('Response Status:', err.response.status);
          console.log('Response Data:', err.response.data);
        }
      }
      throw err;
    });
};

export const getProfile = () => api.get('/auth/me');

// Admin - Enumerators
export const getEnumerators = () => api.get('/admin/enumerators');
export const createEnumerator = (data: any) => api.post('/admin/enumerators', data);
export const updateEnumerator = (id: string, data: any) => api.patch(`/admin/enumerators/${id}`, data);
export const deleteEnumerator = (id: string) => api.delete(`/admin/enumerators/${id}`);
export const assignDistricts = (id: string, districtIds: string[]) =>
  api.put(`/admin/enumerators/${id}/districts`, { districtIds });

// Admin - Districts
export const getDistricts = () => api.get('/admin/districts');

// Admin - Analytics
export const getAnalytics = () => api.get('/admin/analytics');

// Admin - Audit Logs
export const getAuditLogs = (params?: any) => api.get('/admin/audit-logs', { params });

// Dashboard
export const getDashboardStats = () => api.get('/dashboard/stats');

// Stakeholders
export const searchStakeholders = (params: any) => api.get('/stakeholders/search', { params });
export const getStakeholderById = (id: string) => api.get(`/stakeholders/${id}`);
export const updateStakeholder = (id: string, data: any) => api.patch(`/stakeholders/${id}`, data);
export const createStakeholder = (data: any) => api.post('/stakeholders', data);
/**
 * Permanently delete a stakeholder. Admin-only server-side, and refused with a 409
 * if any survey is attached. The server writes a full row snapshot to the audit log
 * first, which is the only way back from this.
 */
export const deleteStakeholder = (id: string) => api.delete(`/stakeholders/${id}`);

// Surveys
export const getSurveyByStakeholder = (stakeholderId: string) =>
  api.get(`/surveys/stakeholder/${stakeholderId}`);

// Media
export const getMediaBySurvey = (surveyId: string) => api.get(`/media/survey/${surveyId}`);

// Export
export const getCompletedSurveys = () => api.get('/admin/export/surveys/list');
export type ExportFormat = 'sql' | 'csv';

/**
 * Download a survey export.
 *
 * `sql` is the migration artefact for the client's listing schema; `csv` is one
 * flat row per survey for reading in a spreadsheet. Both mark the surveys as
 * exported server-side, but only once the bytes have actually been delivered.
 */
export const exportSurveys = (ids?: string[], format: ExportFormat = 'sql') =>
  ids && ids.length > 0
    ? api.post('/admin/export/surveys', { ids, format }, { responseType: 'blob' })
    : api.get('/admin/export/surveys', { params: { format }, responseType: 'blob' });

export default api;