import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // Server
  port: process.env.PORT || 3001,
  
  // Database
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/tab_order_fetcher',
  
  // CORS
  corsOrigins: process.env.CORS_ORIGINS 
    ? process.env.CORS_ORIGINS.split(',').map(origin => origin.trim())
    : ['localhost:8080'], // Default to localhost only if not set
  
  // JWT
  jwtSecret: process.env.JWT_SECRET || 'your-secret-key-change-this-in-production',
  
  // Frontend URL (for backward compatibility)
  frontendUrl: process.env.FRONTEND_URL || 'locahost:8080',
  
  // Environment
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // API URLs
  shopifyApiVersion: process.env.SHOPIFY_API_VERSION || '2025-10',
  facebookApiVersion: process.env.FACEBOOK_API_VERSION || 'v18.0',
};

export default config;
