
// CORS proxy utility for handling cross-origin requests
export const createProxyUrl = (targetUrl: string): string => {
  // Using a different CORS proxy that handles headers better
  return `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
};

export const handleProxyResponse = async (response: Response) => {
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  
  const data = await response.json();
  return data;
};
