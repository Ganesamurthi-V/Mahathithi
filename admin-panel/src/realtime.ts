import { io, Socket } from 'socket.io-client';
import { QueryClient } from '@tanstack/react-query';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const SOCKET_BASE = API_BASE.replace(/\/api\/?$/, '') || window.location.origin;

let socket: Socket | null = null;
let teardownWindowHooks: (() => void) | null = null;

// Coalesce bursts of cache invalidation.
//
// Every stakeholder:locked event triggered an immediate invalidateQueries. When
// several enumerators complete surveys around the same time — normal during field
// hours — that fired a refetch per event, so a dozen events meant a dozen
// /analytics round trips in a second. Analytics is a set of aggregate counters, so
// collapsing a burst into one refetch shortly after it settles gives the same
// result for a fraction of the traffic.
const INVALIDATE_DEBOUNCE_MS = 750;
let invalidateTimer: number | null = null;

function scheduleAnalyticsRefresh(queryClient: QueryClient): void {
  if (invalidateTimer !== null) window.clearTimeout(invalidateTimer);
  invalidateTimer = window.setTimeout(() => {
    invalidateTimer = null;
    queryClient.invalidateQueries({ queryKey: ['analytics'] });
  }, INVALIDATE_DEBOUNCE_MS);
}

export function connectAdminRealtime(queryClient: QueryClient): void {
  if (socket?.connected) return;

  // LEAK FIX: the guard above only skips when the socket is *connected*. A socket
  // that exists but has dropped fell straight through and a brand-new one was
  // constructed on top of it, leaving the old instance and all of its listeners
  // attached. Repeated over a long admin session (each drop leaving another dead
  // socket behind) that means duplicate handlers and duplicate refetches for every
  // event. Dispose explicitly before rebuilding.
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  socket = io(SOCKET_BASE, {
    withCredentials: true, // sends the httpOnly admin_session cookie for the handshake
    // Order matters: websocket is attempted first, so the usual case skips the
    // HTTP long-poll handshake entirely. `polling` is retained as a fallback
    // because government/corporate networks sometimes block WebSocket upgrades,
    // and a panel with no realtime is better than a panel that cannot connect.
    transports: ['websocket', 'polling'],
    // Explicit reconnection policy. Previously unset, so a dropped connection
    // relied entirely on defaults with no ceiling on the backoff.
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    timeout: 10000,
  });

  socket.on('connect_error', (err) => {
    // Surfaced deliberately: a silent auth failure here is why realtime could
    // appear "broken" with no diagnostic. UNAUTHORIZED means the admin_session
    // cookie has lapsed; the api.ts keep-alive renews it and the next
    // reconnection attempt will carry the fresh cookie.
    if (import.meta.env.DEV) console.warn('[realtime] connect_error:', err.message);
  });

  socket.on('stakeholder:locked', () => scheduleAnalyticsRefresh(queryClient));
  socket.on('stakeholder:unlocked', () => scheduleAnalyticsRefresh(queryClient));

  socket.on('enumerator:presence', (payload: { enumeratorId: string; status: 'online' | 'offline' }) => {
    queryClient.setQueryData(['enumerator-presence'], (old: Record<string, boolean> = {}) => ({
      ...old,
      [payload.enumeratorId]: payload.status === 'online',
    }));
  });

  // Browsers throttle timers and may drop sockets in background tabs, and a
  // laptop resumed from sleep comes back with a dead connection while `socket`
  // still looks valid. Re-check whenever the tab becomes visible or the network
  // returns, so the panel does not sit silently disconnected.
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
  if (invalidateTimer !== null) {
    window.clearTimeout(invalidateTimer);
    invalidateTimer = null;
  }
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
