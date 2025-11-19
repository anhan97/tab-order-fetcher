import express from 'express';
import { fetchFromFacebookApi } from '../services/facebook.service';
import { FACEBOOK_CONFIG } from '../config/facebook';
import fetch from 'node-fetch';

const router = express.Router();

// Exchange short-lived token for long-lived token
router.post('/exchange-token', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    const url = `https://graph.facebook.com/${FACEBOOK_CONFIG.version}/oauth/access_token`;
    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: FACEBOOK_CONFIG.appId,
      client_secret: FACEBOOK_CONFIG.appSecret,
      fb_exchange_token: token,
    });

    const response = await fetch(`${url}?${params}`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Facebook API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Token exchange error:', error);
    res.status(500).json({ error: 'Failed to exchange token' });
  }
});

// Facebook API proxy endpoint
router.get('/proxy', async (req, res) => {
  try {
    const { url, access_token } = req.query;

    if (!url || !access_token) {
      return res.status(400).json({
        error: 'Missing required parameters',
        required: {
          url: !url,
          access_token: !access_token
        }
      });
    }

    const urlStr = url as string;
    const tokenStr = access_token as string;

    // Add access token to URL if not already present
    const finalUrl = urlStr.includes('access_token=')
      ? urlStr
      : `${urlStr}${urlStr.includes('?') ? '&' : '?'}access_token=${tokenStr}`;

    const response = await fetch(finalUrl);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Facebook API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Facebook API proxy error:', error);
    res.status(500).json({
      error: 'Failed to fetch from Facebook API',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router; 