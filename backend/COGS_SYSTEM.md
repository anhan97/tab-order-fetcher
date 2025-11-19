# Normalized COGS System

## Overview

This system implements a normalized COGS (Cost of Goods Sold) data model with master tables for countries and shipping companies, plus per-variant COGS mappings. It provides a clean API for bulk read/write operations and integrates with the Shopify order system.

## Database Schema

### Master Tables

#### Countries
- `id`: Primary key
- `code`: ISO-2 country code (US, CA, AU, UK, etc.)
- `name`: Full country name
- `currency`: Default currency for the country

#### Shipping Companies
- `id`: Primary key
- `name`: Company identifier (YunTu, Shengtu Logistics, etc.)
- `display_name`: Human-readable company name
- `is_active`: Whether the company is currently active

### COGS Tables

#### Variant Costs
- `variant_id`: Shopify variant ID
- `country_id`: Reference to countries table
- `shipping_company_id`: Reference to shipping_companies table
- `cost`: COGS cost for this variant in this context
- Unique constraint on (variant_id, country_id, shipping_company_id)

#### Combos
- `combo_id`: User-defined combo identifier
- `name`: Combo name
- `trigger_quantity`: Number of products needed to trigger the combo
- `is_active`: Whether the combo is currently active

#### Combo Items
- `combo_id`: Reference to combos table
- `variant_id`: Shopify variant ID
- `quantity`: Quantity of this variant in the combo

#### Combo Overrides
- `combo_id`: Reference to combos table
- `country_id`: Reference to countries table
- `shipping_company_id`: Reference to shipping_companies table
- `override_cost`: Override cost for this combo in this context
- `discount_type`: "percent" or "fixed"
- `discount_value`: Discount amount or percentage

## API Endpoints

### GET /api/cogs/config
Retrieves the current COGS configuration in the format expected by the frontend.

**Response:**
```json
{
  "version": "1.0",
  "currency": "USD",
  "products": [
    {
      "variant_id": 123456789,
      "base_cost": 8.43,
      "overrides": [
        {
          "country": "US",
          "shipping_company": "YunTu",
          "cost": 8.43
        }
      ]
    }
  ],
  "combos": [
    {
      "combo_id": "BUNDLE-2",
      "name": "2-Pack",
      "trigger_quantity": 2,
      "items": [
        {
          "variant_id": 123456789,
          "qty": 2
        }
      ],
      "cogs_rule": {
        "mode": "sum",
        "discount_type": null,
        "discount_value": 0
      },
      "overrides": []
    }
  ]
}
```

### POST /api/cogs/config
Saves a COGS configuration to the database.

**Request Body:** Same format as GET response

**Response:**
```json
{
  "success": true,
  "message": "COGS configuration saved successfully"
}
```

### POST /api/cogs/calculate
Calculates COGS for a specific order.

**Request Body:**
```json
{
  "order_lines": [
    {
      "variant_id": 123456789,
      "quantity": 2
    }
  ],
  "country_code": "US",
  "shipping_company": "YunTu"
}
```

**Response:**
```json
{
  "total_cogs": 16.86,
  "line_details": [
    {
      "variant_id": 123456789,
      "quantity": 2,
      "unit_cost": 8.43,
      "total_cost": 16.86
    }
  ],
  "country": "US",
  "shipping_company": "YunTu"
}
```

### GET /api/cogs/countries
Retrieves all countries.

### GET /api/cogs/shipping-companies
Retrieves all active shipping companies.

## Setup Instructions

1. **Database Setup:**
   ```bash
   cd backend
   node scripts/setup-complete-cogs.js
   ```

2. **Start the Backend:**
   ```bash
   npm run dev
   ```

3. **Frontend Integration:**
   The MinimalCOGSManagement component automatically:
   - Loads COGS config from database on mount
   - Auto-saves changes with 1-second debounce
   - Uses the correct API endpoints

## Quick Setup

Run the complete setup script to create all tables, populate default data, and verify functionality:

```bash
cd backend
node scripts/setup-complete-cogs.js
```

This will:
- ✅ Create all required database tables
- ✅ Insert default countries (US, CA, AU, UK, DE, FR, IT, ES)
- ✅ Insert default shipping companies (YunTu, Shengtu Logistics, Yuanpeng Logistics, DHL, FedEx, UPS)
- ✅ Create performance indexes
- ✅ Test API functionality
- ✅ Verify the complete setup

## Shopify Integration

The system extracts country and shipping information from Shopify orders:

- **Country:** `order.shipping_address.country_code` (ISO-2 format)
- **Shipping Company:** Defaults to "YunTu" (can be enhanced to parse `order.shipping_lines[0].carrier_identifier`)

## Features

### Frontend Features
- **Multi-Country Support:** US, CA, AU, UK with different shipping companies
- **Search Functionality:** Real-time search across products and variants
- **Auto-Save:** Debounced saving to database (1-second delay)
- **Combo Management:** Create combos with trigger quantities
- **Inline Editing:** Edit costs directly in the table

### Backend Features
- **Normalized Schema:** Efficient storage with master tables
- **Bulk Operations:** Single API call to save entire configuration
- **Validation:** Zod schema validation for all inputs
- **Error Handling:** Graceful error handling with detailed messages
- **Performance:** Indexed queries for fast lookups

## Data Flow

1. **User Makes Change** → Frontend updates local state
2. **Debounced Save** → 1-second delay, then POST to `/api/cogs/config`
3. **Database Update** → Transaction-based save to normalized tables
4. **Order Processing** → POST to `/api/cogs/calculate` for COGS calculation
5. **Analytics** → Real-time COGS data in orders and analytics tabs

## Error Handling

- **404 Errors:** Fixed by aligning frontend routes with backend
- **Database Errors:** Graceful fallback with console warnings
- **Validation Errors:** Detailed error messages with field-level validation
- **Network Errors:** Retry logic and user-friendly error messages

## Performance Considerations

- **Debounced Saves:** Prevents excessive API calls during editing
- **Indexed Queries:** Fast lookups on variant_id, country, and shipping company
- **Bulk Operations:** Single transaction for entire configuration save
- **Caching:** Frontend caches calculated costs to avoid repeated API calls
