export interface FacebookMetrics {
  spend: number;
  impressions: number;
  clicks: number;
  unique_clicks: number;
  ctr: number;
  unique_ctr: number;
  cpc: number;
  cpm: number;
  reach: number;
  frequency: number;
  video_plays?: number;
  hook_rate?: number;
  add_to_cart?: number;
  initiate_checkout?: number;
  purchase?: number;
  purchase_value?: number;
  cost_per_result?: number;
  roas?: number;
  cost_per_unique_click?: number;
}

export interface FacebookCreative {
  id: string;
  thumbnail_url?: string;
  image_url?: string;
  body?: string;
  title?: string;
  call_to_action_type?: string;
}

export interface FacebookCampaign extends FacebookMetrics {
  id: string;
  name: string;
  status: string;
  objective: string;
  budget: number;
}

export interface FacebookAdSet {
  id: string;
  name: string;
  status: string;
  campaign_id: string;
  budget: number;
  spend: number;
  impressions: number;
  clicks: number;
  creative?: {
    title?: string;
    body?: string;
    image_url?: string;
    video_url?: string;
    thumbnail_url?: string;
  };
}

export interface FacebookAd {
  id: string;
  name: string;
  status: string;
  campaign_id: string;
  adset_id: string;
  spend: number;
  impressions: number;
  clicks: number;
  creative?: {
    title?: string;
    body?: string;
    image_url?: string;
    video_url?: string;
    thumbnail_url?: string;
  };
}

export interface FacebookAdAccount {
  id: string;
  name: string;
  accessToken: string;
  isEnabled?: boolean;
}

export interface FacebookLoginResponse {
  status: 'connected' | 'not_authorized' | 'unknown';
  authResponse: {
    accessToken: string;
    userID: string;
    expiresIn: number;
    signedRequest: string;
    graphDomain: string;
    data_access_expiration_time: number;
  } | null;
}

export interface FacebookAuthResponse {
  accessToken: string;
  userID: string;
  expiresIn: number;
  signedRequest: string;
  graphDomain: string;
  data_access_expiration_time: number;
}

// Add this type declaration for the Facebook SDK
declare global {
  interface Window {
    fbAsyncInit: () => void;
    FB: {
      init: (config: {
        appId: string;
        cookie: boolean;
        xfbml: boolean;
        version: string;
      }) => void;
      login: (callback: (response: FacebookLoginResponse) => void, options: { scope: string }) => void;
    };
  }
} 