
// CORS proxy utility for handling cross-origin requests
export const createProxyUrl = (targetUrl: string): string => {
  // Using allorigins.win as a free CORS proxy service
  return `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
};

export const handleProxyResponse = async (response: Response) => {
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  
  const data = await response.json();
  
  // allorigins.win wraps the response in a 'contents' field
  if (data.contents) {
    try {
      return JSON.parse(data.contents);
    } catch (error) {
      return data.contents;
    }
  }
  
  return data;
};
