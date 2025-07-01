
export interface Order {
  id: string;
  orderNumber: string;
  orderDate: string;
  productSKU: string;
  productName: string;
  style: string;
  quantity: number;
  email: string;
  customerName: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
  phoneNumber: string;
  totalAmount: number;
  shippingMethod: string;
  trackingNumber?: string;
}

// Mock data for demonstration
export const mockOrders: Order[] = [
  {
    id: "1",
    orderNumber: "1001",
    orderDate: "2024-09-11",
    productSKU: "PHD01",
    productName: "Magnetic Phone Holder",
    style: "Silver",
    quantity: 1,
    email: "lesliesalgab@gmail.com",
    customerName: "Sal Emma",
    address: "222 Strawbridge Lane",
    city: "Mullica Hill",
    state: "NJ",
    postalCode: "8062",
    countryCode: "USA",
    phoneNumber: "1 609-820-0803",
    totalAmount: 14.5,
    shippingMethod: "4PX",
    trackingNumber: "4PX1234567890"
  },
  {
    id: "2",
    orderNumber: "1002",
    orderDate: "2024-09-12",
    productSKU: "CTB01",
    productName: "Caryona Lunch Tote Bag",
    style: "Navy Blue",
    quantity: 2,
    email: "maryjane.okpala@yahoo.com",
    customerName: "Mary-jane Okpala",
    address: "9 prunus walk",
    city: "Newcastle upon Tyne",
    state: "ENG",
    postalCode: "NE5 3QW",
    countryCode: "GB",
    phoneNumber: "+447961222723",
    totalAmount: 45.99,
    shippingMethod: "Royal Mail",
    trackingNumber: "RM123456789"
  },
  {
    id: "3",
    orderNumber: "1003",
    orderDate: "2024-09-13",
    productSKU: "WRB01",
    productName: "Wireless Charging Pad",
    style: "Black",
    quantity: 1,
    email: "john.smith@gmail.com",
    customerName: "John Smith",
    address: "123 Main Street",
    city: "New York",
    state: "NY",
    postalCode: "10001",
    countryCode: "USA",
    phoneNumber: "+1 555-0123",
    totalAmount: 29.99,
    shippingMethod: "USPS",
    trackingNumber: "USPS987654321"
  },
  {
    id: "4",
    orderNumber: "1004",
    orderDate: "2024-09-14",
    productSKU: "BTP01",
    productName: "Bluetooth Speaker",
    style: "Red",
    quantity: 1,
    email: "alice.johnson@hotmail.com",
    customerName: "Alice Johnson",
    address: "456 Oak Avenue",
    city: "Los Angeles",
    state: "CA",
    postalCode: "90210",
    countryCode: "USA",
    phoneNumber: "+1 555-0456",
    totalAmount: 79.99,
    shippingMethod: "FedEx",
    trackingNumber: "FDX555666777"
  },
  {
    id: "5",
    orderNumber: "1005",
    orderDate: "2024-09-15",
    productSKU: "SMW01",
    productName: "Smartwatch",
    style: "Space Gray",
    quantity: 1,
    email: "david.wilson@outlook.com",
    customerName: "David Wilson",
    address: "789 Pine Street",
    city: "Seattle",
    state: "WA",
    postalCode: "98101",
    countryCode: "USA",
    phoneNumber: "+1 555-0789",
    totalAmount: 199.99,
    shippingMethod: "UPS",
    trackingNumber: "UPS123789456"
  }
];
