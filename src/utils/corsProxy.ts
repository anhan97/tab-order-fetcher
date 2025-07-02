
export const createProxyUrl = (url: string) => {
  // Use allorigins.win as it handles headers better for Shopify
  return `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
};

export const handleProxyResponse = async (response: Response) => {
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  
  const data = await response.json();
  return data;
};
