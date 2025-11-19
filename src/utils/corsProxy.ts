
export const createProxyUrl = (url: string) => {
  // Extract the path after /admin/api/2024-04
  const match = url.match(/\/admin\/api\/2024-04(.*)/);
  if (!match) {
    throw new Error('Invalid Shopify API URL format');
  }
  
  // Use our backend proxy
  return `http://localhost:3001/api/shopify${match[1]}`; // Updated port to 3001
};

export const handleProxyResponse = async (response: Response) => {
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  
  const data = await response.json();
  return data;
};
