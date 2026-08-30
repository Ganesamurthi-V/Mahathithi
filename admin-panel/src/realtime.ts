import { io, Socket } from 'socket.io-client';
import { QueryClient } from '@tanstack/react-query';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const SOCKET_BASE = API_BASE.replace(/\/api\/?$/, '') || window.location.origin;

let socket: Socket | null = null;
let teardownWindowHooks: (() => void) | null = null;

/**
 * Server resource names, mirroring DataResource in backend/src/realtime/events.ts.
 */
type DataResource =
  | 'stakeholders'
  | 'enumerators'
  | 'districts'
  | 'surveys'
  | 'media'
  | 'analytics'
  | 'auditLogs'
  | 'exports';

interface DataChangedPayload {
  resources: DataResource[];
  action?: 'create' | 'update' | 'delete';
  entityId?: string;
  at: string;
}

/**
 * Which cached queries a change to each resource makes stale.
 *
 * This is the single place that knows the relationship, so a new page only has to
 * add its key here to start updating live. Keys are matched by prefix, which is
 * what makes ['stakeholders'] cover every filter/page permutation of
 * ['stakeholders', filters, page] without enumerating them.
 *
 * Note the deliberate fan-out: a completed survey changes the stakeholder's
 * status, the dashboard counters AND the export queue, so the server names all
 * three resources and each maps onto its own keys. Getting this wrong is what
 * produced the original symptom — the panel invalidated only ['analytics'], so
 * the stakeholders table, enumerators list, districts page, audit log and export
 * list all sat on stale data until the operator navigated away and back.
 */
const RESOURCE_QUERY_KEYS: Record<DataResource, string[][]> = {
  stakeholders: [['stakeholders'], ['survey']],
  enumerators:  [['enumerators']],
  districts:    [['districts']],
  surveys:      [['stakeholders'], ['survey'], ['export-surveys-list']],
  media:        [['media']],
  analytics:    [['analytics']],
  auditLogs:    [['auditLogs']],
  exports:      [['export-surveys-list']],
};

/**
 * Coalesce bursts of invalidation.
 *
 * A single field sync can emit several events in quick succession (survey text,
 * then each media file). Invalidating per event would fire a refetch per event;
 * collecting the affected keys and flushing once shortly after the burst settles
 * produces the same end state for a fraction of the requests.
 */
const FLUSH_DEBOUNCE_MS = 300;
let pendingKeys = new Set<string>();
let flushTimer: number | null = null;

function scheduleInvalidation(queryClient: QueryClient, resources: DataResource[]): void {
  for (const resource of resources) {
    for (const key of RESOURCE_QUERY_KEYS[resource] ?? []) {
      pendingKeys.add(JSON.stringify(key));
    }
  }
  if (pendingKeys.size === 0) return;

  if (flushTimer !== null) window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    const keys = [...pendingKeys].map((k) => JSON.parse(k) as string[]);
    pendingKeys = new Set();

    for (const queryKey of keys) {
      // refetchType 'all' rather than the default 'active': a page the operator
      // is not looking at right now must ALSO be refreshed, otherwise switching
      // to it shows the cached stale value first and then flickers to the truth.
      // That flicker is the exact "showing old data again" behaviour being fixed.
      queryClient.invalidateQueries({ queryKey, refetchType: 'all' });
    }
  }, FLUSH_DEBOUNCE_MS);
}

export function connectAdminRealtime(queryClient: QueryClient): void {
  if (socket?.connected) return;

  // LEAK FIX: the guard above only skips when the socket is *connected*. A socket
  // that exists but has dropped fell straight through and a brand-new one was
  // constructed on top of it, leaving the old instance and all of its listeners
  // attached — duplicate handlers and duplicate refetches for every event.
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  socket = io(SOCKET_BASE, {
    withCredentials: true, // sends the httpOnly admin_session cookie for the handshake
    // websocket first so the usual case skips the HTTP long-poll handshake;
    // polling retained as a fallback because government/corporate networks
    // sometimes block WebSocket upgrades.
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    timeout: 10000,
  });

  socket.on('connect', () => {
    // Any change that happened while we were disconnected was missed entirely,
    // so treat a (re)connect as "everything is suspect" and refresh the lot.
    // Without this, a laptop resumed from sleep would keep showing pre-sleep data
    // until something else happened to invalidate it.
    scheduleInvalidation(queryClient, Object.keys(RESOURCE_QUERY_KEYS) as DataResource[]);
  });

  socket.on('connect_error', (err) => {
    // A silent auth failure here is why realtime could appear "broken" with no
    // diagnostic. UNAUTHORIZED means the admin_session cookie lapsed; the api.ts
    // keep-alive renews it and the next reconnect carries the fresh cookie.
    if (import.meta.env.DEV) console.warn('[realtime] connect_error:', err.message);
  });

  // The generic change feed — covers every mutation the server reports.
  socket.on('data:changed', (payload: DataChangedPayload) => {
    if (!payload?.resources?.length) return;
    scheduleInvalidation(queryClient, payload.resources);
  });

  // Specific events kept for their side effects beyond cache invalidation.
  socket.on('stakeholder:locked', () => {
    scheduleInvalidation(queryClient, ['stakeholders', 'analytics', 'surveys']);
  });

  socket.on('stakeholder:unlocked', () => {
    scheduleInvalidation(queryClient, ['stakeholders', 'analytics']);
  });

  socket.on('enumerator:presence', (payload: { enumeratorId: string; status: 'online' | 'offline' }) => {
    queryClient.setQueryData(['enumerator-presence'], (old: Record<string, boolean> = {}) => ({
      ...old,
      [payload.enumeratorId]: payload.status === 'online',
    }));
  });

  // Browsers throttle timers and may drop sockets in background tabs, and a
  // laptop resumed from sleep comes back with a dead connection while `socket`
  // still looks valid. Re-check on visibility and on regaining network; the
  // 'connect' handler above then refreshes everything that was missed.
  const revive = () => {
    if (!socket || socket.connected) return;
    socket.connect();
  };
  const onVisible = () => { if (document.visibilityState === 'visible') revive(); };

  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', revive);

  teardownWindowHooks = () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', revive);
  };
}

export function disconnectAdminRealtime(): void {
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
  pendingKeys = new Set();
  if (teardownWindowHooks) {
    teardownWindowHooks();
    teardownWindowHooks = null;
  }
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}
