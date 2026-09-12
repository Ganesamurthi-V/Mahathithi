import { io, Socket } from 'socket.io-client';
import { DeviceEventEmitter } from 'react-native';
import EncryptedStorage from 'react-native-encrypted-storage';
import Config from 'react-native-config';
import { store } from '../store';
import { stakeholderDao } from '../database';
import { removeStakeholder } from '../store/slices/stakeholderSlice';
import {
  refreshSyncCountsThunk,
  pullServerChangesThunk,
  applyRemoteStakeholderDeleteThunk,
} from '../store/slices/syncThunks';

// Reuse the exact same base resolution logic as services/api.ts
const API_BASE = Config.API_BASE_URL || (__DEV__ ? 'https://mahathithi-production.up.railway.app/api' : '');
// Socket.IO connects to the server root, not the /api prefix — strip it.
const SOCKET_BASE = API_BASE.replace(/\/api\/?$/, '');

let socket: Socket | null = null;

/**
 * Coalesce bursts of change events into one delta pull.
 *
 * One enumerator finishing a survey emits several events in quick succession (the
 * survey, then each media file), and every device in that district receives them
 * all. Pulling per event would mean a round trip per file from every phone in the
 * district. Collecting them and pulling once shortly after the burst settles
 * reaches the same end state for a fraction of the traffic, which matters on a
 * metered mobile connection.
 */
const PULL_DEBOUNCE_MS = 1200;
let pullTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePull(): void {
  if (pullTimer) clearTimeout(pullTimer);
  pullTimer = setTimeout(() => {
    pullTimer = null;
    store.dispatch(pullServerChangesThunk() as any);
  }, PULL_DEBOUNCE_MS);
}

/**
 * Local event name screens subscribe to for "server data moved".
 *
 * Kept as a constant so a typo cannot silently produce a listener that never
 * fires — the failure mode of a stale screen is invisible, with no error.
 */
export const DATA_CHANGED_EVENT = 'data:changed';

/** Mirrors DataResource on the server. */
export type DataResource =
  | 'stakeholders'
  | 'enumerators'
  | 'districts'
  | 'surveys'
  | 'media'
  | 'analytics'
  | 'auditLogs'
  | 'exports';

export const ALL_RESOURCES: DataResource[] = [
  'stakeholders', 'enumerators', 'districts', 'surveys', 'media', 'analytics', 'auditLogs', 'exports',
];

/**
 * Announce a local change so screens refresh without a server round trip.
 *
 * Used after a sync finishes: the device has just rewritten its own SQLite rows,
 * so the screens showing them are stale even though nothing arrived over the
 * socket.
 */
export function announceLocalDataChange(resources: DataResource[]): void {
  DeviceEventEmitter.emit(DATA_CHANGED_EVENT, { resources, reason: 'local' });
}

export async function connectRealtime(): Promise<void> {
  if (socket?.connected) return;

  // CRASH FIX (companion to api.ts): if API_BASE_URL is unset, App.tsx now
  // renders ConfigErrorScreen and this code path is unreachable in
  // practice. This guard is kept anyway as defense-in-depth — without it,
  // io('') would attempt to connect to a nonsensical empty-string URL,
  // which on some socket.io-client versions throws synchronously rather
  // than failing async like a normal connection error, which would
  // reintroduce a crash-on-login symptom through a different door.
  if (!SOCKET_BASE) {
    console.error('[realtime] SOCKET_BASE is empty (API_BASE_URL not configured) — skipping connect.');
    return;
  }

  const token = await EncryptedStorage.getItem('access_token');
  if (!token) return;

  socket = io(SOCKET_BASE, {
    auth: { token },
    transports: ['websocket'], // skip long-polling fallback on mobile
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
  });

  socket.on('connect', () => {
    console.log('[realtime] connected');
  });

  socket.on('connect_error', (err) => {
    console.log('[realtime] connect_error', err.message);
  });

  socket.on('stakeholder:locked', async (payload: { stakeholderId: string; lockedById?: string }) => {
    try {
      await stakeholderDao.removeLockedStakeholders([payload.stakeholderId]);

      // 1. Remove from Redux search results so StakeholderListScreen updates instantly
      store.dispatch(removeStakeholder(payload.stakeholderId));

      // 2. Notify any mounted screen (e.g. StakeholderDetailScreen) so it can
      //    navigate away or refresh without waiting for the next focus event.
      DeviceEventEmitter.emit('stakeholder:locked', { stakeholderId: payload.stakeholderId });
    } catch (e) {
      console.warn('[realtime] failed to apply stakeholder:locked locally', e);
    }
  });

  socket.on('stakeholder:unlocked', async (payload: { stakeholderIds: string[] }) => {
    store.dispatch(refreshSyncCountsThunk() as any);

    // Notify list screen to reload so newly unlocked stakeholders become visible
    DeviceEventEmitter.emit('stakeholder:unlocked', { stakeholderIds: payload.stakeholderIds });
  });

  // Generic change feed from the server (see backend/src/realtime/events.ts).
  //
  // Re-broadcast locally so any mounted screen can react while the operator is
  // looking at it. Screens previously refreshed only in useFocusEffect, which
  // means a screen already on display never updated — an admin correcting a
  // stakeholder's address, or another enumerator closing one, was invisible until
  // the enumerator navigated away and came back.
  //
  // But re-broadcasting alone was not enough, and this is the bug that made
  // "realtime" only half work: mobile screens read from local SQLite, and nothing
  // was updating SQLite from the server. The screen dutifully re-rendered the same
  // stale row. So a stakeholder change now also pulls the delta into the mirror
  // BEFORE the screens are told, and the pull itself announces again when it lands.
  socket.on('data:changed', (payload: {
    resources?: string[];
    entityId?: string;
    entityType?: string;
    action?: string;
  }) => {
    if (!payload?.resources?.length) return;

    // Tell screens straight away so anything not backed by SQLite (counters read
    // from the API) reacts without waiting for the pull.
    DeviceEventEmitter.emit(DATA_CHANGED_EVENT, payload);

    if (!payload.resources.includes('stakeholders')) return;

    // A hard delete leaves no row for the delta feed to report, so it has to be
    // applied from the event. entityType is what makes this safe: deleting an
    // ENUMERATOR also names 'stakeholders' in its fan-out, and acting on that
    // entityId would try to delete a stakeholder using an enumerator's id.
    if (payload.action === 'delete' && payload.entityType === 'stakeholders' && payload.entityId) {
      store.dispatch(applyRemoteStakeholderDeleteThunk(payload.entityId) as any);
      return;
    }

    schedulePull();
  });

  socket.on('connect', () => {
    // Anything that changed while this device was offline was missed. Treat a
    // (re)connect as "refresh everything you are showing".
    DeviceEventEmitter.emit(DATA_CHANGED_EVENT, { resources: ALL_RESOURCES, reason: 'reconnect' });

    // And missed events cannot be replayed, so refreshing the screens is not
    // enough — the mirror itself is behind. The cursor makes this cheap when
    // nothing moved, and it is the only thing that closes the offline window.
    schedulePull();
  });

  socket.on('disconnect', (reason) => {
    console.log('[realtime] disconnected:', reason);
  });
}

export function disconnectRealtime(): void {
  // Cancel any pending pull, or a logout could be followed by a request carrying a
  // token that has just been cleared.
  if (pullTimer) {
    clearTimeout(pullTimer);
    pullTimer = null;
  }
  socket?.disconnect();
  socket = null;
}

/**
 * Ensure the realtime socket is live, reconnecting only if it is actually down.
 *
 * Call this when the app returns to the foreground. Android suspends sockets for
 * backgrounded apps, so after a spell in the pocket the connection is usually
 * dead while `socket` still holds a stale object — events are silently missed
 * until something forces a reconnect.
 *
 * This replaces the previous reauthRealtime(), which unconditionally destroyed
 * and rebuilt the connection and was called on every token refresh. That paid a
 * full TCP + TLS + Socket.IO handshake for no reason: Socket.IO only reads the
 * auth token at connect time, so renewing the access token cannot invalidate an
 * established connection. Here the teardown happens only when the socket is
 * genuinely not connected.
 */
export async function ensureRealtimeConnected(): Promise<void> {
  if (socket?.connected) return;
  // Release the dead handle before reconnecting so we do not leak listeners.
  if (socket) disconnectRealtime();
  await connectRealtime();
}
