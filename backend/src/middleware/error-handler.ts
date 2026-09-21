import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // M5 FIX: turn Zod validation failures into clean 400s with field-level
  // detail instead of falling through to a generic 500.
  if (err instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(('errors' in err) ? { details: (err as any).errors } : {}),
      },
    });
    return;
  }

  // Prisma KNOWN request errors (they carry a stable `code`).
  //
  // Previously only P2002 and P2025 were mapped; everything else fell through to
  // the generic 500 below, so the operator saw "An unexpected error occurred" for
  // faults that have a perfectly clear cause — a foreign-key violation, a
  // transaction that timed out under load, a write-conflict/deadlock. Those are
  // the ones the work-assignment transactions can actually raise, which is why
  // routine admin actions were surfacing as opaque 500s.
  if (err.constructor?.name === 'PrismaClientKnownRequestError') {
    const prismaError = err as any;
    switch (prismaError.code) {
      case 'P2002': // unique constraint
        res.status(409).json({
          success: false,
          error: {
            code: 'DUPLICATE_ENTRY',
            message: 'A record with this data already exists',
            field: prismaError.meta?.target,
          },
        });
        return;
      case 'P2025': // record required by the operation was not found
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Record not found' },
        });
        return;
      case 'P2003': // foreign-key constraint failed
        res.status(409).json({
          success: false,
          error: {
            code: 'FK_CONSTRAINT',
            message: 'This action conflicts with a related record and cannot be completed.',
            field: prismaError.meta?.field_name,
          },
        });
        return;
      case 'P2028': // interactive transaction timed out / already closed
        logger.error('Prisma transaction timeout (P2028):', prismaError.message);
        res.status(503).json({
          success: false,
          error: {
            code: 'TRANSACTION_TIMEOUT',
            message: 'The server was busy and could not finish in time. Please try again.',
          },
        });
        return;
      case 'P2034': // write conflict / deadlock, retryable
        res.status(409).json({
          success: false,
          error: {
            code: 'WRITE_CONFLICT',
            message: 'Another operation touched the same records at the same time. Please try again.',
          },
        });
        return;
    }
  }

  // Prisma raw-query errors (from $queryRaw / $executeRaw in the assignment code).
  // These carry a Postgres SQLSTATE in `meta.code`; the ones the claim/rebalance
  // path can hit are deadlock (40P01), lock-not-available (55P03) and
  // statement/query cancellation on timeout (57014). All are transient and
  // retryable, so they must not read as a hard failure.
  if (err.constructor?.name === 'PrismaClientUnknownRequestError') {
    const pgCode = (err as any).meta?.code as string | undefined;
    if (pgCode === '40P01' || pgCode === '55P03' || pgCode === '57014') {
      res.status(503).json({
        success: false,
        error: {
          code: 'SERVER_BUSY',
          message: 'The server was briefly busy. Please try again.',
        },
      });
      return;
    }
    logger.error('Prisma raw-query error:', (err as any).message);
    res.status(500).json({
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: process.env.NODE_ENV === 'production'
          ? 'A database error occurred. Please try again.'
          : (err as any).message,
      },
    });
    return;
  }

  // Prisma connection-pool exhaustion (P2024): the pool timed out handing over a
  // connection. Retryable, and a clear "busy" beats a mystery 500.
  if ((err as any).code === 'P2024') {
    logger.error('Prisma pool timeout (P2024):', (err as any).message);
    res.status(503).json({
      success: false,
      error: {
        code: 'SERVER_BUSY',
        message: 'The server is under heavy load. Please try again in a moment.',
      },
    });
    return;
  }

  // Unexpected errors. Log the full error server-side (message + stack) so the
  // real cause is recoverable from logs even though the client only gets a
  // generic message in production.
  logger.error('Unhandled error:', {
    name: err.name,
    message: err.message,
    stack: err.stack,
    // Surface any Prisma/Postgres code that slipped past the branches above, so
    // the next occurrence is one grep away from being classified properly.
    code: (err as any).code,
    meta: (err as any).meta,
  });
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred'
        : err.message,
    },
  });
}
