import { io, Socket } from 'socket.io-client';
import EncryptedStorage from 'react-native-encrypted-storage';
import Config from 'react-native-config';
import { store } from '../store';
import { stakeholderDao } from '../database';
import { refreshSyncCountsThunk } from '../store/slices/syncThunks';

// Reuse the exact same base resolution logic as services/api.ts
const API_BASE = Config.API_BASE_URL || (__DEV__ ? 'https://mahathithi-test.up.railway.app/api' : '');
// Socket.IO connects to the server root, not the /api prefix — strip it.
const SOCKET_BASE = API_BASE.replace(/\/api\/?$/, '');

let socket: Socket | null = null;

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

  socket.on('stakeholder:locked', async (payload: { stakeholderId: string }) => {
    try {
      await stakeholderDao.removeLockedStakeholders([payload.stakeholderId]);
    } catch (e) {
      console.warn('[realtime] failed to apply stakeholder:locked locally', e);
    }
  });

  socket.on('stakeholder:unlocked', async (payload: { stakeholderIds: string[] }) => {
    store.dispatch(refreshSyncCountsThunk() as any);
  });

  socket.on('disconnect', (reason) => {
    console.log('[realtime] disconnected:', reason);
  });
}

export function disconnectRealtime(): void {
  socket?.disconnect();
  socket = null;
}

export async function reauthRealtime(): Promise<void> {
  disconnectRealtime();
  await connectRealtime();
}
