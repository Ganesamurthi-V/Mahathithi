import { Redis } from '@upstash/redis';
import { config } from './index';

// H7 FIX: Upstash Redis REST client for per-account brute-force lockout.
// HTTP-based — no persistent TCP connection, no connect/reconnect lifecycle,
// works across serverless and multi-instance deployments out of the box.
export const redisClient = new Redis({
  url: config.upstash.url,
  token: config.upstash.token,
});
