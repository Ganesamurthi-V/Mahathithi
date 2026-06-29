import winston from 'winston';
import { config } from '../config';

// L4 FIX: Redact sensitive fields from log meta before they can be written to
// log files or shipped to an external sink (Datadog, CloudWatch, etc.).
// Operates on top-level keys only — nested objects are left as-is intentionally
// (deep redaction risks clobbering legitimate structured payloads).
const SENSITIVE_KEYS = new Set([
  'loginId', 'password', 'phone', 'email',
  'mobileNumber', 'mobileNumber2', 'email2',
  'gstNumber', 'refreshToken', 'accessToken',
]);

function redactMeta(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) =>
      SENSITIVE_KEYS.has(k) ? [k, '[REDACTED]'] : [k, v]
    )
  );
}

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    if (stack) log += `\n${stack}`;
    if (Object.keys(meta).length > 0) {
      log += ` ${JSON.stringify(redactMeta(meta))}`;
    }
    return log;
  })
);

export const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      ),
    }),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 10,
    }),
  ],
});
