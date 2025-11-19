export const FACEBOOK_CONFIG = {
  appId: process.env.FACEBOOK_APP_ID || '',
  appSecret: process.env.FACEBOOK_APP_SECRET || '',
  version: 'v23.0',
  scopes: [
    'ads_read',
    'ads_management',
    'business_management',
    'read_insights'
  ],
  callbackURL: process.env.FACEBOOK_CALLBACK_URL || 'http://localhost:8080/auth/facebook/callback'
}; 