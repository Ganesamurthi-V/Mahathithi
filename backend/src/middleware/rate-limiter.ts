import rateLimit from 'express-rate-limit';
import { config } from '../config';

export const generalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
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
