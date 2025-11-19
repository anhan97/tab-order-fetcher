interface ShopInfo {
  name: string;
  email: string;
  domain: string;
  plan: string;
}

interface ShopifyShop {
  shop: {
    name: string;
    email: string;
    domain: string;
    plan_name: string;
  };
}

interface ShopifyOrder {
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

interface ShopifyOrdersResponse {
  orders: ShopifyOrder[];
}

function formatStoreDomain(domain: string): string {
  // Remove protocol if present
  domain = domain.replace(/^https?:\/\//, '');
  // Remove trailing slash if present
  domain = domain.replace(/\/$/, '');
  // Remove /admin if present
  domain = domain.replace(/\/admin$/, '');
  return domain;
}

export async function verifyShopifyCredentials(
  storeDomain: string,
  accessToken: string
): Promise<ShopInfo> {
  try {
    const formattedDomain = formatStoreDomain(storeDomain);
    console.log('Verifying credentials for domain:', formattedDomain);
    
    const response = await fetch(`https://${formattedDomain}/admin/api/2025-10/shop.json`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Shopify API error:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText
      });
      throw new Error(`Invalid credentials: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as ShopifyShop;
    console.log('Shop info retrieved successfully:', data.shop.name);
    
    return {
      name: data.shop.name,
      email: data.shop.email,
      domain: data.shop.domain,
      plan: data.shop.plan_name
    };
  } catch (error) {
    console.error('Failed to verify Shopify credentials:', error);
    throw error;
  }
}

export async function fetchShopifyOrders(
  storeDomain: string,
  accessToken: string,
  params: {
    limit?: number;
    page_info?: string;
    createdAtMin?: string;
    createdAtMax?: string;
    status?: string;
  } = {}
): Promise<{ orders: ShopifyOrder[]; pageInfo?: string }> {
  try {
    const formattedDomain = formatStoreDomain(storeDomain);
    console.log('Fetching orders for domain:', formattedDomain);

    // Build query parameters
    const queryParams = new URLSearchParams();
    
    // Add limit (max 250 per Shopify's API limits)
    
    
    // Add pagination token if provided
    if (params.page_info) {
      queryParams.append('page_info', params.page_info);
    } else {
      // Only add filters on first request
      // Add date filters
      if (params.createdAtMin) {
        queryParams.append('created_at_min', params.createdAtMin);
      }
      if (params.createdAtMax) {
        queryParams.append('created_at_max', params.createdAtMax);
      }

      // Only add status if it's a specific status (not 'any' or undefined)
      if (params.status) {
        queryParams.append('status', params.status);
      }
    }
    const limit = Math.min(params.limit || 50, 250);
    queryParams.append('limit', String(limit));
    // Log the actual parameters that will be sent
    const actualParams = Object.fromEntries(queryParams.entries());
    console.log('Sending parameters to Shopify:', actualParams);

    // Build URL with latest API version
    const url = `https://${formattedDomain}/admin/api/2025-10/orders.json?${queryParams}`;
    console.log('Fetching orders from URL:', url);

    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken
      }
    });

    // Get response text first for error handling
    const responseText = await response.text();
    let responseData;
    
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      console.error('Failed to parse Shopify response:', responseText);
      throw new Error('Invalid JSON response from Shopify');
    }

    if (!response.ok) {
      console.error('Shopify API error:', {
        status: response.status,
        statusText: response.statusText,
        body: responseData
      });
      
      // Format error message based on Shopify's response
      const errorMessage = responseData.errors 
        ? `Shopify API Error: ${JSON.stringify(responseData.errors)}`
        : `Failed to fetch orders: ${response.status} ${response.statusText}`;
      
      throw new Error(errorMessage);
    }

    if (!responseData.orders) {
      console.error('Unexpected Shopify response format:', responseData);
      throw new Error('Invalid response format from Shopify');
    }

    // Get pagination info from Link header
    const linkHeader = response.headers.get('Link');
    let pageInfo: string | undefined;
    
    if (linkHeader) {
      const nextLink = linkHeader.split(',').find(link => link.includes('rel="next"'));
      if (nextLink) {
        const pageInfoMatch = nextLink.match(/page_info=([^>&"]*)/);
        if (pageInfoMatch) {
          pageInfo = pageInfoMatch[1];
        }
      }
    }

    console.log('Orders fetched successfully:', responseData.orders.length);
    return { 
      orders: responseData.orders,
      pageInfo
    };
  } catch (error) {
    console.error('Failed to fetch orders:', error);
    throw error;
  }
}

function extractUtmFromUrl(url: string): {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
} {
  if (!url) return {};
  
  try {
    const urlObj = new URL(url.startsWith('http') ? url : `https://example.com${url}`);
    const params = new URLSearchParams(urlObj.search);
    
    return {
      utmSource: params.get('utm_source') || undefined,
      utmMedium: params.get('utm_medium') || undefined,
      utmCampaign: params.get('utm_campaign') || undefined,
      utmContent: params.get('utm_content') || undefined,
      utmTerm: params.get('utm_term') || undefined
    };
  } catch (error) {
    // If URL parsing fails, try to extract from string directly
    const utmSourceMatch = url.match(/[?&]utm_source=([^&]*)/);
    const utmMediumMatch = url.match(/[?&]utm_medium=([^&]*)/);
    const utmCampaignMatch = url.match(/[?&]utm_campaign=([^&]*)/);
    const utmContentMatch = url.match(/[?&]utm_content=([^&]*)/);
    const utmTermMatch = url.match(/[?&]utm_term=([^&]*)/);
    
    return {
      utmSource: utmSourceMatch ? decodeURIComponent(utmSourceMatch[1]) : undefined,
      utmMedium: utmMediumMatch ? decodeURIComponent(utmMediumMatch[1]) : undefined,
      utmCampaign: utmCampaignMatch ? decodeURIComponent(utmCampaignMatch[1]) : undefined,
      utmContent: utmContentMatch ? decodeURIComponent(utmContentMatch[1]) : undefined,
      utmTerm: utmTermMatch ? decodeURIComponent(utmTermMatch[1]) : undefined
    };
  }
}

export async function fetchOrderAttribution(
  storeDomain: string,
  accessToken: string,
  orderId: string
): Promise<{
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
}> {
  try {
    const formattedDomain = formatStoreDomain(storeDomain);
    
    // Use REST API to fetch order with attribution data
    const response = await fetch(`https://${formattedDomain}/admin/api/2025-10/orders/${orderId}.json`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(`Failed to fetch order ${orderId}: ${response.status} - ${errorText}`);
      return {};
    }

    const data = await response.json();
    const order = data.order;
    
    if (!order) {
      console.warn(`Order ${orderId} not found`);
      return {};
    }

    // Extract UTM parameters from landing_site URL
    const landingSite = order.landing_site;
    const landingSiteUtm = landingSite ? extractUtmFromUrl(landingSite) : {};
    
    // Extract UTM parameters from note_attributes (in case they're stored there)
    const noteAttributes = order.note_attributes || [];
    const noteAttributeUtm: any = {};
    noteAttributes.forEach((attr: any) => {
      if (attr.name && attr.value) {
        const name = attr.name.toLowerCase();
        if (name === 'utm_source') noteAttributeUtm.utmSource = attr.value;
        if (name === 'utm_medium') noteAttributeUtm.utmMedium = attr.value;
        if (name === 'utm_campaign') noteAttributeUtm.utmCampaign = attr.value;
        if (name === 'utm_content') noteAttributeUtm.utmContent = attr.value;
        if (name === 'utm_term') noteAttributeUtm.utmTerm = attr.value;
      }
    });

    // Combine UTM sources: prefer note_attributes, then landing_site
    const utmParams = {
      utmSource: noteAttributeUtm.utmSource || landingSiteUtm.utmSource,
      utmMedium: noteAttributeUtm.utmMedium || landingSiteUtm.utmMedium,
      utmCampaign: noteAttributeUtm.utmCampaign || landingSiteUtm.utmCampaign,
      utmContent: noteAttributeUtm.utmContent || landingSiteUtm.utmContent,
      utmTerm: noteAttributeUtm.utmTerm || landingSiteUtm.utmTerm
    };

    // Extract session details from order
    const sessionDetails = {
      landingPage: landingSite || undefined,
      referringSite: order.referring_site || undefined,
      visitDate: order.created_at || undefined,
      marketingChannel: undefined as string | undefined // Not available in REST API
    };

    // Parse landing page path if available
    if (landingSite) {
      try {
        const url = new URL(landingSite.startsWith('http') ? landingSite : `https://example.com${landingSite}`);
        sessionDetails.landingPage = url.pathname;
      } catch {
        // If parsing fails, use as-is
      }
    }

    return {
      ...utmParams,
      sessionDetails: (sessionDetails.landingPage || sessionDetails.referringSite) ? sessionDetails : undefined
    };
  } catch (error: any) {
    console.warn(`Error fetching attribution for order ${orderId}:`, error);
    return {};
  }
}

export async function updateOrderTracking(
  storeDomain: string,
  accessToken: string,
  orderNumber: string,
  trackingNumber: string,
  trackingCompany: string,
  trackingUrl?: string,
  notifyCustomer: boolean = true,
  fulfillItems: boolean = true,
  fulfillShippingNotRequired: boolean = true
): Promise<any> {
  try {
    const formattedDomain = formatStoreDomain(storeDomain);
    console.log('Updating tracking for order:', orderNumber);

    // First, get the order with full details including line items
    const orderResponse = await fetch(`https://${formattedDomain}/admin/api/2025-10/orders.json?name=${orderNumber}&status=any`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken
      }
    });

    if (!orderResponse.ok) {
      const errorText = await orderResponse.text();
      console.error('Failed to fetch order:', errorText);
      throw new Error(`Failed to fetch order: ${orderResponse.status} ${orderResponse.statusText}`);
    }

    const orderData = await orderResponse.json();
    const order = orderData.orders[0];
    
    if (!order) {
      throw new Error(`Order ${orderNumber} not found`);
    }

    console.log('Order found:', {
      id: order.id,
      order_number: order.order_number,
      fulfillment_status: order.fulfillment_status,
      financial_status: order.financial_status,
      line_items_count: order.line_items?.length || 0
    });

    // Check if order is already fulfilled
    if (order.fulfillment_status === 'fulfilled') {
      console.log('Order is already fulfilled, updating tracking only');
      
      // Get existing fulfillments
      const fulfillmentsResponse = await fetch(`https://${formattedDomain}/admin/api/2025-10/orders/${order.id}/fulfillments.json`, {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken
        }
      });

      if (fulfillmentsResponse.ok) {
        const fulfillmentsData = await fulfillmentsResponse.json();
        const lastFulfillment = fulfillmentsData.fulfillments[fulfillmentsData.fulfillments.length - 1];
        
        if (lastFulfillment) {
          // Use the proper tracking update endpoint as per Shopify documentation
          const trackingUpdateData = {
            fulfillment: {
              tracking_info: {
                number: trackingNumber,
                company: trackingCompany,
                url: trackingUrl
              },
              notify_customer: notifyCustomer
            }
          };

          const updateResponse = await fetch(`https://${formattedDomain}/admin/api/2025-10/fulfillments/${lastFulfillment.id}/update_tracking.json`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Shopify-Access-Token': accessToken
            },
            body: JSON.stringify(trackingUpdateData)
          });

          if (updateResponse.ok) {
            const updateResult = await updateResponse.json();
            console.log('Tracking updated successfully for existing fulfillment using update_tracking endpoint:', {
              fulfillmentId: updateResult.fulfillment.id,
              trackingNumber: updateResult.fulfillment.tracking_number || updateResult.fulfillment.tracking_info?.number,
              trackingCompany: updateResult.fulfillment.tracking_company || updateResult.fulfillment.tracking_info?.company,
              trackingUrl: updateResult.fulfillment.tracking_url || updateResult.fulfillment.tracking_info?.url,
              notifyCustomer: updateResult.fulfillment.notify_customer
            });
            
            // Verify the tracking information was saved
            try {
              const verifyResponse = await fetch(`https://${formattedDomain}/admin/api/2025-10/orders/${order.id}/fulfillments.json`, {
                headers: {
                  'Content-Type': 'application/json',
                  'X-Shopify-Access-Token': accessToken
                }
              });
              
              if (verifyResponse.ok) {
                const verifyData = await verifyResponse.json();
                const updatedFulfillment = verifyData.fulfillments.find((f: any) => f.id === updateResult.fulfillment.id);
                console.log('Verification - Updated fulfillment tracking info:', {
                  trackingNumber: updatedFulfillment?.tracking_number || updatedFulfillment?.tracking_info?.number,
                  trackingCompany: updatedFulfillment?.tracking_company || updatedFulfillment?.tracking_info?.company,
                  trackingUrl: updatedFulfillment?.tracking_url || updatedFulfillment?.tracking_info?.url
                });
              }
            } catch (verifyError) {
              console.error('Failed to verify tracking information:', verifyError);
            }
            
            return updateResult;
          } else {
            const errorText = await updateResponse.text();
            console.error('Tracking update failed:', {
              status: updateResponse.status,
              statusText: updateResponse.statusText,
              body: errorText
            });
            throw new Error(`Failed to update tracking: ${updateResponse.status} ${updateResponse.statusText} - ${errorText}`);
          }
        }
      }
    }

    // Get fulfillment orders for the order
    const fulfillmentOrdersResponse = await fetch(`https://${formattedDomain}/admin/api/2025-10/orders/${order.id}/fulfillment_orders.json`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken
      }
    });

    if (!fulfillmentOrdersResponse.ok) {
      const errorText = await fulfillmentOrdersResponse.text();
      console.error('Failed to fetch fulfillment orders:', errorText);
      throw new Error(`Failed to fetch fulfillment orders: ${fulfillmentOrdersResponse.status} ${fulfillmentOrdersResponse.statusText}`);
    }

    const fulfillmentOrdersData = await fulfillmentOrdersResponse.json();
    const fulfillmentOrders = fulfillmentOrdersData.fulfillment_orders;

    if (!fulfillmentOrders || fulfillmentOrders.length === 0) {
      throw new Error('No fulfillment orders found for this order');
    }

    console.log('Fulfillment orders found:', fulfillmentOrders.length);

    // Group fulfillment orders by location ID
    const fulfillmentOrdersByLocation = new Map<number, any[]>();
    
    fulfillmentOrders.forEach((fulfillmentOrder: any) => {
      const locationId = fulfillmentOrder.assigned_location_id;
      if (!fulfillmentOrdersByLocation.has(locationId)) {
        fulfillmentOrdersByLocation.set(locationId, []);
      }
      
      const fulfillableLineItems = fulfillmentOrder.line_items
        .filter((item: any) => {
          // Only fulfill items that require shipping or if fulfillShippingNotRequired is true
          const requiresShipping = item.requires_shipping !== false;
          return fulfillShippingNotRequired || requiresShipping;
        })
        .map((item: any) => ({
          id: item.id,
          quantity: item.fulfillable_quantity
        }));

      if (fulfillableLineItems.length > 0) {
        fulfillmentOrdersByLocation.get(locationId)!.push({
          fulfillment_order_id: fulfillmentOrder.id,
          fulfillment_order_line_items: fulfillableLineItems
        });
      }
    });

    if (fulfillmentOrdersByLocation.size === 0) {
      throw new Error('No fulfillable line items found in the fulfillment orders');
    }

    console.log(`Creating ${fulfillmentOrdersByLocation.size} fulfillment(s) for ${fulfillmentOrdersByLocation.size} location(s)`);

    // Create separate fulfillments for each location
    const fulfillmentResults: any[] = [];
    
    for (const [locationId, lineItemsByFulfillmentOrder] of fulfillmentOrdersByLocation.entries()) {
      console.log(`Creating fulfillment for location ${locationId} with ${lineItemsByFulfillmentOrder.length} fulfillment order(s)`);
      
      // Create fulfillment with tracking info using the proper API structure
      const fulfillmentData: any = {
        fulfillment: {
          location_id: locationId,
          tracking_info: {
            number: trackingNumber,
            company: trackingCompany,
            url: trackingUrl
          },
          notify_customer: notifyCustomer && fulfillmentResults.length === 0, // Only notify on first fulfillment
          line_items_by_fulfillment_order: lineItemsByFulfillmentOrder
        }
      };

      console.log('Creating fulfillment with data:', JSON.stringify(fulfillmentData, null, 2));

      // Use the fulfillment creation endpoint as per Shopify documentation
      const fulfillmentResponse: any = await fetch(`https://${formattedDomain}/admin/api/2025-10/fulfillments.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken
        },
        body: JSON.stringify(fulfillmentData)
      });

      if (!fulfillmentResponse.ok) {
        const errorText = await fulfillmentResponse.text();
        console.error('Fulfillment creation failed:', {
          locationId,
          status: fulfillmentResponse.status,
          statusText: fulfillmentResponse.statusText,
          body: errorText
        });
        throw new Error(`Failed to create fulfillment for location ${locationId}: ${fulfillmentResponse.status} ${fulfillmentResponse.statusText} - ${errorText}`);
      }

      const fulfillmentResult: any = await fulfillmentResponse.json();
      fulfillmentResults.push(fulfillmentResult);
      
      console.log(`Fulfillment created successfully for location ${locationId}:`, {
        fulfillmentId: fulfillmentResult.fulfillment.id,
        trackingNumber: fulfillmentResult.fulfillment.tracking_number || fulfillmentResult.fulfillment.tracking_info?.number,
        trackingCompany: fulfillmentResult.fulfillment.tracking_company || fulfillmentResult.fulfillment.tracking_info?.company,
        trackingUrl: fulfillmentResult.fulfillment.tracking_url || fulfillmentResult.fulfillment.tracking_info?.url
      });
    }

    const fulfillmentResult = fulfillmentResults[0]; // Return the first one for backward compatibility
    
    console.log(`All fulfillments created successfully! Total: ${fulfillmentResults.length}`);
    
    // Verify all tracking information was saved
    try {
      const verifyResponse = await fetch(`https://${formattedDomain}/admin/api/2025-10/orders/${order.id}/fulfillments.json`, {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken
        }
      });
      
      if (verifyResponse.ok) {
        const verifyData = await verifyResponse.json();
        console.log(`Verification - Total fulfillments for order: ${verifyData.fulfillments.length}`);
        verifyData.fulfillments.forEach((f: any, index: number) => {
          console.log(`Fulfillment ${index + 1} tracking:`, {
            id: f.id,
            trackingNumber: f.tracking_number || f.tracking_info?.number,
            trackingCompany: f.tracking_company || f.tracking_info?.company,
            trackingUrl: f.tracking_url || f.tracking_info?.url
          });
        });
      }
    } catch (verifyError) {
      console.error('Failed to verify tracking information:', verifyError);
    }
    
    return fulfillmentResult;
  } catch (error) {
    console.error('Failed to update order tracking:', error);
    throw error;
  }
} 