// Frontend configuration
export const config = {
  // API Base URLs
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api',
  
  // Shopify API
  shopifyApiUrl: import.meta.env.VITE_SHOPIFY_API_URL || 'http://localhost:3001/api/shopify',
  
  // COGS API
  cogsApiUrl: import.meta.env.VITE_COGS_API_URL || 'http://localhost:3001/api/cogs',
  
  // Facebook API
  facebookApiUrl: import.meta.env.VITE_FACEBOOK_API_URL || 'http://localhost:3001/api/facebook',
  
  // Environment
  nodeEnv: import.meta.env.MODE || 'development',
  
  // App Settings
  appName: import.meta.env.VITE_APP_NAME || 'Tab Order Fetcher',
  appVersion: import.meta.env.VITE_APP_VERSION || '1.0.0',
  
  // Feature Flags
  enableAnalytics: import.meta.env.VITE_ENABLE_ANALYTICS === 'true',
  enableFacebookAds: import.meta.env.VITE_ENABLE_FACEBOOK_ADS === 'true',
  enableCOGS: import.meta.env.VITE_ENABLE_COGS === 'true',
};

export default config;
