# Environment Variables Configuration

This document describes the environment variables used in both frontend and backend applications.

## Frontend Environment Variables

Create a `.env` file in the root directory with the following variables:

### API Configuration
```env
# API Base URLs
VITE_API_BASE_URL="http://localhost:3001/api"
VITE_SHOPIFY_API_URL="http://localhost:3001/api/shopify"
VITE_COGS_API_URL="http://localhost:3001/api/cogs"
VITE_FACEBOOK_API_URL="http://localhost:3001/api/facebook"
```

### App Configuration
```env
VITE_APP_NAME="Tab Order Fetcher"
VITE_APP_VERSION="1.0.0"
```

### Feature Flags
```env
VITE_ENABLE_ANALYTICS="true"
VITE_ENABLE_FACEBOOK_ADS="true"
VITE_ENABLE_COGS="true"
```

## Backend Environment Variables

Create a `.env` file in the `backend/` directory with the following variables:

### Database Configuration
```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/tab_order_fetcher"
```

### Server Configuration
```env
PORT=3001
NODE_ENV=development
```

### CORS Configuration
```env
# Comma-separated list of allowed origins
CORS_ORIGINS="http://localhost:8080,https://bb498c1eeb78.ngrok-free.app,https://79c9428e7101.ngrok-free.app"

# For backward compatibility
FRONTEND_URL="http://localhost:8080"
```

### JWT Configuration
```env
JWT_SECRET="your-secret-key-change-this-in-production"
```

### API Versions
```env
SHOPIFY_API_VERSION="2025-10"
FACEBOOK_API_VERSION="v18.0"
```

## Example Configuration Files

### Frontend .env (root directory)
```env
# API Base URLs
VITE_API_BASE_URL="http://localhost:3001/api"
VITE_SHOPIFY_API_URL="http://localhost:3001/api/shopify"
VITE_COGS_API_URL="http://localhost:3001/api/cogs"
VITE_FACEBOOK_API_URL="http://localhost:3001/api/facebook"

# App Configuration
VITE_APP_NAME="Tab Order Fetcher"
VITE_APP_VERSION="1.0.0"

# Feature Flags
VITE_ENABLE_ANALYTICS="true"
VITE_ENABLE_FACEBOOK_ADS="true"
VITE_ENABLE_COGS="true"
```

### Backend .env (backend/ directory)
```env
# Database
DATABASE_URL="postgresql://postgres:password@localhost:5432/tab_order_fetcher"

# Server
PORT=3001
NODE_ENV=development

# CORS Configuration
CORS_ORIGINS="http://localhost:8080,https://bb498c1eeb78.ngrok-free.app,https://79c9428e7101.ngrok-free.app"

# JWT Secret
JWT_SECRET="your-secret-key-change-this-in-production"

# Frontend URL (for backward compatibility)
FRONTEND_URL="http://localhost:8080"

# API Versions
SHOPIFY_API_VERSION="2025-10"
FACEBOOK_API_VERSION="v18.0"
```

## Adding New CORS Origins

To add new CORS origins (like new ngrok URLs), simply add them to the `CORS_ORIGINS` environment variable in the backend `.env` file:

```env
CORS_ORIGINS="http://localhost:8080,https://bb498c1eeb78.ngrok-free.app,https://79c9428e7101.ngrok-free.app,https://new-ngrok-url.ngrok-free.app"
```

## Development vs Production

### Development
- Use localhost URLs for API endpoints
- Use development database
- Use simple JWT_SECRET
- Enable all feature flags

### Production
- Use production domain URLs for API endpoints
- Use production database
- Use strong, random JWT_SECRET
- Set NODE_ENV=production
- Limit CORS_ORIGINS to production domains only
- Disable unnecessary feature flags

## Security Notes

1. **Never commit `.env` files** to version control
2. **Change the JWT_SECRET** in production
3. **Use HTTPS URLs** in production
4. **Limit CORS_ORIGINS** to only necessary domains in production
5. **Use environment-specific API URLs** in production

## File Structure

```
project-root/
├── .env                    # Frontend environment variables
├── backend/
│   ├── .env               # Backend environment variables
│   └── src/
│       └── config/
│           └── app.ts     # Backend configuration
└── src/
    └── config/
        └── app.ts         # Frontend configuration
```
