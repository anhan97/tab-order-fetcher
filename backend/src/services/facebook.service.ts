import fetch from 'node-fetch';

export async function fetchFromFacebookApi(url: string, accessToken: string) {
  try {
    // Add access token to URL if not already present
    const finalUrl = url.includes('access_token=') 
      ? url 
      : `${url}${url.includes('?') ? '&' : '?'}access_token=${accessToken}`;

    const response = await fetch(finalUrl);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Facebook API error: ${response.status} - ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching from Facebook API:', error);
    throw error;
  }
} 