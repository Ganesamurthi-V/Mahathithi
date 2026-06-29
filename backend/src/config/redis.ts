import { createClient } from 'redis';
import { config } from './index';
import { logger } from '../utils/logger';

// H7 FIX: Redis client for per-account brute-force lockout and other shared state
export const redisClient = createClient({ url: config.redis.url });

redisClient.on('error', (err) => {
  logger.error('[Redis] Error:', err);
});

redisClient.connect().catch((err) => {
  logger.error('[Redis] Failed to connect:', err);
});
