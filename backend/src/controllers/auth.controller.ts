import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { sendVerificationEmail } from '../services/email.service';
import { ensureAdminByEmail } from '../middleware/require-admin';

const prisma = new PrismaClient();

export class AuthController {
  async register(req: Request, res: Response) {
    try {
      const { email, password, firstName, lastName } = req.body;

      // Validate input
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      // Check if user exists
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return res.status(400).json({ error: 'Email already registered' });
      }

      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      // Generate verification token
      const verifyToken = uuidv4();
      const requireVerify = process.env.AUTH_REQUIRE_EMAIL_VERIFICATION === '1';

      // Create user — auto-verified when SMTP isn't enforced so the user
      // can log in immediately. The verifyToken is still issued so that
      // email verification can be enabled later without re-registering.
      const user = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          firstName,
          lastName,
          verifyToken,
          isVerified: !requireVerify
        }
      });

      // Send verification email — best-effort. SMTP misconfig must not
      // block registration in dev / self-hosted setups.
      try {
        await sendVerificationEmail(email, verifyToken);
      } catch (err: any) {
        console.warn('[auth] sendVerificationEmail failed (non-fatal):', err?.message);
      }

      // Generate JWT
      const token = jwt.sign(
        { id: user.id },
        process.env.JWT_SECRET || 'default-secret',
        { expiresIn: '24h' }
      );

      res.status(201).json({
        message: 'Registration successful. Please check your email to verify your account.',
        token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          isVerified: user.isVerified
        }
      });
    } catch (error: any) {
      console.error('Registration error:', error);
      res.status(500).json({ error: 'Registration failed', message: error.message });
    }
  }

  async login(req: Request, res: Response) {
    try {
      const { email, password } = req.body;

      // Validate input
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      // Find user
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Email verification gate — opt out for self-hosted deployments where
      // SMTP isn't configured yet. Set AUTH_REQUIRE_EMAIL_VERIFICATION=0
      // (or unset) to allow unverified users to log in.
      if (!user.isVerified && process.env.AUTH_REQUIRE_EMAIL_VERIFICATION === '1') {
        return res.status(401).json({ error: 'Please verify your email before logging in' });
      }

      // Bootstrap admin role from env. Idempotent — only updates the matching
      // email when not already admin. Lets self-hosted deployments designate
      // an owner without manual SQL.
      const adminEmail = process.env.ADMIN_EMAIL;
      if (adminEmail && adminEmail.toLowerCase() === user.email.toLowerCase()) {
        await ensureAdminByEmail(adminEmail);
      }

      // Generate JWT
      const token = jwt.sign(
        { id: user.id },
        process.env.JWT_SECRET || 'default-secret',
        { expiresIn: '24h' }
      );

      res.json({
        token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          isVerified: user.isVerified
        }
      });
    } catch (error: any) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Login failed', message: error.message });
    }
  }

  async verifyEmail(req: Request, res: Response) {
    try {
      const { token } = req.params;

      // Find user with token
      const user = await prisma.user.findFirst({
        where: { verifyToken: token }
      });

      if (!user) {
        return res.status(400).json({ error: 'Invalid verification token' });
      }

      // Update user verification status
      await prisma.user.update({
        where: { id: user.id },
        data: {
          isVerified: true,
          verifyToken: null
        }
      });

      res.json({ message: 'Email verified successfully' });
    } catch (error: any) {
      console.error('Email verification error:', error);
      res.status(500).json({ error: 'Email verification failed', message: error.message });
    }
  }
} 