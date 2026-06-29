import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../../config/database';
import { config } from '../../config';
import { UnauthorizedError, NotFoundError, AppError } from '../../utils/errors';
import { logger } from '../../utils/logger';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * H7 FIX: per-account brute-force lockout.
 *
 * The IP-only rate limiter in loginLimiter middleware can be bypassed by a
 * distributed attacker rotating IPs. This per-account counter locks a specific
 * loginId after MAX_FAILED_ATTEMPTS consecutive bad passwords, regardless of
 * how many different IPs were used.
 *
 * Implementation uses a module-level Map (safe for single-instance Node processes).
 * For a multi-instance deployment, swap these two variables for a Redis client:
 *   await redisClient.incr(`login_attempts:${loginId}`) etc.
 */
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

interface LockoutEntry {
  attempts: number;
  lockedUntil?: number; // epoch ms
}
const loginFailures = new Map<string, LockoutEntry>();

function checkAndRecordFailure(loginId: string): void {
  const now = Date.now();
  const entry = loginFailures.get(loginId) ?? { attempts: 0 };

  // If currently locked, reject immediately
  if (entry.lockedUntil && now < entry.lockedUntil) {
    throw new UnauthorizedError(
      'Account temporarily locked due to too many failed attempts. Please try again in 15 minutes.'
    );
  }

  // Otherwise increment and possibly lock
  entry.attempts++;
  if (entry.attempts >= MAX_FAILED_ATTEMPTS) {
    entry.lockedUntil = now + LOCKOUT_MS;
    entry.attempts = 0; // reset counter for the next lockout period
  }
  loginFailures.set(loginId, entry);
}

function checkLocked(loginId: string): void {
  const now = Date.now();
  const entry = loginFailures.get(loginId);
  if (entry?.lockedUntil && now < entry.lockedUntil) {
    throw new UnauthorizedError(
      'Account temporarily locked due to too many failed attempts. Please try again in 15 minutes.'
    );
  }
}

function clearFailures(loginId: string): void {
  loginFailures.delete(loginId);
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export class AuthService {
  /**
   * Authenticate enumerator with loginId and password
   */
  async login(
    loginId: string,
    password: string,
    deviceInfo?: string,
    ipAddress?: string
  ): Promise<{ tokens: TokenPair; enumerator: any }> {
    // H7 FIX: check account lockout before even querying the DB
    checkLocked(loginId);

    const enumerator = await prisma.enumerator.findUnique({
      where: { loginId },
      include: {
        districts: {
          include: { district: true },
        },
      },
    });

    if (!enumerator) {
      throw new UnauthorizedError('Invalid login credentials');
    }

    if (!enumerator.isActive) {
      throw new UnauthorizedError('Account has been deactivated');
    }

    const passwordValid = await bcrypt.compare(password, enumerator.passwordHash);
    if (!passwordValid) {
      // H7 FIX: record failed attempt, lock after MAX_FAILED_ATTEMPTS
      checkAndRecordFailure(loginId);
      // Log failed attempt
      await prisma.auditLog.create({
        data: {
          action: 'login_failed',
          entityType: 'enumerator',
          entityId: enumerator.id,
          enumeratorId: enumerator.id,
          ipAddress,
          details: { reason: 'invalid_password' },
        },
      });
      throw new UnauthorizedError('Invalid login credentials');
    }

    // H7 FIX: clear failure counter on successful login
    clearFailures(loginId);

    // Generate tokens
    const tokens = await this.generateTokens(enumerator.id, enumerator.loginId, enumerator.name, enumerator.isAdmin);

    // Store refresh token in session
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    await prisma.session.create({
      data: {
        enumeratorId: enumerator.id,
        // H2 FIX: store only the hash, never the raw token
        refreshToken: hashToken(tokens.refreshToken),
        deviceInfo,
        ipAddress,
        expiresAt,
      },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        action: 'login_success',
        entityType: 'enumerator',
        entityId: enumerator.id,
        enumeratorId: enumerator.id,
        ipAddress,
        details: { deviceInfo },
      },
    });

    logger.info(`Login successful: ${enumerator.loginId}`);

    return {
      tokens,
      enumerator: {
        id: enumerator.id,
        loginId: enumerator.loginId,
        name: enumerator.name,
        phone: enumerator.phone,
        email: enumerator.email,
        isAdmin: enumerator.isAdmin,
        districts: enumerator.districts.map(d => ({
          id: d.district.id,
          name: d.district.name,
          state: d.district.state,
        })),
      },
    };
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(refreshToken: string): Promise<TokenPair> {
    // H2 FIX: look up by hash of the incoming token, not the raw value
    const session = await prisma.session.findUnique({
      where: { refreshToken: hashToken(refreshToken) },
      include: {
        enumerator: true,
      },
    });

    if (!session || !session.isValid || session.expiresAt < new Date()) {
      if (session) {
        await prisma.session.update({
          where: { id: session.id },
          data: { isValid: false },
        });
      }
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    if (!session.enumerator.isActive) {
      throw new UnauthorizedError('Account has been deactivated');
    }

    // Invalidate old session
    await prisma.session.update({
      where: { id: session.id },
      data: { isValid: false },
    });

    // Generate new token pair
    const tokens = await this.generateTokens(
      session.enumerator.id,
      session.enumerator.loginId,
      session.enumerator.name,
      session.enumerator.isAdmin
    );

    // Create new session
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await prisma.session.create({
      data: {
        enumeratorId: session.enumerator.id,
        // H2 FIX: store only the hash, never the raw token
        refreshToken: hashToken(tokens.refreshToken),
        deviceInfo: session.deviceInfo,
        ipAddress: session.ipAddress,
        expiresAt,
      },
    });

    return tokens;
  }

  /**
   * Invalidate refresh token on logout
   */
  async logout(enumeratorId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      await prisma.session.updateMany({
        // H2 FIX: match by hash
        where: { enumeratorId, refreshToken: hashToken(refreshToken) },
        data: { isValid: false },
      });
    } else {
      // Invalidate all sessions for this enumerator
      await prisma.session.updateMany({
        where: { enumeratorId },
        data: { isValid: false },
      });
    }

    logger.info(`Logout: enumerator ${enumeratorId}`);
  }

  /**
   * Get enumerator profile with district assignments
   */
  async getProfile(enumeratorId: string): Promise<any> {
    const enumerator = await prisma.enumerator.findUnique({
      where: { id: enumeratorId },
      include: {
        districts: {
          include: { district: true },
        },
      },
    });

    if (!enumerator) {
      throw new NotFoundError('Enumerator');
    }

    return {
      id: enumerator.id,
      loginId: enumerator.loginId,
      name: enumerator.name,
      phone: enumerator.phone,
      email: enumerator.email,
      isAdmin: enumerator.isAdmin,
      districts: enumerator.districts.map(d => ({
        id: d.district.id,
        name: d.district.name,
        state: d.district.state,
      })),
    };
  }

  private async generateTokens(
    id: string,
    loginId: string,
    name: string,
    isAdmin: boolean
  ): Promise<TokenPair> {
    const accessToken = jwt.sign(
      { id, loginId, name, isAdmin },
      config.jwt.secret,
      { expiresIn: config.jwt.accessExpiry as any }
    );

    const refreshToken = uuidv4();

    return {
      accessToken,
      refreshToken,
      expiresIn: config.jwt.accessExpiry,
    };
  }
}
