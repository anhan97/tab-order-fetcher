/**
 * Auth + per-user store management.
 *
 * Public:
 *   POST /api/auth/register          email + password → JWT
 *   POST /api/auth/login             email + password → JWT
 *   GET  /api/auth/verify/:token     mark email verified
 *
 * Authed (require Bearer JWT):
 *   GET    /api/auth/me              current user profile
 *   GET    /api/auth/stores          list this user's Shopify stores
 *   POST   /api/auth/stores          add a store (storeDomain + accessToken)
 *   DELETE /api/auth/stores/:id      remove (soft) a store
 *
 * The active-store choice is a frontend-side concern (saved in localStorage).
 * The backend just exposes "the list" — every other route still takes
 * `X-Shopify-Store-Domain` to identify which store the request targets, but
 * `resolveStore` now prefers the JWT user when one is provided.
 */

import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthController } from '../controllers/auth.controller';
import {
  validateRegistration,
  validateLogin
} from '../middleware/validation.middleware';
import { requireAuth } from '../middleware/require-auth';

const router = Router();
const authController = new AuthController();
const prisma = new PrismaClient();

function normalizeDomain(d: string): string {
  return d.replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/\/admin$/, '');
}

router.post('/register', validateRegistration, (req, res) => authController.register(req, res));
router.post('/login', validateLogin, (req, res) => authController.login(req, res));
router.get('/verify/:token', (req, res) => authController.verifyEmail(req, res));

// ─── Authed ───────────────────────────────────────────────────────────────

router.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { id: true, email: true, firstName: true, lastName: true, isVerified: true, createdAt: true }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to load user' });
  }
});

router.get('/stores', requireAuth, async (req: Request, res: Response) => {
  try {
    // Return accessToken too — caller is the owner, and the existing
    // client-side Shopify calls (OrdersTable, CSV export, etc) need it
    // until the rest of the app moves fully to backend-proxied requests.
    const stores = await prisma.shopifyStore.findMany({
      where: { userId: req.userId!, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        storeDomain: true,
        accessToken: true,
        name: true,
        defaultShippingCompany: true,
        defaultSupplier: true,
        createdAt: true,
        updatedAt: true
      }
    });
    res.json({ stores });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to list stores' });
  }
});

router.post('/stores', requireAuth, async (req: Request, res: Response) => {
  try {
    const { storeDomain, accessToken, name } = req.body || {};
    if (!storeDomain || !accessToken) {
      return res.status(400).json({ error: 'storeDomain and accessToken are required' });
    }
    const domain = normalizeDomain(storeDomain);

    // Update if a row already exists for this user+domain (token re-paste);
    // otherwise create. Saves users from "store already exists" errors when
    // they paste a new token after the old one expired.
    const existing = await prisma.shopifyStore.findUnique({
      where: { userId_storeDomain: { userId: req.userId!, storeDomain: domain } }
    });
    let store;
    if (existing) {
      store = await prisma.shopifyStore.update({
        where: { id: existing.id },
        data: { accessToken, name: name || existing.name, isActive: true }
      });
    } else {
      store = await prisma.shopifyStore.create({
        data: { userId: req.userId!, storeDomain: domain, accessToken, name: name || domain, isActive: true }
      });
    }
    res.json({
      store: {
        id: store.id,
        storeDomain: store.storeDomain,
        accessToken: store.accessToken,
        name: store.name,
        defaultShippingCompany: store.defaultShippingCompany,
        defaultSupplier: store.defaultSupplier
      }
    });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to add store' });
  }
});

router.delete('/stores/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const store = await prisma.shopifyStore.findUnique({ where: { id } });
    if (!store) return res.status(404).json({ error: 'Store not found' });
    if (store.userId !== req.userId) return res.status(403).json({ error: 'Not your store' });
    // Soft-delete — keeps historical orders / P&L intact.
    await prisma.shopifyStore.update({ where: { id }, data: { isActive: false } });
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to remove store' });
  }
});

export default router;
