import { ShopifyApiClient } from './shopifyApi';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('ShopifyApiClient Order Fetching', () => {
  let client: ShopifyApiClient;
  const NOW = '2024-03-14T12:00:00-06:00'; // Fixed time for testing (noon in GMT-6)
  
  beforeEach(() => {
    // Mock fetch globally
    global.fetch = vi.fn();
    
    client = new ShopifyApiClient({
      storeUrl: 'test-store.myshopify.com',
      accessToken: 'test-token'
    });

    // Set a fixed date for testing
    vi.setSystemTime(new Date(NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // Helper function to create a mock order
  const createMockOrder = (createdAt: string, id: number) => ({
    id,
    order_number: `${1000 + id}`,
    created_at: createdAt,
    email: `test${id}@example.com`,
    customer: { first_name: 'Test', last_name: `Customer ${id}` },
    total_price: '100.00',
    currency: 'USD',
    fulfillment_status: 'unfulfilled',
    financial_status: 'paid',
    line_items: [{
      id,
      product_id: id,
      variant_id: id,
      title: `Product ${id}`,
      quantity: 1,
      price: '100.00',
      sku: `SKU${id}`
    }],
    shipping_lines: [{ price: '10.00' }],
    tags: '',
    note: ''
  });

  // Helper function to generate orders for a specific day
  const generateOrdersForDay = (date: string, count: number, startId: number) => {
    const baseDate = new Date(date);
    return Array.from({ length: count }, (_, i) => {
      const orderDate = new Date(baseDate);
      orderDate.setHours(Math.floor(i * (24 / count))); // Spread orders throughout the day
      return createMockOrder(orderDate.toISOString(), startId + i);
    });
  };

  // Create mock orders dataset
  const mockOrders = [
    // Today's orders (5 orders)
    ...generateOrdersForDay('2024-03-14T00:00:00-06:00', 5, 1),
    
    // Yesterday's orders (8 orders)
    ...generateOrdersForDay('2024-03-13T00:00:00-06:00', 8, 6),
    
    // Last 7 days orders (excluding today and yesterday) - 25 orders
    ...Array.from({ length: 5 }, (_, dayIndex) => {
      const date = new Date('2024-03-12T00:00:00-06:00');
      date.setDate(date.getDate() - dayIndex);
      return generateOrdersForDay(date.toISOString(), 5, 14 + (dayIndex * 5));
    }).flat(),
    
    // Rest of the month (32 days total) - 100 orders
    ...Array.from({ length: 25 }, (_, dayIndex) => {
      const date = new Date('2024-03-07T00:00:00-06:00');
      date.setDate(date.getDate() - dayIndex);
      return generateOrdersForDay(date.toISOString(), 4, 39 + (dayIndex * 4));
    }).flat()
  ];

  // Helper function to filter orders by date range in GMT-6
  const filterOrdersByDateRange = (min: string, max: string) => {
    const minDate = new Date(min);
    const maxDate = new Date(max);
    
    return mockOrders.filter(order => {
      const orderDate = new Date(order.created_at);
      return orderDate >= minDate && orderDate <= maxDate;
    });
  };

  // Mock the fetch response
  beforeEach(() => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      const params = new URLSearchParams(url.split('?')[1]);
      const created_at_min = params.get('created_at_min');
      const created_at_max = params.get('created_at_max');
      
      const filteredOrders = created_at_min && created_at_max
        ? filterOrdersByDateRange(created_at_min, created_at_max)
        : mockOrders;

      return {
        ok: true,
        json: async () => ({ orders: filteredOrders })
      };
    });
  });

  it('should fetch today\'s orders correctly', async () => {
    const today = new Date('2024-03-14T00:00:00-06:00');
    const todayEnd = new Date('2024-03-14T23:59:59-06:00');
    
    const orders = await client.getOrders({
      created_at_min: today.toISOString(),
      created_at_max: todayEnd.toISOString()
    });

    expect(orders.length).toBe(5);
    orders.forEach(order => {
      const orderDate = new Date(order.orderDate);
      expect(orderDate >= today && orderDate <= todayEnd).toBe(true);
    });
  });

  it('should fetch yesterday\'s orders correctly', async () => {
    const yesterday = new Date('2024-03-13T00:00:00-06:00');
    const yesterdayEnd = new Date('2024-03-13T23:59:59-06:00');
    
    const orders = await client.getOrders({
      created_at_min: yesterday.toISOString(),
      created_at_max: yesterdayEnd.toISOString()
    });

    expect(orders.length).toBe(8);
    orders.forEach(order => {
      const orderDate = new Date(order.orderDate);
      expect(orderDate >= yesterday && orderDate <= yesterdayEnd).toBe(true);
    });
  });

  it('should fetch last 7 days orders correctly', async () => {
    const sevenDaysAgo = new Date('2024-03-07T00:00:00-06:00');
    const todayEnd = new Date('2024-03-14T23:59:59-06:00');
    
    const orders = await client.getOrders({
      created_at_min: sevenDaysAgo.toISOString(),
      created_at_max: todayEnd.toISOString()
    });

    expect(orders.length).toBe(38); // 5 today + 8 yesterday + 25 for other 5 days
    orders.forEach(order => {
      const orderDate = new Date(order.orderDate);
      expect(orderDate >= sevenDaysAgo && orderDate <= todayEnd).toBe(true);
    });
  });

  it('should fetch last 32 days orders correctly', async () => {
    const thirtyTwoDaysAgo = new Date('2024-02-11T00:00:00-06:00');
    const todayEnd = new Date('2024-03-14T23:59:59-06:00');
    
    const orders = await client.getOrders({
      created_at_min: thirtyTwoDaysAgo.toISOString(),
      created_at_max: todayEnd.toISOString()
    });

    expect(orders.length).toBe(138); // 5 today + 8 yesterday + 25 last week + 100 rest
    orders.forEach(order => {
      const orderDate = new Date(order.orderDate);
      expect(orderDate >= thirtyTwoDaysAgo && orderDate <= todayEnd).toBe(true);
    });
  });
}); 