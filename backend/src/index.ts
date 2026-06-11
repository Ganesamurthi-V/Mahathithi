import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { config } from './config';
import { connectDatabase, disconnectDatabase } from './config/database';
import { errorHandler } from './middleware/error-handler';
import { generalLimiter } from './middleware/rate-limiter';
import { logger } from './utils/logger';

// Route imports
import authRoutes from './modules/auth/auth.routes';
import stakeholderRoutes from './modules/stakeholder/stakeholder.routes';
import surveyRoutes from './modules/survey/survey.routes';
import mediaRoutes from './modules/media/media.routes';
import dashboardRoutes from './modules/dashboard/dashboard.routes';
import syncRoutes from './modules/sync/sync.routes';
import phoneValidationRoutes from './modules/phone-validation/phone-validation.routes';
import adminRoutes from './modules/admin/admin.routes';

const app = express();

// ============================================================================
// MIDDLEWARE
// ============================================================================

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({
  origin: config.env === 'production'
    ? ['https://mahaathithi.gov.in', 'http://localhost:5173']
    : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173'],
  credentials: true,
}));
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(generalLimiter);

// ============================================================================
// ROUTES
// ============================================================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'MahaAthithi API',
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
║           MahaAthithi API Server                 ║
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
