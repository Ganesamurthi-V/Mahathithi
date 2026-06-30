import dotenv from 'dotenv';
dotenv.config();

/**
 * C1 FIX: Fail fast at boot if a required environment variable is missing or
 * too short. This prevents the server from starting silently with dangerous
 * defaults (e.g. the hardcoded JWT secret that was previously in this file).
 */
function requireEnv(name: string, minLength = 1): string {
  const value = process.env[name];
  if (!value || value.length < minLength) {
    throw new Error(
      `[STARTUP] Missing or invalid required environment variable: ${name}` +
      (minLength > 1 ? ` (must be at least ${minLength} characters)` : '')
    );
  }
  return value;
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),

  database: {
    // C1 FIX: runtime guarantee — if DATABASE_URL is absent, crash immediately
    url: requireEnv('DATABASE_URL'),
  },

  jwt: {
    // C1 FIX: require at least 32 chars so no one accidentally ships with a weak secret
    secret: requireEnv('JWT_SECRET', 32),
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  },

  // SYNC FIX: previously these silently defaulted to '' when unset, which
  // let the server boot fine, accept logins, and accept survey-text syncs,
  // but every single media (photo/video) upload would then fail at the S3
  // SDK call with a raw credentials error. That error isn't a ZodError,
  // AppError, or recognized Prisma error, so error-handler.ts's catch-all
  // turned it into an opaque `{"code":"INTERNAL_ERROR","message":"An
  // unexpected error occurred"}` 500 — with zero indication the actual
  // cause was a missing/blank AWS credential or bucket name. Using
  // requireEnv() here means a misconfigured deploy crashes immediately at
  // startup with a clear message, instead of failing silently and only on
  // the media-upload path in production.
  aws: {
    region: process.env.AWS_REGION || 'ap-south-1',
    accessKeyId: requireEnv('AWS_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('AWS_SECRET_ACCESS_KEY'),
    s3Bucket: requireEnv('S3_BUCKET_NAME'),
    s3Endpoint: process.env.S3_ENDPOINT || undefined,
  },

  upstash: {
    // Upstash Redis REST — required for brute-force lockout across instances.
    url: requireEnv('UPSTASH_REDIS_REST_URL'),
    token: requireEnv('UPSTASH_REDIS_REST_TOKEN'),
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
    loginMax: parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '5', 10),
  },

  csv: {
    batchSize: parseInt(process.env.CSV_BATCH_SIZE || '1000', 10),
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
};