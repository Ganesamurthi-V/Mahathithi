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

  aws: {
    region: process.env.AWS_REGION || 'ap-south-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    s3Bucket: process.env.S3_BUCKET_NAME || 'mahaatithi-media',
    s3Endpoint: process.env.S3_ENDPOINT || undefined,
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
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
