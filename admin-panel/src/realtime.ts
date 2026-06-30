import { io, Socket } from 'socket.io-client';
import { QueryClient } from '@tanstack/react-query';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';
const SOCKET_BASE = API_BASE.replace(/\/api\/?$/, '') || window.location.origin;

let socket: Socket | null = null;

export function connectAdminRealtime(queryClient: QueryClient): void {
  if (socket?.connected) return;

  socket = io(SOCKET_BASE, {
    withCredentials: true,
    transports: ['websocket', 'polling'],
  });

  socket.on('stakeholder:locked', () => {
    queryClient.invalidateQueries({ queryKey: ['analytics'] });
  });

  socket.on('stakeholder:unlocked', () => {
    queryClient.invalidateQueries({ queryKey: ['analytics'] });
  });

  socket.on('enumerator:presence', (payload: { enumeratorId: string; status: 'online' | 'offline' }) => {
    queryClient.setQueryData(['enumerator-presence'], (old: Record<string, boolean> = {}) => ({
      ...old,
      [payload.enumeratorId]: payload.status === 'online',
    }));
  });
}

export function disconnectAdminRealtime(): void {
  socket?.disconnect();
  socket = null;
}
