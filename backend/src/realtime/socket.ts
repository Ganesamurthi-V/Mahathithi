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

export function emitToAdmins(event: string, payload: unknown): void {
  if (!io) return;
  io.to('admin:global').emit(event, payload);
}

export function emitToDistrictAndAdmins(district: string | null | undefined, event: string, payload: unknown): void {
  emitToDistrict(district, event, payload);
  emitToAdmins(event, payload);
}
