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
  // business_management: Manage business assets (BM-owned pages, pixels)
  // pages_show_list: required by /promote_pages + /me/accounts. Without
  //                  this the Page dropdown in the campaign builder is
  //                  empty even when the user is admin on those pages.
  // pages_read_engagement: needed to read page metadata + the linked
  //                  instagram_business_account that ads need.
  // instagram_basic: without it Meta returns no Instagram account at all
  //                  (page link or ad account's), so ads can't pick one.
  //                  Optional: not in REQUIRED_SCOPES, declining it only
  //                  leaves ads showing as the Facebook page on Instagram.
  //                  With a Business Login configuration (config_id) the
  //                  permissions come from that configuration instead.
  scope: 'ads_management,ads_read,business_management,pages_show_list,pages_read_engagement,instagram_basic',
  // Use Business Login instead of regular Facebook Login
  useBusinessLogin: true,
  fields: {
    adAccounts: 'id,name,account_status,currency,business_name,timezone_name',
    campaigns: 'id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time',
    adsets: 'id,name,campaign_id,status,daily_budget,lifetime_budget',
    ads: 'id,name,adset_id,status,creative'
  }
};