import { render, screen, fireEvent, act } from '@testing-library/react';
import { OrdersTable } from './OrdersTable';
import { ShopifyApiClient } from '../utils/shopifyApi';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mock the chart component to avoid rendering issues
vi.mock('recharts', () => ({
  LineChart: vi.fn(() => null),
  Line: vi.fn(() => null),
  XAxis: vi.fn(() => null),
  YAxis: vi.fn(() => null),
  CartesianGrid: vi.fn(() => null),
  Tooltip: vi.fn(() => null),
  Legend: vi.fn(() => null),
  ResponsiveContainer: vi.fn(({ children }) => children)
}));

// Mock ShopifyApiClient
const mockGetOrders = vi.fn();
vi.mock('../utils/shopifyApi', () => ({
  ShopifyApiClient: vi.fn().mockImplementation(() => ({
    getOrders: mockGetOrders
  }))
}));

describe('OrdersTable', () => {
  const mockShopifyConfig = {
    storeUrl: 'test-store.myshopify.com',
    accessToken: 'test-token'
  };

  const mockOnOrdersChange = vi.fn();
  const mockCogsConfigs = [];
  const mockIsFacebookConnected = false;
  const mockOnFacebookConnect = vi.fn();
  const mockTimezone = 'Etc/GMT+6';

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnOrdersChange.mockReset();
    mockGetOrders.mockReset();

    // Set a fixed date for testing
    vi.setSystemTime(new Date('2024-03-14T12:00:00-06:00')); // Noon in GMT-6

    // Mock localStorage
    Storage.prototype.getItem = vi.fn((key) => {
      if (key === 'preferred_timezone') return 'Etc/GMT+6';
      return null;
    });
    Storage.prototype.setItem = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should show correct number of orders for different time periods', async () => {
    // Create mock orders with specific dates
    const mockOrders = [
      // Today's orders (1 order)
      {
        id: '1',
        orderNumber: '1001',
        orderDate: '2024-03-14T10:00:00-06:00', // Today at 10 AM GMT-6
        customerEmail: 'today@example.com',
        customerName: 'Today Customer',
        totalPrice: 100,
        currency: 'USD',
        fulfillmentStatus: 'unfulfilled',
        financialStatus: 'paid',
        shippingAddress: null,
        lineItems: [{
          id: '1',
          productId: '1',
          variantId: '1',
          title: 'Product 1',
          quantity: 1,
          price: 100,
          sku: 'SKU1'
        }],
        shippingCost: 10,
        tags: [],
        note: '',
        productSKU: 'SKU1',
        productName: 'Product 1',
        style: '',
        quantity: 1,
        email: 'today@example.com',
        phoneNumber: ''
      },
      
      // Last 7 days orders (37 more orders)
      ...Array.from({ length: 37 }, (_, i) => {
        const date = new Date('2024-03-14T00:00:00-06:00');
        date.setDate(date.getDate() - (1 + (i % 6))); // Spread across last 6 days (not today)
        date.setHours(Math.floor(i / 6) * 4); // Spread hours throughout each day
        return {
          id: `${i + 2}`,
          orderNumber: `${1002 + i}`,
          orderDate: date.toISOString(),
          customerEmail: `7days${i}@example.com`,
          customerName: `7Days Customer ${i}`,
          totalPrice: 100,
          currency: 'USD',
          fulfillmentStatus: 'unfulfilled',
          financialStatus: 'paid',
          shippingAddress: null,
          lineItems: [{
            id: `${i + 2}`,
            productId: `${i + 2}`,
            variantId: `${i + 2}`,
            title: `Product ${i + 2}`,
            quantity: 1,
            price: 100,
            sku: `SKU${i + 2}`
          }],
          shippingCost: 10,
          tags: [],
          note: '',
          productSKU: `SKU${i + 2}`,
          productName: `Product ${i + 2}`,
          style: '',
          quantity: 1,
          email: `7days${i}@example.com`,
          phoneNumber: ''
        };
      }),
      
      // Last 30 days orders (remaining 144 orders to make total 182)
      ...Array.from({ length: 144 }, (_, i) => {
        const date = new Date('2024-03-14T00:00:00-06:00');
        date.setDate(date.getDate() - (7 + Math.floor(i / 6))); // Spread evenly from day 8 to day 30
        date.setHours((i % 6) * 4); // Spread hours throughout each day
        return {
          id: `${i + 39}`,
          orderNumber: `${1039 + i}`,
          orderDate: date.toISOString(),
          customerEmail: `30days${i}@example.com`,
          customerName: `30Days Customer ${i}`,
          totalPrice: 100,
          currency: 'USD',
          fulfillmentStatus: 'unfulfilled',
          financialStatus: 'paid',
          shippingAddress: null,
          lineItems: [{
            id: `${i + 39}`,
            productId: `${i + 39}`,
            variantId: `${i + 39}`,
            title: `Product ${i + 39}`,
            quantity: 1,
            price: 100,
            sku: `SKU${i + 39}`
          }],
          shippingCost: 10,
          tags: [],
          note: '',
          productSKU: `SKU${i + 39}`,
          productName: `Product ${i + 39}`,
          style: '',
          quantity: 1,
          email: `30days${i}@example.com`,
          phoneNumber: ''
        };
      })
    ];

    // Helper function to filter orders by date range in GMT-6
    const filterOrdersByDateRange = (min: string, max: string) => {
      const minDate = new Date(min);
      const maxDate = new Date(max);
      
      return mockOrders.filter(order => {
        const orderDate = new Date(order.orderDate);
        return orderDate >= minDate && orderDate <= maxDate;
      });
    };

    // Set up the mock implementation
    mockGetOrders.mockImplementation(async ({ created_at_min, created_at_max }) => {
      return filterOrdersByDateRange(created_at_min!, created_at_max!);
    });

    // Initial state should be 30 days
    const thirtyDaysAgo = new Date('2024-02-13T00:00:00-06:00'); // 30 days ago at start of day in GMT-6
    const todayEnd = new Date('2024-03-14T23:59:59-06:00'); // End of today in GMT-6
    
    mockGetOrders.mockResolvedValueOnce(filterOrdersByDateRange(
      thirtyDaysAgo.toISOString(),
      todayEnd.toISOString()
    ));

    // 7 days view should return 38 orders
    const sevenDaysAgo = new Date('2024-03-07T00:00:00-06:00'); // 7 days ago at start of day in GMT-6
    
    mockGetOrders.mockResolvedValueOnce(filterOrdersByDateRange(
      sevenDaysAgo.toISOString(),
      todayEnd.toISOString()
    ));

    // Today's view should return 1 order
    const today = new Date('2024-03-14T00:00:00-06:00'); // Start of today in GMT-6
    
    mockGetOrders.mockResolvedValueOnce(filterOrdersByDateRange(
      today.toISOString(),
      todayEnd.toISOString()
    ));

    await act(async () => {
      render(
        <OrdersTable
          shopifyConfig={mockShopifyConfig}
          onOrdersChange={mockOnOrdersChange}
          cogsConfigs={mockCogsConfigs}
          isFacebookConnected={mockIsFacebookConnected}
          onFacebookConnect={mockOnFacebookConnect}
          timezone={mockTimezone}
        />
      );
    });

    // Wait for loading to complete
    await act(async () => {
      await vi.waitFor(() => {
        expect(screen.queryByText('Đang tải dữ liệu đơn hàng từ Shopify...')).toBeNull();
      });
    });

    // Check initial state (30 days)
    expect(mockOnOrdersChange).toHaveBeenCalled();
    expect(mockOnOrdersChange.mock.calls[0][0].length).toBe(182);

    // Switch to 7 days view
    await act(async () => {
      const sevenDaysButton = screen.getByText('7 ngày qua');
      fireEvent.click(sevenDaysButton);
    });
    
    await act(async () => {
      await vi.waitFor(() => {
        expect(mockOnOrdersChange.mock.calls[1][0].length).toBe(38);
      });
    });

    // Switch to today's view
    await act(async () => {
      const todayButton = screen.getByText('Hôm nay');
      fireEvent.click(todayButton);
    });
    
    await act(async () => {
      await vi.waitFor(() => {
        expect(mockOnOrdersChange.mock.calls[2][0].length).toBe(1);
      });
    });
  });
}); 