import { FacebookCampaign, FacebookAdSet, FacebookAd, FacebookAdAccount } from '@/types/facebook';
import { FACEBOOK_CONFIG } from '@/config/facebook';
import { buildHeaders } from '@/utils/apiClient';
import { format } from 'date-fns';

const FACEBOOK_API_VERSION = FACEBOOK_CONFIG.version;
const FACEBOOK_API_BASE_URL = `https://graph.facebook.com/${FACEBOOK_API_VERSION}`;
const FACEBOOK_APP_ID = FACEBOOK_CONFIG.appId;
const FACEBOOK_APP_SECRET = import.meta.env.VITE_FACEBOOK_APP_SECRET;

interface FacebookApiError {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    fbtrace_id: string;
  };
}

interface FacebookApiResponse<T> {
  data: T[];
  paging?: {
    cursors: {
      before: string;
      after: string;
    };
    next?: string;
  };
}

interface FacebookLoginResponse {
  status: 'connected' | 'not_authorized' | 'unknown';
  authResponse: {
    accessToken: string;
    userID: string;
    expiresIn: number;
  } | null;
}

const validateDateRange = (fromDate: Date, toDate: Date) => {
  const now = new Date();
  // Ensure dates are not in the future
  if (fromDate > now || toDate > now) {
    const adjustedFromDate = new Date(now);
    adjustedFromDate.setDate(now.getDate() - 30); // Default to last 30 days
    return {
      from: adjustedFromDate,
      to: now
    };
  }
  return { from: fromDate, to: toDate };
};

export const fetchUserAdAccounts = async (accessToken: string): Promise<{ id: string; name: string }[]> => {
  try {
    const response = await fetch(
      `${FACEBOOK_API_BASE_URL}/me/adaccounts?fields=id,name,account_status&access_token=${accessToken}`
    );
    const data = await response.json();
    
    if (!response.ok) {
      const error = data as FacebookApiError;
      throw new Error(`Facebook API Error: ${error.error?.message || 'Unknown error'}`);
    }

    return (data.data || [])
      .filter((account: any) => account.account_status === 1) // Only return active accounts
      .map((account: any) => ({
        id: account.id.replace('act_', ''),
        name: account.name
      }));
  } catch (error) {
    console.error('Error fetching ad accounts:', error);
    throw error;
  }
};

const fetchFacebookData = async <T>(endpoint: string, params: Record<string, string>): Promise<T[]> => {
  const results: T[] = [];
  let nextPage = `${endpoint}?${new URLSearchParams(params).toString()}`;

  while (nextPage) {
    const response = await fetch(nextPage);
    const data: FacebookApiResponse<T> = await response.json();
    
    if (!response.ok) {
      const error = data as unknown as FacebookApiError;
      throw new Error(`Facebook API Error: ${error.error?.message || 'Unknown error'}`);
    }

    if (data.data) {
      results.push(...data.data);
    }

    nextPage = data.paging?.next || '';
  }

  return results;
};

// Update the insights fields to include all required metrics
const INSIGHTS_FIELDS = [
  'spend',
  'impressions',
  'clicks',
  'unique_clicks',
  'ctr',
  'unique_ctr',
  'cpc',
  'cpm',
  'reach',
  'frequency',
  'actions',
  'action_values',
  'cost_per_action_type',
  'purchase_roas',
  'video_p25_watched_actions',
  'video_p50_watched_actions',
  'video_p75_watched_actions',
  'video_p95_watched_actions',
  'video_p100_watched_actions',
  'video_play_actions',
  'video_continuous_2_sec_watched_actions',
  'video_thruplay_watched_actions',
  'website_purchase_roas',
  'conversion_values',
  'conversions',
  'cost_per_conversion'
].join(',');

// Update campaign fields to include insights
const CAMPAIGN_FIELDS = [
  'id',
  'name',
  'status',
  'objective',
  'start_time',
  'stop_time',
  'daily_budget',
  'lifetime_budget',
  `insights{${INSIGHTS_FIELDS}}`
].join(',');

// Update ad set fields
const ADSET_FIELDS = [
  'id',
  'name',
  'campaign_id',
  'status',
  'daily_budget',
  'lifetime_budget',
  `insights{${INSIGHTS_FIELDS}}`
].join(',');

// Update ad fields
const AD_FIELDS = [
  'id',
  'name',
  'adset_id',
  'status',
  'creative{id,thumbnail_url,image_url,body,title,call_to_action_type}',
  `insights{${INSIGHTS_FIELDS}}`
].join(',');

async function handleFacebookResponse(response: Response, endpoint: string) {
  if (!response.ok) {
    let errorMessage = `HTTP Error ${response.status}`;
    try {
      const errorData = await response.json();
      console.error(`Facebook API Error (${endpoint}):`, errorData);
      errorMessage = errorData?.error?.message || response.statusText;
    } catch (e) {
      console.error(`Failed to parse error response from ${endpoint}:`, e);
    }
    throw new Error(`Facebook API Error: ${errorMessage}`);
  }
  return response.json();
}

function transformInsights(insights: any) {
  const data = insights?.data?.[0] || {};
  const actions = data.actions || [];
  const actionValues = data.action_values || [];
  const costPerActions = data.cost_per_action_type || [];
  
  const getActionValue = (actionType: string) => {
    const action = actions.find((a: any) => a.action_type === actionType);
    return action ? parseFloat(action.value) || 0 : 0;
  };
  
  const getActionAmount = (actionType: string) => {
    const value = actionValues.find((a: any) => a.action_type === actionType);
    return value ? parseFloat(value.value) || 0 : 0;
  };
  
  const getCostPerAction = (actionType: string) => {
    const cost = costPerActions.find((a: any) => a.action_type === actionType);
    return cost ? parseFloat(cost.value) || 0 : 0;
  };

  return {
    spend: parseFloat(data.spend || '0'),
    impressions: parseInt(data.impressions || '0', 10),
    clicks: parseInt(data.clicks || '0', 10),
    unique_clicks: parseInt(data.unique_clicks || '0', 10),
    ctr: parseFloat(data.ctr || '0'),
    unique_ctr: parseFloat(data.unique_ctr || '0'),
    cpc: parseFloat(data.cpc || '0'),
    cpm: parseFloat(data.cpm || '0'),
    reach: parseInt(data.reach || '0', 10),
    frequency: parseFloat(data.frequency || '0'),
    add_to_cart: getActionValue('add_to_cart'),
    initiate_checkout: getActionValue('initiate_checkout'),
    purchase: getActionValue('purchase'),
    purchase_value: getActionAmount('purchase'),
    cost_per_result: getCostPerAction('purchase'),
    roas: data.purchase_roas?.[0]?.value || 0,
    video_plays: getActionValue('video_play'),
    hook_rate: data.impressions ? (getActionValue('video_play') / parseInt(data.impressions, 10)) * 100 : 0,
    cost_per_unique_click: parseFloat(data.cost_per_unique_click || '0')
  };
}

function transformCampaign(campaign: any) {
  return {
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    objective: campaign.objective,
    budget: parseFloat(campaign.daily_budget || campaign.lifetime_budget || '0'),
    ...transformInsights(campaign.insights)
  };
}

function transformAdSet(adset: any) {
  return {
    id: adset.id,
    campaignId: adset.campaign_id,
    name: adset.name,
    status: adset.status,
    budget: parseFloat(adset.daily_budget || adset.lifetime_budget || '0'),
    ...transformInsights(adset.insights)
  };
}

function transformAd(ad: any) {
  return {
    id: ad.id,
    adsetId: ad.adset_id,
    name: ad.name,
    status: ad.status,
    creative: ad.creative ? {
      id: ad.creative.id,
      thumbnail_url: ad.creative.thumbnail_url,
      image_url: ad.creative.image_url,
      body: ad.creative.body,
      title: ad.creative.title,
      call_to_action_type: ad.creative.call_to_action_type
    } : null,
    ...transformInsights(ad.insights)
  };
}

/**
 * Fetch campaigns + adsets + ads + insights for an account/date-range.
 *
 * SECURITY: token NO LONGER passed via URL. Backend resolves the right
 * token (Adlux pool or per-user DB) based on the authenticated session
 * (Shopify domain headers from the caller's context). The `accessToken`
 * argument is kept for back-compat but ignored — sent via Shopify-auth
 * headers only.
 *
 * Auth headers must be set by the caller via `setAuthHeaders` below.
 */
let currentAuthHeaders: Record<string, string> = {};
export function setFacebookApiAuthHeaders(headers: Record<string, string>) {
  currentAuthHeaders = headers;
}

export async function fetchAdAccountData(
  accountId: string,
  _accessToken: string,  // ignored — kept for back-compat, will remove next refactor
  dateRange: { from: Date; to: Date }
) {
  const formattedFrom = format(dateRange.from, 'yyyy-MM-dd');
  const formattedTo = format(dateRange.to, 'yyyy-MM-dd');

  const params = new URLSearchParams({
    accountId,
    since: formattedFrom,
    until: formattedTo
  });

  // Merge the JWT + active-store headers on top of whatever the caller
  // registered via setFacebookApiAuthHeaders — callers like AppContext
  // never call it, and without the Bearer the backend resolved a different
  // (legacy synthetic) user than the one the FB token was stored under.
  const res = await fetch(`/api/facebook/account-data?${params}`, {
    headers: buildHeaders(currentAuthHeaders)
  });
  if (!res.ok) {
    let body: { error?: string; reason?: string; fbCode?: number } = {};
    try { body = await res.json(); } catch { /* ignore */ }
    const err = new Error(body.error || `Backend error ${res.status}`) as Error & { reason?: string; fbCode?: number };
    err.reason = body.reason;
    err.fbCode = body.fbCode;
    throw err;
  }

  const data = await res.json();
  return {
    campaigns: data.campaigns || [],
    adsets: data.adsets || [],
    ads: data.ads || [],
    meta: data.meta
  };
}

async function exchangeForLongLivedToken(shortLivedToken: string): Promise<string> {
  try {
    const response = await fetch(
      `https://graph.facebook.com/${FACEBOOK_API_VERSION}/oauth/access_token?` +
      `grant_type=fb_exchange_token&` +
      `client_id=${FACEBOOK_APP_ID}&` +
      `client_secret=${FACEBOOK_APP_SECRET}&` +
      `fb_exchange_token=${shortLivedToken}`
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Failed to exchange token');
    }

    const data = await response.json();
    return data.access_token;
  } catch (error) {
    console.error('Error exchanging for long-lived token:', error);
    throw error;
  }
}

export class FacebookAdsApiClient {
  private static instance: FacebookAdsApiClient | null = null;
  // Per-user FB App ID override. When set BEFORE the first SDK init, the SDK
  // initialises with this user's app rather than the env-default. Critical
  // for the multi-app architecture (each user owns their own FB App so a
  // compliance flag on one app doesn't take down everyone else).
  private static appIdOverride: string | null = null;
  private accessToken: string | null = null;
  private userId: string | null = null;
  private sdkLoaded = false;
  private sdkLoadPromise: Promise<void> | null = null;

  private constructor() {
    // Load saved data from localStorage
    const savedData = FacebookAdsApiClient.fromLocalStorage();
    if (savedData) {
      this.accessToken = savedData.accessToken;
      this.userId = savedData.userId;
    }
  }

  static getInstance(): FacebookAdsApiClient {
    if (!FacebookAdsApiClient.instance) {
      FacebookAdsApiClient.instance = new FacebookAdsApiClient();
    }
    return FacebookAdsApiClient.instance;
  }

  /**
   * Configure the FB App ID to use for SDK init. MUST be called before the
   * first call to login()/ensureSDKLoaded() — once SDK is loaded with one
   * app, switching requires a page reload (FB SDK can't re-init cleanly).
   *
   * Pass null to clear the override (fall back to env default).
   */
  static configureAppId(appId: string | null): void {
    if (FacebookAdsApiClient.instance?.sdkLoaded && appId !== FacebookAdsApiClient.appIdOverride) {
      console.warn('[FB-SDK] configureAppId called after SDK load — change requires page reload to take effect.');
    }
    FacebookAdsApiClient.appIdOverride = appId;
  }

  /** The active App ID (per-user override if set, else env default). */
  static getActiveAppId(): string {
    return FacebookAdsApiClient.appIdOverride || FACEBOOK_APP_ID;
  }

  private async initializeFacebookSDK(): Promise<void> {
    if (this.sdkLoadPromise) {
      return this.sdkLoadPromise;
    }

    this.sdkLoadPromise = new Promise((resolve, reject) => {
      const activeAppId = FacebookAdsApiClient.getActiveAppId();
      if (!activeAppId) {
        reject(new Error('No FB App ID configured. Set up your FB App in Settings → Facebook App.'));
        return;
      }

      const initFb = () => {
        try {
          window.FB.init({
            appId: activeAppId,
            cookie: true,
            xfbml: true,
            version: FACEBOOK_API_VERSION
          });
          this.sdkLoaded = true;
          resolve();
        } catch (e: any) {
          reject(new Error(`FB.init failed: ${e?.message || String(e)}`));
        }
      };

      // Path 1: SDK already loaded by a prior call. fbAsyncInit only fires
      // once per script load — relying on it would deadlock until timeout.
      if (typeof window.FB !== 'undefined' && typeof window.FB.init === 'function') {
        initFb();
        return;
      }

      // Path 2: Script tag is in the DOM but FB hasn't finished booting yet.
      // Set fbAsyncInit and let it fire when ready. Race with a timeout +
      // an explicit script onerror so an ad-blocker doesn't hang us 15s.
      const timeout = setTimeout(() => {
        reject(new Error(
          'Facebook SDK load timeout. The browser blocked connect.facebook.net — common causes: ad-blocker (uBlock, Brave Shields, AdGuard), corporate firewall, or DNS issue. Disable the blocker for this site and retry.'
        ));
      }, 15000);

      window.fbAsyncInit = () => {
        clearTimeout(timeout);
        initFb();
      };

      const existing = document.getElementById('facebook-jssdk') as HTMLScriptElement | null;
      const handleLoadError = () => {
        clearTimeout(timeout);
        reject(new Error(
          'Facebook SDK script failed to load (connect.facebook.net unreachable). Check your network / ad-blocker and try again.'
        ));
      };

      if (existing) {
        // Tag exists but SDK didn't finish booting — bind onerror in case
        // the original load failed silently.
        existing.addEventListener('error', handleLoadError, { once: true });
        return;
      }

      const fjs = document.getElementsByTagName('script')[0];
      const js = document.createElement('script') as HTMLScriptElement;
      js.id = 'facebook-jssdk';
      js.src = 'https://connect.facebook.net/en_US/sdk.js';
      js.async = true;
      js.crossOrigin = 'anonymous';
      js.addEventListener('error', handleLoadError, { once: true });
      fjs.parentNode?.insertBefore(js, fjs);
    });

    return this.sdkLoadPromise;
  }

  private async ensureSDKLoaded(): Promise<void> {
    if (!this.sdkLoaded) {
        await this.initializeFacebookSDK();
    }
  }

  /**
   * Required scopes for the dashboard to work end-to-end. Verified against
   * /me/permissions immediately after login — if the user unticked any of
   * these in the FB consent dialog, we surface a clear error so the caller
   * can re-prompt with auth_type=rerequest.
   */
  // Verified post-login against /me/permissions. Pages scopes are required
  // for the campaign builder to populate the Page + Instagram fields; the
  // login flow surfaces a clear "missing scopes" error if any of these
  // were unticked in the consent dialog so the caller can re-prompt with
  // auth_type=rerequest.
  private static REQUIRED_SCOPES = [
    'ads_read', 'ads_management', 'business_management',
    'pages_show_list', 'pages_read_engagement'
  ];

  async login(opts: { rerequest?: boolean } = {}): Promise<{ accessToken: string; userId: string }> {
    await this.ensureSDKLoaded();

    try {
      // Use Business Login if config_id is available, otherwise fall back to regular login
      const loginOptions: any = {
        scope: FACEBOOK_CONFIG.scope
      };
      // Force the consent dialog to re-show declined permissions. Without
      // this, FB silently re-uses prior choices — so a user who declined
      // ads_management once can never grant it without rerequest.
      if (opts.rerequest) loginOptions.auth_type = 'rerequest';

      // Add config_id for Facebook Business Login
      // This enables the Business Login flow which is required for business assets
      if (FACEBOOK_CONFIG.configId) {
        loginOptions.config_id = FACEBOOK_CONFIG.configId;
        // When using config_id, scope is defined in the configuration
        // but we can still pass it for backwards compatibility
      }

      console.log('Facebook login options:', loginOptions);

      const response = await new Promise<FacebookLoginResponse>((resolve, reject) => {
        window.FB.login((response) => {
          if (response.status === 'connected') {
            resolve(response);
          } else if (response.status === 'not_authorized') {
            reject(new Error('User did not authorize the app. Please grant the required permissions.'));
          } else {
            reject(new Error('User cancelled login or login failed.'));
          }
        }, loginOptions);
      });

      if (!response.authResponse) {
        throw new Error('User cancelled login or did not fully authorize.');
      }

      const { accessToken, userID } = response.authResponse;

      // Verify the user actually granted the scopes we asked for. The new FB
      // consent UI lets users untick individual permissions — token comes
      // back fine but later API calls fail with #200 missing_permission.
      const missing = await this.findMissingScopes(accessToken);
      if (missing.length > 0) {
        const err = new Error(
          `Facebook didn't grant required permissions: ${missing.join(', ')}. ` +
          `When the consent dialog reopens, leave EVERY checkbox checked and click Continue.`
        );
        (err as any).code = 'missing_scopes';
        (err as any).missingScopes = missing;
        throw err;
      }

      // Store the tokens
      this.accessToken = accessToken;
      this.userId = userID;

      // Save to localStorage
      localStorage.setItem('facebook_access_token', accessToken);
      localStorage.setItem('facebook_user_id', userID);

      console.log('Facebook Business Login successful');

      return {
        accessToken,
        userId: userID
      };
    } catch (error) {
      console.error('Facebook login error:', error);
      throw error;
    }
  }

  /**
   * Compare granted FB permissions against REQUIRED_SCOPES. Returns the
   * scopes that are missing OR explicitly declined. Empty array = OK.
   *
   * Why we can't trust FB.login's response: when the user unticks a
   * permission, FB still returns status='connected' with a token — but
   * later API calls fail with #200 missing_permission. Verifying upfront
   * lets us prompt rerequest before the user even sees a broken dashboard.
   */
  private async findMissingScopes(token: string): Promise<string[]> {
    try {
      const url = `https://graph.facebook.com/${FACEBOOK_API_VERSION}/me/permissions?access_token=${encodeURIComponent(token)}`;
      const res = await fetch(url);
      if (!res.ok) return []; // can't verify → trust the connect, surface real error later
      const json = await res.json() as { data?: Array<{ permission: string; status: string }> };
      const granted = new Set(
        (json.data || [])
          .filter(p => p.status === 'granted')
          .map(p => p.permission)
      );
      return FacebookAdsApiClient.REQUIRED_SCOPES.filter(s => !granted.has(s));
    } catch {
      return []; // network/parse error → don't block login
    }
  }

  static fromLocalStorage(): { accessToken: string; userId: string } | null {
    const accessToken = localStorage.getItem('facebook_access_token');
    const userId = localStorage.getItem('facebook_user_id');

    if (accessToken && userId) {
      return { accessToken, userId };
    }
    return null;
  }

  static clearLocalStorage(): void {
    localStorage.removeItem('facebook_access_token');
    localStorage.removeItem('facebook_user_id');
    FacebookAdsApiClient.instance = null;
  }

  public async getAdAccounts(): Promise<FacebookAdAccount[]> {
    if (!this.accessToken) {
      throw new Error('Not authenticated');
    }

    try {
      const response = await fetch(
        `${FACEBOOK_API_BASE_URL}/me/adaccounts?fields=${FACEBOOK_CONFIG.fields.adAccounts}&access_token=${this.accessToken}`
      );
      const data = await response.json();

      if (!response.ok) {
        const error = data as FacebookApiError;
        const msg = error.error?.message || 'Unknown error';
        // Surface the "ad account owner has NOT grant" case as a typed error
        // — this is NOT a user-permission issue, it's an *app-level* one.
        // Caller renders a help card with the 3 possible fixes.
        if (/ad account owner has not grant/i.test(msg)) {
          const e = new Error(msg);
          (e as any).code = 'app_not_authorized_for_ads';
          throw e;
        }
        throw new Error(`Facebook API Error: ${msg}`);
      }

      return (data.data || [])
        .filter((account: any) => account.account_status === 1) // Only return active accounts
        .map((account: any) => ({
        id: account.id.replace('act_', ''),
          name: account.name || account.business_name || 'Unnamed Account',
          isEnabled: false,
          accessToken: this.accessToken!
      }));
    } catch (error) {
      console.error('Error fetching ad accounts:', error);
      throw error;
    }
  }

  public setAdAccount(adAccountId: string) {
    // This method is no longer needed as ad accounts are managed by getAdAccounts
    // and the selectedAdAccountId is removed.
    // Keeping it for now, but it will not function as intended.
    console.warn('setAdAccount is deprecated. Ad accounts are managed by getAdAccounts.');
  }

  public getSelectedAdAccount(): string {
    // This method is no longer needed as selectedAdAccountId is removed.
    // Keeping it for now, but it will return an empty string.
    return '';
  }

  public getAccessToken(): string | null {
    return this.accessToken;
  }

  public async testConnection(): Promise<boolean> {
    if (!this.accessToken) {
      return false;
    }

    try {
      const response = await fetch(
        `${FACEBOOK_API_BASE_URL}/${FACEBOOK_CONFIG.version}/me?fields=name,currency&access_token=${this.accessToken}`
      );
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  public async getCampaigns(dateStart?: string, dateStop?: string): Promise<FacebookCampaign[]> {
    const params: Record<string, any> = {
      fields: 'name,status,objective,insights{spend,impressions,clicks,actions,action_values,cost_per_action_type}',
      limit: 100
    };

    if (dateStart && dateStop) {
      params['time_range'] = JSON.stringify({
        since: dateStart,
        until: dateStop
      });
    }

    const data = await this.makeRequest(`me/campaigns`, params);
    
    return data.data.map((campaign: any) => {
      const insights = campaign.insights?.data?.[0] || {};
      const purchases = this.getActionValue(insights.actions, 'purchase') || 0;
      const purchaseValue = this.getActionValue(insights.action_values, 'purchase') || 0;
      const spend = parseFloat(insights.spend || '0');
      
      return {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        objective: campaign.objective,
        spend,
        impressions: parseInt(insights.impressions || '0'),
        clicks: parseInt(insights.clicks || '0'),
        purchases,
        purchase_value: purchaseValue,
        cost_per_purchase: purchases > 0 ? spend / purchases : 0,
        roas: spend > 0 ? purchaseValue / spend : 0,
        date_start: dateStart || '',
        date_stop: dateStop || ''
      };
    });
  }

  public async getAdSets(campaignId?: string, dateStart?: string, dateStop?: string): Promise<FacebookAdSet[]> {
    const endpoint = campaignId 
      ? `${campaignId}/adsets`
      : `me/adsets`;

    const params: Record<string, any> = {
      fields: 'name,campaign_id,status,insights{spend,impressions,clicks,actions,action_values}',
      limit: 100
    };

    if (dateStart && dateStop) {
      params['time_range'] = JSON.stringify({
        since: dateStart,
        until: dateStop
      });
    }

    const data = await this.makeRequest(endpoint, params);
    
    return data.data.map((adset: any) => {
      const insights = adset.insights?.data?.[0] || {};
      const purchases = this.getActionValue(insights.actions, 'purchase') || 0;
      const purchaseValue = this.getActionValue(insights.action_values, 'purchase') || 0;
      const spend = parseFloat(insights.spend || '0');
      
      return {
        id: adset.id,
        name: adset.name,
        campaign_id: adset.campaign_id,
        status: adset.status,
        spend,
        impressions: parseInt(insights.impressions || '0'),
        clicks: parseInt(insights.clicks || '0'),
        purchases,
        purchase_value: purchaseValue,
        cost_per_purchase: purchases > 0 ? spend / purchases : 0,
        roas: spend > 0 ? purchaseValue / spend : 0
      };
    });
  }

  public async getAds(adsetId?: string, dateStart?: string, dateStop?: string): Promise<FacebookAd[]> {
    const endpoint = adsetId 
      ? `${adsetId}/ads`
      : `me/ads`;

    const params: Record<string, any> = {
      fields: 'name,adset_id,campaign_id,status,creative{title,body,image_url,video_url},insights{spend,impressions,clicks,actions,action_values}',
      limit: 100
    };

    if (dateStart && dateStop) {
      params['time_range'] = JSON.stringify({
        since: dateStart,
        until: dateStop
      });
    }

    const data = await this.makeRequest(endpoint, params);
    
    return data.data.map((ad: any) => {
      const insights = ad.insights?.data?.[0] || {};
      const purchases = this.getActionValue(insights.actions, 'purchase') || 0;
      const purchaseValue = this.getActionValue(insights.action_values, 'purchase') || 0;
      const spend = parseFloat(insights.spend || '0');
      
      return {
        id: ad.id,
        name: ad.name,
        adset_id: ad.adset_id,
        campaign_id: ad.campaign_id,
        status: ad.status,
        spend,
        impressions: parseInt(insights.impressions || '0'),
        clicks: parseInt(insights.clicks || '0'),
        purchases,
        purchase_value: purchaseValue,
        cost_per_purchase: purchases > 0 ? spend / purchases : 0,
        roas: spend > 0 ? purchaseValue / spend : 0,
        creative: ad.creative ? {
          title: ad.creative.title || '',
          body: ad.creative.body || '',
          image_url: ad.creative.image_url,
          video_url: ad.creative.video_url
        } : undefined
      };
    });
  }

  public async getAdPerformance(startDate: Date, endDate: Date): Promise<any[]> {
    const params = {
      fields: 'spend,impressions,clicks,actions,action_values',
      time_range: JSON.stringify({
        since: startDate.toISOString().split('T')[0],
        until: endDate.toISOString().split('T')[0]
      }),
      level: 'ad',
      limit: 500
    };

    const data = await this.makeRequest(`me/insights`, params);
    
    return data.data.map((insight: any) => ({
      date: insight.date_start,
      spend: parseFloat(insight.spend || 0),
      impressions: parseInt(insight.impressions || 0),
      clicks: parseInt(insight.clicks || 0),
      ctr: insight.clicks && insight.impressions ? (parseInt(insight.clicks) / parseInt(insight.impressions)) * 100 : 0,
      cpc: insight.clicks && insight.spend ? parseFloat(insight.spend) / parseInt(insight.clicks) : 0
    }));
  }

  private async makeRequest(endpoint: string, params: Record<string, any> = {}) {
    if (!this.accessToken) {
      throw new Error('Not authenticated. Please login first.');
    }

    try {
      // Construct Facebook Graph API URL
      const url = new URL(`https://graph.facebook.com/${FACEBOOK_CONFIG.version}/${endpoint}`);
      
      // Add parameters to URL
      const urlParams = new URLSearchParams({
        ...params,
        access_token: this.accessToken
      });
      
      // Make direct request to Facebook Graph API
      const response = await fetch(`${url}?${urlParams}`);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('Facebook API request failed:', error);
      throw error;
    }
  }

  private getActionValue(actions: any[], actionType: string): number {
    if (!actions) return 0;
    const action = actions.find(a => a.action_type === actionType);
    return action ? parseInt(action.value) : 0;
  }

  // Calculate ROAS and metrics for orders matched with Facebook campaigns
  async calculateOrderROAS(orders: any[], campaigns: FacebookCampaign[]): Promise<any[]> {
    return orders.map(order => {
      // Try to match order with campaign based on referrer, UTM params, etc.
      const matchedCampaign = this.matchOrderToCampaign(order, campaigns);
      
      if (matchedCampaign) {
        return {
          ...order,
          facebookCampaignId: matchedCampaign.id,
          facebookCampaignName: matchedCampaign.name,
          campaignSpend: matchedCampaign.spend,
          campaignROAS: matchedCampaign.roas,
          campaignCostPerPurchase: (matchedCampaign as any).cost_per_purchase ?? matchedCampaign.cost_per_result
        };
      }
      
      return order;
    });
  }

  private matchOrderToCampaign(order: any, campaigns: FacebookCampaign[]): FacebookCampaign | null {
    // Simple matching logic - can be enhanced based on UTM parameters, referrer data, etc.
    if (order.referringSite?.includes('facebook.com') || order.referringSite?.includes('instagram.com')) {
      // Return the campaign with best ROAS for Facebook/Instagram traffic
      return campaigns.reduce((best, current) => 
        current.roas > (best?.roas || 0) ? current : best, null);
    }
    
    // Could also match based on:
    // - UTM parameters in landing_site
    // - Custom order attributes
    // - Time-based matching
    // - Customer behavior patterns
    
    return null;
  }
}
