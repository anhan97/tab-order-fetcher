// Validate frontend environment variable
if (!import.meta.env.VITE_FACEBOOK_APP_ID) {
  console.error('VITE_FACEBOOK_APP_ID is not set in frontend .env file');
  throw new Error('Facebook App ID is not configured. Please check your frontend .env file in the root directory.');
}

export const FACEBOOK_CONFIG = {
  appId: import.meta.env.VITE_FACEBOOK_APP_ID,
  version: 'v18.0',
  scope: 'ads_management,ads_read,read_insights,business_management',
  fields: {
    adAccounts: 'id,name,account_status,currency,business_name,timezone_name',
    campaigns: 'id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time',
    adsets: 'id,name,campaign_id,status,daily_budget,lifetime_budget',
    ads: 'id,name,adset_id,status,creative'
  }
}; 