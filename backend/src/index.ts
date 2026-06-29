import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { config } from './config';
import { connectDatabase, disconnectDatabase } from './config/database';
import { errorHandler } from './middleware/error-handler';
import cookieParser from 'cookie-parser';
import { generalLimiter } from './middleware/rate-limiter';
import { logger } from './utils/logger';

// Route imports
import authRoutes from './modules/auth/auth.routes';
import stakeholderRoutes from './modules/stakeholder/stakeholder.routes';
import surveyRoutes from './modules/survey/survey.routes';
import mediaRoutes from './modules/media/media.routes';
import facilitiesRoutes from './modules/facilities/facilities.routes';
import dashboardRoutes from './modules/dashboard/dashboard.routes';
import syncRoutes from './modules/sync/sync.routes';
import phoneValidationRoutes from './modules/phone-validation/phone-validation.routes';
import adminRoutes from './modules/admin/admin.routes';

const app = express();

// Trust Railway's reverse proxy for express-rate-limit
app.set('trust proxy', 1);

// ============================================================================
// MIDDLEWARE
// ============================================================================

// C8 FIX: add a strict Content-Security-Policy as the minimum-viable mitigation
// for the admin panel storing tokens in localStorage. A locked-down CSP shrinks
// the XSS surface that could read those tokens. (The long-term fix remains moving
// the admin session to httpOnly+Secure+SameSite cookies.)
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", 'https://mahaatithi.gov.in'],
      imgSrc: ["'self'", 'data:', 'https:'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
}));
// M3 FIX: removed 'http://localhost:5173' from production CORS allowlist
app.use(cors({
  origin: config.env === 'production'
    ? ['https://mahaatithi.gov.in', 'https://mahathithi.vercel.app', 'http://localhost:5173']
    : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173', 'https://mahathithi.vercel.app'],
  credentials: true,
}));
app.use(compression());
app.use(cookieParser());
// M1 FIX: lowered global body limit from 50MB to 1MB.
// The 50MB limit is applied only on the sync upload route (see sync.routes.ts).
// Applying it globally let anyone abuse cheap endpoints like /auth/login
// with huge payloads, creating easy memory-pressure attacks.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(generalLimiter);

// M6 FIX: in production, redirect plain HTTP to HTTPS.
// Railway already terminates TLS, but making the app enforce it too provides
// a safety net in case the TLS offload config is ever changed.
if (config.env === 'production') {
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

// ============================================================================
// ROUTES
// ============================================================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'MahaAtithi API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: config.env,
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/stakeholders', stakeholderRoutes);
app.use('/api/surveys', surveyRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/facilities', facilitiesRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/phone-validation', phoneValidationRoutes);
app.use('/api/admin', adminRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
});

// Error handler (must be last)
app.use(errorHandler);

// ============================================================================
// SERVER STARTUP
// ============================================================================

async function startServer() {
  try {
    // Connect to database
    await connectDatabase();

    // Start server
    const server = app.listen(config.port, () => {
      logger.info(`
╔══════════════════════════════════════════════════╗
║           MahaAtithi API Server                 ║
║══════════════════════════════════════════════════║
║  🚀 Server:    http://localhost:${config.port}          ║
║  🏗️  Env:       ${config.env.padEnd(30)}║
║  📊 Database:  Connected                        ║
║  🕐 Started:   ${new Date().toISOString().padEnd(30)}║
╚══════════════════════════════════════════════════╝
      `);
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`\n${signal} received. Shutting down gracefully...`);
      server.close(async () => {
        await disconnectDatabase();
        process.exit(0);
      });

      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

export default app;
