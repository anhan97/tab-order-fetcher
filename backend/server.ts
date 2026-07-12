import express from 'express';
import cors from 'cors';
import shopifyRoutes from './src/routes/shopify.routes';
import cogsRoutes from './src/routes/cogs.routes';
import comprehensiveCogsRoutes from './src/routes/comprehensive-cogs.routes';
import facebookRoutes from './src/routes/facebook.routes';
import plRoutes from './src/routes/pl.routes';
import adsLaunchRoutes from './src/routes/ads-launch.routes';
import authRoutes from './src/routes/auth.routes';
import adminRoutes from './src/routes/admin.routes';
import ordersRoutes from './src/routes/orders.routes';
import shopifyOAuthRoutes from './src/routes/shopify-oauth.routes';
import webhooksRoutes from './src/routes/webhooks.routes';
import { startPLScheduler } from './src/jobs/pl-scheduler';
import { startOrderSyncScheduler } from './src/jobs/order-sync-scheduler';
// Adlux scheduler retired — System User mode was rolled back to a simple
// FB Login flow. Import kept commented for the rollback path.
// import { startAdluxScheduler } from './src/jobs/fb-adlux-scheduler';
import { startFbTokenRefreshScheduler } from './src/jobs/fb-token-refresh';
import { startFbMetricsScheduler } from './src/jobs/fb-metrics-scheduler';
import config from './src/config/app';

const app = express();
const port = config.port;

// CORS configuration
app.use(cors({
  origin: config.corsOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Shopify-Store-Domain',
    'X-Shopify-Store-URL',
    'X-Shopify-Access-Token',
    'X-User-Id',
    'X-Store-Id',
    'Accept'
  ],
  credentials: true
}));

// Body parser middleware. `verify` captures the raw body — required to
// check Shopify webhook HMAC signatures (they sign the exact bytes).
app.use(express.json({
  verify: (req: any, _res, buf) => { req.rawBody = buf.toString(); }
}));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/shopify/oauth', shopifyOAuthRoutes);
app.use('/api/webhooks', webhooksRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/shopify', shopifyRoutes);
app.use('/api/cogs', cogsRoutes);
app.use('/api/comprehensive-cogs', comprehensiveCogsRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/facebook', facebookRoutes);
app.use('/api/pl', plRoutes);
app.use('/api/ads', adsLaunchRoutes);

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({ status: 'Backend is running!' });
});

// Error handling middleware
app.use((err: any, req: any, res: any, next: any) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

app.listen(port, () => {
  console.log(`Backend server running on port ${port}`);
  console.log('CORS enabled for origin:', process.env.FRONTEND_URL || 'http://localhost:8080');
  if (process.env.PL_SCHEDULER_DISABLED !== '1') {
    startPLScheduler();
  }
  // startAdluxScheduler() — retired with the System User mode rollback.
  startFbTokenRefreshScheduler();
  if (process.env.FB_METRICS_SCHEDULER_DISABLED !== '1') {
    startFbMetricsScheduler();
  }
  startOrderSyncScheduler();
});
