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

import { redisClient } from '../../config/redis';

/**
 * H7 FIX: per-account brute-force lockout via Redis.
 *
 * This locks a specific loginId after MAX_FAILED_ATTEMPTS consecutive bad passwords,
 * regardless of how many different IPs were used. Using Redis instead of an
 * in-memory Map ensures lockouts work across multi-instance deployments (like Railway)
 * and survive server restarts, while auto-expiring keys prevent memory leaks.
 */
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 15 * 60; // 15 minutes

async function checkLocked(loginId: string): Promise<void> {
  try {
    const locked = await redisClient.get(`login_lock:${loginId}`);
    if (locked) {
      throw new UnauthorizedError(
        'Account temporarily locked due to too many failed attempts. Please try again in 15 minutes.'
      );
    }
  } catch (err) {
    // Re-throw the intentional lockout; swallow only Redis transport errors.
    if (err instanceof AppError) throw err;
    // H7 FIX: fail open — a Redis outage must not block all logins.
    logger.error('[Redis] checkLocked failed, allowing login:', err);
  }
}

async function checkAndRecordFailure(loginId: string): Promise<void> {
  try {
    const key = `login_attempts:${loginId}`;
    const attempts = await redisClient.incr(key);
    await redisClient.expire(key, LOCKOUT_SECONDS);

    if (attempts >= MAX_FAILED_ATTEMPTS) {
      await redisClient.set(`login_lock:${loginId}`, '1', { ex: LOCKOUT_SECONDS });
    }
  } catch (err) {
    // H7 FIX: never let a brute-force bookkeeping failure 500 the login response.
    logger.error('[Redis] checkAndRecordFailure failed:', err);
  }
}

async function clearFailures(loginId: string): Promise<void> {
  try {
    await redisClient.del(`login_attempts:${loginId}`);
    await redisClient.del(`login_lock:${loginId}`);
  } catch (err) {
    logger.error('[Redis] clearFailures failed:', err);
  }
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
    await checkLocked(loginId);

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
      await checkAndRecordFailure(loginId);
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
    await clearFailures(loginId);

    // Generate tokens
    const tokens = await this.generateTokens(enumerator.id, enumerator.loginId, enumerator.name, enumerator.isAdmin);

    // Store refresh token in session.
    // Lifetime is configurable and slides forward on every refresh, so an active
    // enumerator is never signed out. See config.jwt.sessionExpiryDays.
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + config.jwt.sessionExpiryDays);

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
   * Issue a fresh access token from a refresh token.
   *
   * IDEMPOTENT AND NON-ROTATING — this is deliberate, and it is half of the fix
   * for enumerators being signed out when they reopened the app.
   *
   * The previous implementation rotated: it flipped the presented session to
   * isValid=false and inserted a brand-new row. That made the operation
   * single-use, which the mobile client cannot honour. Reopening the app after
   * more than the 15-minute access-token lifetime fires a burst of concurrent
   * requests (session check, initial sync, realtime auth, dashboard, sync
   * heartbeat); all of them 401 and all of them refresh with the same stored
   * token. One won, the rest presented a token invalidated microseconds earlier,
   * received 401 from this endpoint, and the client correctly interpreted that
   * as a revoked session and signed the user out.
   *
   * The client now coalesces concurrent refreshes into one call, but relying on
   * that alone would leave a real failure mode: if the app is killed after the
   * server rotated but before the new token reached EncryptedStorage, the only
   * valid token is lost and the user is locked out with no recourse.
   *
   * So the session row is now stable. The same refresh token stays valid and
   * each use slides expires_at forward, so an active user is never signed out.
   *
   * Security trade-off, stated plainly: without rotation a leaked refresh token
   * remains usable until the session is explicitly invalidated, and reuse of a
   * stolen token is no longer detectable by rotation. Accepted here because the
   * token is a random uuid stored only as a SHA-256 hash server-side, held in
   * Keychain/Keystore on the device, and the alternative — signing field staff
   * out mid-survey and stranding unsynced work — is the more damaging failure.
   * Revocation still works through logout and the isActive check below.
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

    // Slide the expiry window forward. Keeps an active device signed in
    // indefinitely while still letting a genuinely abandoned session lapse.
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + config.jwt.sessionExpiryDays);

    await prisma.session.update({
      where: { id: session.id },
      data: { expiresAt },
    });

    const accessToken = this.signAccessToken(
      session.enumerator.id,
      session.enumerator.loginId,
      session.enumerator.name,
      session.enumerator.isAdmin
    );

    // Return the SAME refresh token. The client only overwrites its stored copy
    // when the value differs, so this is a no-op on the device.
    return {
      accessToken,
      refreshToken,
      expiresIn: config.jwt.accessExpiry,
    };
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

  /**
   * Sign a short-lived access token. Extracted so refreshToken() can mint a new
   * access token without also minting a refresh token it does not want to rotate.
   */
  private signAccessToken(
    id: string,
    loginId: string,
    name: string,
    isAdmin: boolean
  ): string {
    return jwt.sign(
      { id, loginId, name, isAdmin },
      config.jwt.secret,
      { expiresIn: config.jwt.accessExpiry as any }
    );
  }

  private async generateTokens(
    id: string,
    loginId: string,
    name: string,
    isAdmin: boolean
  ): Promise<TokenPair> {
    return {
      accessToken: this.signAccessToken(id, loginId, name, isAdmin),
      // Opaque random value, not a JWT. Its lifetime is enforced entirely by
      // sessions.expires_at, and only its SHA-256 hash is persisted.
      refreshToken: uuidv4(),
      expiresIn: config.jwt.accessExpiry,
    };
  }
}
