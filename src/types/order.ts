
export interface Order {
  id: string;
  orderNumber: string;
  orderDate: string;
  customerEmail: string;
  customerName: string;
  totalPrice: number;
  currency: string;
  fulfillmentStatus: string;
  financialStatus: string;
  shippingAddress: {
    address1: string;
    address2?: string;
    city: string;
    province: string;
    zip: string;
    country: string;
    phone?: string;
  } | null;
  lineItems: {
    id: string;
    productId: string;
    variantId: string;
    title: string;
    quantity: number;
    price: number;
    sku: string;
  }[];
  shippingCost: number;
  tags: string[];
  note: string;
  productSKU: string;
  variantId: string; // Add variantId for COGS calculations
  trackingNumber?: string;
  trackingCompany?: string;
  trackingUrl?: string;
  // UTM tracking
  fbAdId?: string;
  fbAdsetId?: string;
  fbCampaignId?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  sessionDetails?: {
    landingPage?: string;
    referringSite?: string;
    visitDate?: string;
    marketingChannel?: string;
  };
  // Additional properties for compatibility
  productName?: string;
  style?: string;
  quantity?: number;
  email?: string;
  phoneNumber?: string;
}

export interface COGSConfig {
  id?: string; // Database ID
  productSKU: string;
  variantId: string;
  productId: string;
  productTitle: string;
  variantTitle: string;
  baseCost: number;
  handlingFee: number;
  description?: string;
  comboPricing?: ComboPricing[];
}

export interface ComboPricing {
  id?: string;
  cogsConfigId: string;
  userId: string;
  storeId: string;
  supplier: string;
  country: string;
  comboType: string; // "single", "combo2", "combo3", "combo4", "combo5+"
  quantity: number; // Exact quantity (1, 2, 3, 4, 5+)
  productCost: number; // Cost per unit for this combo
  shippingCost: number; // Shipping cost for this combo
  totalCost: number; // Total cost for this combo (calculated)
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ComboPricingData {
  supplier: string;
  country: string;
  comboType: string;
  quantity: number;
  productCost: number;
  shippingCost: number;
  totalCost?: number;
  isActive?: boolean;
}

// Legacy interfaces for backward compatibility
export interface PricingTier {
  id?: string;
  cogsConfigId: string;
  userId: string;
  storeId: string;
  supplier: string;
  country: string;
  minQuantity: number;
  maxQuantity?: number;
  productCost: number;
  shippingCost: number;
  discount: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface PricingTierData {
  supplier: string;
  country: string;
  minQuantity: number;
  maxQuantity?: number;
  productCost: number;
  shippingCost: number;
  discount: number;
  isActive?: boolean;
}

// Mock data for demonstration
export const mockOrders: Order[] = [
  {
    id: "1",
    orderNumber: "1001",
    orderDate: "2024-09-11",
    customerEmail: "lesliesalgab@gmail.com",
    customerName: "Sal Emma",
    totalPrice: 14.5,
    currency: "USD",
    fulfillmentStatus: "fulfilled",
    financialStatus: "paid",
    shippingAddress: {
      address1: "222 Strawbridge Lane",
      city: "Mullica Hill",
      province: "NJ",
      zip: "8062",
      country: "USA",
      phone: "1 609-820-0803"
    },
    lineItems: [
      {
        id: "1",
        productId: "PHD01",
        variantId: "PHD01-Silver",
        title: "Magnetic Phone Holder",
        quantity: 1,
        price: 14.5,
        sku: "PHD01"
      }
    ],
    shippingCost: 0,
    tags: ["electronics", "phone accessories"],
    note: "Order placed on September 11, 2024",
    productSKU: "PHD01",
    productName: "Magnetic Phone Holder",
    style: "Silver",
    quantity: 1,
    email: "lesliesalgab@gmail.com",
    phoneNumber: "1 609-820-0803",
    variantId: "PHD01-Silver"
  },
  {
    id: "2",
    orderNumber: "1002",
    orderDate: "2024-09-12",
    customerEmail: "maryjane.okpala@yahoo.com",
    customerName: "Mary-jane Okpala",
    totalPrice: 45.99,
    currency: "GBP",
    fulfillmentStatus: "shipped",
    financialStatus: "paid",
    shippingAddress: {
      address1: "9 prunus walk",
      city: "Newcastle upon Tyne",
      province: "ENG",
      zip: "NE5 3QW",
      country: "GB",
      phone: "+447961222723"
    },
    lineItems: [
      {
        id: "2",
        productId: "CTB01",
        variantId: "CTB01-Navy Blue",
        title: "Caryona Lunch Tote Bag",
        quantity: 2,
        price: 22.99,
        sku: "CTB01"
      }
    ],
    shippingCost: 5.00,
    tags: ["lunch", "bags"],
    note: "Order placed on September 12, 2024",
    productSKU: "CTB01",
    productName: "Caryona Lunch Tote Bag",
    style: "Navy Blue",
    quantity: 2,
    email: "maryjane.okpala@yahoo.com",
    phoneNumber: "+447961222723",
    variantId: "CTB01-Navy"
  },
  {
    id: "3",
    orderNumber: "1003",
    orderDate: "2024-09-13",
    customerEmail: "john.smith@gmail.com",
    customerName: "John Smith",
    totalPrice: 29.99,
    currency: "USD",
    fulfillmentStatus: "delivered",
    financialStatus: "paid",
    shippingAddress: {
      address1: "123 Main Street",
      city: "New York",
      province: "NY",
      zip: "10001",
      country: "USA",
      phone: "+1 555-0123"
    },
    lineItems: [
      {
        id: "3",
        productId: "WRB01",
        variantId: "WRB01-Black",
        title: "Wireless Charging Pad",
        quantity: 1,
        price: 29.99,
        sku: "WRB01"
      }
    ],
    shippingCost: 0,
    tags: ["electronics", "charging"],
    note: "Order placed on September 13, 2024",
    productSKU: "WRB01",
    productName: "Wireless Charging Pad",
    style: "Black",
    quantity: 1,
    email: "john.smith@gmail.com",
    phoneNumber: "+1 555-0123",
    variantId: "WRB01-Black"
  },
  {
    id: "4",
    orderNumber: "1004",
    orderDate: "2024-09-14",
    customerEmail: "alice.johnson@hotmail.com",
    customerName: "Alice Johnson",
    totalPrice: 79.99,
    currency: "USD",
    fulfillmentStatus: "pending",
    financialStatus: "pending",
    shippingAddress: {
      address1: "456 Oak Avenue",
      city: "Los Angeles",
      province: "CA",
      zip: "90210",
      country: "USA",
      phone: "+1 555-0456"
    },
    lineItems: [
      {
        id: "4",
        productId: "BTP01",
        variantId: "BTP01-Red",
        title: "Bluetooth Speaker",
        quantity: 1,
        price: 79.99,
        sku: "BTP01"
      }
    ],
    shippingCost: 0,
    tags: ["electronics", "audio"],
    note: "Order placed on September 14, 2024",
    productSKU: "BTP01",
    productName: "Bluetooth Speaker",
    style: "Red",
    quantity: 1,
    email: "alice.johnson@hotmail.com",
    phoneNumber: "+1 555-0456",
    variantId: "BTP01-Red"
  },
  {
    id: "5",
    orderNumber: "1005",
    orderDate: "2024-09-15",
    customerEmail: "david.wilson@outlook.com",
    customerName: "David Wilson",
    totalPrice: 199.99,
    currency: "USD",
    fulfillmentStatus: "fulfilled",
    financialStatus: "paid",
    shippingAddress: {
      address1: "789 Pine Street",
      city: "Seattle",
      province: "WA",
      zip: "98101",
      country: "USA",
      phone: "+1 555-0789"
    },
    lineItems: [
      {
        id: "5",
        productId: "SMW01",
        variantId: "SMW01-Space Gray",
        title: "Smartwatch",
        quantity: 1,
        price: 199.99,
        sku: "SMW01"
      }
    ],
    shippingCost: 0,
    tags: ["electronics", "wearables"],
    note: "Order placed on September 15, 2024",
    productSKU: "SMW01",
    productName: "Smartwatch",
    style: "Space Gray",
    quantity: 1,
    email: "david.wilson@outlook.com",
    phoneNumber: "+1 555-0789",
    variantId: "SMW01-SpaceGray"
  }
];
