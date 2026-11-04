import rateLimit from 'express-rate-limit';
import { config } from '../config';

/** Path of the typeahead endpoint; it has its own, higher limit (see suggestLimiter). */
export const SUGGEST_PATH = '/api/stakeholders/suggest';

function isSuggestRequest(originalUrl: string): boolean {
  return originalUrl.split('?')[0].replace(/\/+$/, '') === SUGGEST_PATH;
}

export const generalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  // Typing in the suggestion box legitimately sends a few requests a second. Counted here it
  // would use up the whole per-minute allowance in seconds and block every other call from the
  // same address. It is limited separately, and tighter per user, by suggestLimiter.
  skip: (req) => isSuggestRequest(req.originalUrl),
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please try again later.',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export const loginLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.loginMax,
  message: {
    success: false,
    error: {
      code: 'LOGIN_RATE_LIMITED',
      message: 'Too many login attempts. Please try again in 1 minute.',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

export const uploadLimiter = rateLimit({
  windowMs: 60000,
  max: 30,
  message: {
    success: false,
    error: {
      code: 'UPLOAD_RATE_LIMITED',
      message: 'Too many uploads. Please slow down.',
    },
  },
});

/**
 * The suggestions endpoint: generous (a person typing sends several a second) but still bounded.
 * Keyed by user, not address, so everyone in an office behind one network address does not share
 * a single allowance. It runs after authentication, so the user is always known.
 */
export const suggestLimiter = rateLimit({
  windowMs: 60000,
  max: 300,
  keyGenerator: (req) => (req as any).enumerator?.id ?? 'unauthenticated',
  message: {
    success: false,
    error: {
      code: 'SUGGEST_RATE_LIMITED',
      message: 'Too many suggestion requests. Please slow down.',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});
