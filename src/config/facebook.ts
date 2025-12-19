// Validate frontend environment variable
if (!import.meta.env.VITE_FACEBOOK_APP_ID) {
  console.error('VITE_FACEBOOK_APP_ID is not set in frontend .env file');
  throw new Error('Facebook App ID is not configured. Please check your frontend .env file in the root directory.');
}

// Get optional config ID for Business Login
const configId = import.meta.env.VITE_FACEBOOK_CONFIG_ID;

export const FACEBOOK_CONFIG = {
  appId: import.meta.env.VITE_FACEBOOK_APP_ID,
  configId: configId || '', // Facebook Business Login Configuration ID
  version: 'v21.0',
  // Use Business Login - these scopes are configured in Facebook Business Settings
  // ads_management: Create, edit, and manage ads
  // ads_read: View ads and insights
  // business_management: Manage business assets
  scope: 'ads_management,ads_read,business_management',
  // Use Business Login instead of regular Facebook Login
  useBusinessLogin: true,
  fields: {
    adAccounts: 'id,name,account_status,currency,business_name,timezone_name',
    campaigns: 'id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time',
    adsets: 'id,name,campaign_id,status,daily_budget,lifetime_budget',
    ads: 'id,name,adset_id,status,creative'
  }
};