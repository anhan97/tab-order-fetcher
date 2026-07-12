import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { User, UserWithoutDates } from '../types/user';

const prisma = new PrismaClient();

interface JwtPayload {
  id: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: UserWithoutDates;
    }
  }
}

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];

    // Verify token
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'default-secret'
    ) as JwtPayload;

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        isVerified: true,
        status: true
      }
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    if (!user.isVerified) {
      return res.status(401).json({ error: 'Please verify your email' });
    }

    // Approval gate — mirrors requireActive for routes on this legacy path.
    if (user.status === 'PENDING') {
      return res.status(403).json({ error: 'Account is awaiting admin approval', code: 'account_pending' });
    }
    if (user.status === 'SUSPENDED') {
      return res.status(403).json({ error: 'Account is suspended', code: 'account_suspended' });
    }

    // Attach user to request object
    const { status: _status, ...publicFields } = user;
    req.user = publicFields;
    next();
  } catch (error: any) {
    console.error('Authentication error:', error);
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    res.status(500).json({ error: 'Authentication failed' });
  }
} 