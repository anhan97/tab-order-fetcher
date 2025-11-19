# Environment Variables Configuration

This document describes the environment variables used in the backend application.

## Required Environment Variables

Create a `.env` file in the backend directory with the following variables:

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

## Example .env File

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

To add new CORS origins (like new ngrok URLs), simply add them to the `CORS_ORIGINS` environment variable:

```env
CORS_ORIGINS="http://localhost:8080,https://bb498c1eeb78.ngrok-free.app,https://79c9428e7101.ngrok-free.app,https://new-ngrok-url.ngrok-free.app"
```

## Security Notes

1. **Never commit the `.env` file** to version control
2. **Change the JWT_SECRET** in production
3. **Use HTTPS URLs** in production for CORS_ORIGINS
4. **Limit CORS_ORIGINS** to only necessary domains in production

## Development vs Production

### Development
- Use localhost URLs for CORS_ORIGINS
- Use development database
- Use simple JWT_SECRET

### Production
- Use production domain URLs for CORS_ORIGINS
- Use production database
- Use strong, random JWT_SECRET
- Set NODE_ENV=production
