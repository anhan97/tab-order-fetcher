export interface ShopifyStore {
  id: string;
  userId: string;
  storeDomain: string;
  accessToken: string;
  name?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ShopifyOrder {
  id: number;
  order_number: string;
  total_price: string;
  currency: string;
  customer: {
    email: string;
  };
  fulfillment_status: string | null;
  financial_status: string;
  created_at: string;
  updated_at: string;
  note_attributes?: Array<{
    name: string;
    value: string;
  }>;
  tags?: string;
} 