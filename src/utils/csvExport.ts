
import { Order } from '@/types/order';

export const exportToCSV = (orders: Order[]) => {
  // Define CSV headers matching the format you provided
  const headers = [
    'Order Number',
    'Order Date', 
    'Product SKU',
    'Product Name',
    'STYLE(COLOR)',
    'Quantity',
    'EMAIL',
    'NAME',
    'Address',
    'City',
    'State/Province',
    'Postal Code',
    'Country Code',
    'Phone Number',
    'Total Amount',
    'Shipping Method',
    'Tracking Number'
  ];

  // Convert orders to CSV format
  const csvContent = [
    headers.join(','),
    ...orders.map(order => [
      order.orderNumber,
      order.orderDate,
      order.productSKU,
      `"${order.productName}"`,
      order.style,
      order.quantity,
      order.email,
      `"${order.customerName}"`,
      `"${order.address}"`,
      order.city,
      order.state,
      order.postalCode,
      order.countryCode,
      order.phoneNumber,
      order.totalPrice,
      order.shippingMethod,
      order.trackingNumber || ''
    ].join(','))
  ].join('\n');

  // Create and download the file
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `shopify_orders_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};

export const formatOrderForCSV = (order: Order): string[] => {
  return [
    order.orderNumber,
    order.orderDate,
    order.productSKU,
    order.productName,
    order.style,
    order.quantity.toString(),
    order.email,
    order.customerName,
    order.address,
    order.city,
    order.state,
    order.postalCode,
    order.countryCode,
    order.phoneNumber,
    order.totalPrice.toString(),
    order.shippingMethod,
    order.trackingNumber || ''
  ];
};
