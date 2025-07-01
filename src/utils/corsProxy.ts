
// CORS proxy utility for handling cross-origin requests
export const createProxyUrl = (targetUrl: string): string => {
  // Using allorigins.win which is more reliable for API calls
  return `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
};

export const handleProxyResponse = async (response: Response) => {
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  
  const proxyData = await response.json();
  
  // allorigins.win returns data in a specific format
  if (proxyData.status && proxyData.status.http_code === 200) {
    return JSON.parse(proxyData.contents);
  } else {
    throw new Error(`Proxy error: ${proxyData.status?.http_code || 'Unknown error'}`);
  }
};
