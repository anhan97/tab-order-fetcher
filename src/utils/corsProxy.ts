
// CORS proxy utility for handling cross-origin requests
export const createProxyUrl = (targetUrl: string): string => {
  // Try multiple proxy services
  return `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`;
};

export const handleProxyResponse = async (response: Response) => {
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  
  return await response.json();
};

// Alternative direct approach - bypass CORS by using different method
export const makeDirectRequest = async (url: string, accessToken: string, options: RequestInit = {}) => {
  // Try direct request first (might work in some cases)
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
        'Access-Control-Allow-Origin': '*',
        ...options.headers,
      },
      mode: 'cors',
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.log('Direct request failed, trying proxy...');
    throw error;
  }
};
