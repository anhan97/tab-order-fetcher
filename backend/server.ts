import express from 'express';
import cors from 'cors';
import shopifyRoutes from './src/routes/shopify.routes';
import cogsRoutes from './src/routes/cogs.routes';
import comprehensiveCogsRoutes from './src/routes/comprehensive-cogs.routes';
import facebookRoutes from './src/routes/facebook.routes';
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

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/shopify', shopifyRoutes);
app.use('/api/cogs', cogsRoutes);
app.use('/api/comprehensive-cogs', comprehensiveCogsRoutes);
app.use('/api/facebook', facebookRoutes);

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
}); 