
// CORS proxy utility for handling cross-origin requests
export const createProxyUrl = (targetUrl: string): string => {
  // Using cors-anywhere proxy which is more reliable
  return `https://cors-anywhere.herokuapp.com/${targetUrl}`;
};

export const handleProxyResponse = async (response: Response) => {
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  
  return await response.json();
};
