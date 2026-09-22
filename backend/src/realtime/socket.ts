import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../config/database';
import { logger } from '../utils/logger';
import cookie from 'cookie';

interface AuthenticatedSocket extends Socket {
  enumeratorId?: string;
  isAdmin?: boolean;
  districts?: string[];
}

let io: SocketIOServer | null = null;

// Mirrors authMiddleware's decoded-token shape exactly
interface DecodedToken {
  id: string;
  loginId: string;
  name: string;
  isAdmin: boolean;
}

export function initRealtime(httpServer: HTTPServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: config.env === 'production'
        ? ['https://mahaatithi.gov.in', 'https://mahathithi.vercel.app', 'http://localhost:5173']
        : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173', 'https://mahathithi.vercel.app'],
      credentials: true,
    },
    maxHttpBufferSize: 1e4, // 10KB
  });

  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      let token = socket.handshake.auth?.token as string | undefined;

      if (!token && socket.handshake.headers.cookie) {
        const cookies = cookie.parse(socket.handshake.headers.cookie);
        token = cookies.admin_session;
      }

      if (!token) return next(new Error('UNAUTHORIZED'));

      const decoded = jwt.verify(token, config.jwt.secret) as DecodedToken;

      const enumerator = await prisma.enumerator.findUnique({
        where: { id: decoded.id, isActive: true },
        include: { districts: { include: { district: true } } },
      });

      if (!enumerator) return next(new Error('UNAUTHORIZED'));

      socket.enumeratorId = enumerator.id;
      socket.isAdmin = enumerator.isAdmin;
      socket.districts = enumerator.districts.map((d) => d.district.name.toUpperCase());

      next();
    } catch (err) {
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    // Per-enumerator room, joined by EVERY socket regardless of role.
    //
    // District rooms are computed once, here, from the assignments the account had
    // at connect time. That is the whole problem this fixes: if an admin assigns a
    // NEW district to an already-connected enumerator, their socket never joined
    // that district's room, so a district-scoped broadcast never reaches them —
    // the change only surfaced on a full reconnect (app restart / manual sync),
    // which is the "lots of refreshes" the field team hit.
    //
    // A room keyed on the enumerator id is stable across any assignment change, so
    // the server can always reach a specific person's device directly. The roster
    // mutations emit to this room, and the device reacts by pulling the delta.
    if (socket.enumeratorId) {
      socket.join(`enum:${socket.enumeratorId}`);
    }

    if (socket.isAdmin) {
      socket.join('admin:global');
    } else {
      (socket.districts || []).forEach((d) => socket.join(`district:${d}`));
    }

    logger.info(`[realtime] connected: enumerator=${socket.enumeratorId} admin=${socket.isAdmin} districts=${(socket.districts || []).join(',')}`);

    // Presence: tell every admin someone came online.
    if (!socket.isAdmin) {
      io!.to('admin:global').emit('enumerator:presence', {
        enumeratorId: socket.enumeratorId,
        status: 'online',
        at: new Date().toISOString(),
      });
    }

    socket.on('disconnect', () => {
      logger.info(`[realtime] disconnected: enumerator=${socket.enumeratorId}`);
      if (!socket.isAdmin) {
        io!.to('admin:global').emit('enumerator:presence', {
          enumeratorId: socket.enumeratorId,
          status: 'offline',
          at: new Date().toISOString(),
        });
      }
    });
  });

  return io;
}

export function emitToDistrict(district: string | null | undefined, event: string, payload: unknown): void {
  if (!io || !district) return;
  io.to(`district:${district.toUpperCase()}`).emit(event, payload);
}

/**
 * Emit directly to one enumerator's device(s), by their stable per-enumerator room.
 *
 * This is the channel that survives a district reassignment: it does not depend on
 * which district rooms the socket happened to join at connect time, so a roster
 * change reaches the affected enumerator's phone immediately rather than waiting
 * for a reconnect.
 */
export function emitToEnumerator(enumeratorId: string | null | undefined, event: string, payload: unknown): void {
  if (!io || !enumeratorId) return;
  io.to(`enum:${enumeratorId}`).emit(event, payload);
}

export function emitToAdmins(event: string, payload: unknown): void {
  if (!io) return;
  io.to('admin:global').emit(event, payload);
}

export function emitToDistrictAndAdmins(district: string | null | undefined, event: string, payload: unknown): void {
  emitToDistrict(district, event, payload);
  emitToAdmins(event, payload);
}
