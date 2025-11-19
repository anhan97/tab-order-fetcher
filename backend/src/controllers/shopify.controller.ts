import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { verifyShopifyCredentials } from '../services/shopify.service';
import { AuthenticatedRequest, RequestHandler } from '../types/express';

const prisma = new PrismaClient();

export class ShopifyController {
  getStores: RequestHandler = async (req, res) => {
    try {
      const stores = await prisma.shopifyStore.findMany({
        where: { userId: req.user.id },
        select: {
          id: true,
          storeDomain: true,
          name: true,
          isActive: true,
          createdAt: true,
          updatedAt: true
        }
      });

      res.json(stores);
    } catch (error: any) {
      console.error('Failed to fetch stores:', error);
      res.status(500).json({ error: 'Failed to fetch stores' });
    }
  };

  addStore: RequestHandler = async (req, res) => {
    try {
      const { storeDomain, accessToken, name } = req.body;

      // Check if store already exists for this user
      const existingStore = await prisma.shopifyStore.findFirst({
        where: {
          userId: req.user.id,
          storeDomain
        }
      });

      if (existingStore) {
        return res.status(400).json({ error: 'Store already exists' });
      }

      // Verify store credentials
      try {
        await verifyShopifyCredentials(storeDomain, accessToken);
      } catch (error) {
        return res.status(400).json({ error: 'Invalid store credentials' });
      }

      // Create store
      const store = await prisma.shopifyStore.create({
        data: {
          userId: req.user.id,
          storeDomain,
          accessToken,
          name,
          isActive: true
        }
      });

      res.status(201).json({
        id: store.id,
        storeDomain: store.storeDomain,
        name: store.name,
        isActive: store.isActive,
        createdAt: store.createdAt,
        updatedAt: store.updatedAt
      });
    } catch (error: any) {
      console.error('Failed to add store:', error);
      res.status(500).json({ error: 'Failed to add store' });
    }
  };

  updateStore: RequestHandler = async (req, res) => {
    try {
      const { id } = req.params;
      const { storeDomain, accessToken, name, isActive } = req.body;

      // Check if store exists and belongs to user
      const existingStore = await prisma.shopifyStore.findFirst({
        where: {
          id,
          userId: req.user.id
        }
      });

      if (!existingStore) {
        return res.status(404).json({ error: 'Store not found' });
      }

      // If credentials changed, verify them
      if (storeDomain !== existingStore.storeDomain || accessToken !== existingStore.accessToken) {
        try {
          await verifyShopifyCredentials(storeDomain, accessToken);
        } catch (error) {
          return res.status(400).json({ error: 'Invalid store credentials' });
        }
      }

      // Update store
      const store = await prisma.shopifyStore.update({
        where: { id },
        data: {
          storeDomain,
          accessToken,
          name,
          isActive
        }
      });

      res.json({
        id: store.id,
        storeDomain: store.storeDomain,
        name: store.name,
        isActive: store.isActive,
        createdAt: store.createdAt,
        updatedAt: store.updatedAt
      });
    } catch (error: any) {
      console.error('Failed to update store:', error);
      res.status(500).json({ error: 'Failed to update store' });
    }
  };

  deleteStore: RequestHandler = async (req, res) => {
    try {
      const { id } = req.params;

      // Check if store exists and belongs to user
      const store = await prisma.shopifyStore.findFirst({
        where: {
          id,
          userId: req.user.id
        }
      });

      if (!store) {
        return res.status(404).json({ error: 'Store not found' });
      }

      // Delete store
      await prisma.shopifyStore.delete({
        where: { id }
      });

      res.json({ message: 'Store deleted successfully' });
    } catch (error: any) {
      console.error('Failed to delete store:', error);
      res.status(500).json({ error: 'Failed to delete store' });
    }
  };

  verifyStore: RequestHandler = async (req, res) => {
    try {
      const { storeDomain, accessToken } = req.body;

      try {
        const shopInfo = await verifyShopifyCredentials(storeDomain, accessToken);
        res.json({
          valid: true,
          shopInfo
        });
      } catch (error) {
        res.json({
          valid: false,
          error: 'Invalid store credentials'
        });
      }
    } catch (error: any) {
      console.error('Failed to verify store:', error);
      res.status(500).json({ error: 'Failed to verify store' });
    }
  };

  fetchOrders: RequestHandler = async (req, res) => {
    try {
      const { id } = req.params;
      const { page = '1', limit = '50', status } = req.query;

      // Check if store exists and belongs to user
      const store = await prisma.shopifyStore.findFirst({
        where: {
          id,
          userId: req.user.id
        }
      });

      if (!store) {
        return res.status(404).json({ error: 'Store not found' });
      }

      // Fetch orders from database
      const where = {
        storeId: id,
        ...(status ? { fulfillmentStatus: String(status) } : {})
      };

      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where,
          skip: (Number(page) - 1) * Number(limit),
          take: Number(limit),
          orderBy: { createdAt: 'desc' }
        }),
        prisma.order.count({ where })
      ]);

      res.json({
        orders,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      });
    } catch (error: any) {
      console.error('Failed to fetch orders:', error);
      res.status(500).json({ error: 'Failed to fetch orders' });
    }
  };
} 