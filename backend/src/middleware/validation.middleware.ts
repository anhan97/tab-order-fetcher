import { Request, Response, NextFunction } from 'express';

export function validateRegistration(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const { email, password, firstName, lastName } = req.body;

  // Email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  // Password validation
  if (!password || password.length < 8) {
    return res.status(400).json({
      error: 'Password must be at least 8 characters long'
    });
  }

  // Name validation (optional fields)
  if (firstName && typeof firstName !== 'string') {
    return res.status(400).json({ error: 'First name must be a string' });
  }

  if (lastName && typeof lastName !== 'string') {
    return res.status(400).json({ error: 'Last name must be a string' });
  }

  next();
}

export function validateLogin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      error: 'Email and password are required'
    });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  next();
}

export function validateShopifyStore(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const { storeDomain, accessToken } = req.body;

  if (!storeDomain || typeof storeDomain !== 'string') {
    return res.status(400).json({ error: 'Valid store domain is required' });
  }

  if (!accessToken || typeof accessToken !== 'string') {
    return res.status(400).json({ error: 'Valid access token is required' });
  }

  // Basic Shopify domain validation
  const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;
  if (!domainRegex.test(storeDomain)) {
    return res.status(400).json({
      error: 'Invalid Shopify store domain. Must be in format: store-name.myshopify.com'
    });
  }

  next();
}

export function validateFacebookAdAccount(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const { accountId, accessToken } = req.body;

  if (!accountId || typeof accountId !== 'string') {
    return res.status(400).json({ error: 'Valid account ID is required' });
  }

  if (!accessToken || typeof accessToken !== 'string') {
    return res.status(400).json({ error: 'Valid access token is required' });
  }

  // Basic Facebook Ad Account ID validation
  const accountIdRegex = /^act_\d+$/;
  if (!accountIdRegex.test(accountId)) {
    return res.status(400).json({
      error: 'Invalid Facebook Ad Account ID. Must start with "act_" followed by numbers'
    });
  }

  next();
} 