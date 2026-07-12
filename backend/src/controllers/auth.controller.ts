import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { sendVerificationEmail } from '../services/email.service';
import { ensureAdminByEmail } from '../middleware/require-admin';
import { signAccessToken, generateRefreshToken, hashToken, refreshExpiry } from '../lib/jwt';
import { audit } from '../lib/audit';

const prisma = new PrismaClient();

type DbUser = {
  id: string; email: string; firstName: string | null; lastName: string | null;
  isVerified: boolean; role: string; status: string;
};

function publicUser(user: DbUser) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    isVerified: user.isVerified,
    role: user.role,
    status: user.status
  };
}

/** Issue a short-lived access JWT + a rotating refresh token (hash stored). */
async function issueTokens(user: DbUser): Promise<{ token: string; refreshToken: string }> {
  const token = signAccessToken({ id: user.id, status: user.status, role: user.role });
  const { token: refreshToken, hash } = generateRefreshToken();
  await prisma.refreshToken.create({
    data: { userId: user.id, tokenHash: hash, expiresAt: refreshExpiry() }
  });
  return { token, refreshToken };
}

/** Kill every active session for a user (admin suspend / reject). */
export async function revokeAllRefreshTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() }
  });
}

export class AuthController {
  async register(req: Request, res: Response) {
    try {
      const { email, password, firstName, lastName } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return res.status(400).json({ error: 'Email already registered' });
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      const verifyToken = uuidv4();
      const requireVerify = process.env.AUTH_REQUIRE_EMAIL_VERIFICATION === '1';

      // Approval gate: everyone registers as PENDING and waits for an admin.
      // Exceptions bootstrap the install: the ADMIN_EMAIL owner, and the very
      // first user of an empty database (someone must be able to approve).
      const userCount = await prisma.user.count();
      const isBootstrapAdmin =
        (process.env.ADMIN_EMAIL || '').toLowerCase() === String(email).toLowerCase() || userCount === 0;

      const user = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          firstName,
          lastName,
          verifyToken,
          isVerified: !requireVerify,
          status: isBootstrapAdmin ? 'ACTIVE' : 'PENDING',
          role: isBootstrapAdmin ? 'admin' : 'user'
        }
      });

      // Send verification email — best-effort. SMTP misconfig must not
      // block registration in dev / self-hosted setups.
      try {
        await sendVerificationEmail(email, verifyToken);
      } catch (err: any) {
        console.warn('[auth] sendVerificationEmail failed (non-fatal):', err?.message);
      }

      // PENDING users still get a session so the UI can show the "waiting
      // for approval" screen; feature routes are gated by requireActive.
      const tokens = await issueTokens(user as DbUser);
      await audit({ userId: user.id, actorUserId: user.id, action: 'auth.registered', target: user.email });

      res.status(201).json({
        message: user.status === 'PENDING'
          ? 'Registration successful. Your account is awaiting admin approval.'
          : 'Registration successful.',
        ...tokens,
        user: publicUser(user as DbUser)
      });
    } catch (error: any) {
      console.error('Registration error:', error);
      res.status(500).json({ error: 'Registration failed', message: error.message });
    }
  }

  async login(req: Request, res: Response) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      let user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

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
      // an owner without manual SQL. Also forces ACTIVE so the owner can
      // never lock themselves out behind their own approval gate.
      const adminEmail = process.env.ADMIN_EMAIL;
      if (adminEmail && adminEmail.toLowerCase() === user.email.toLowerCase()) {
        await ensureAdminByEmail(adminEmail);
        if (user.status !== 'ACTIVE') {
          await prisma.user.update({ where: { id: user.id }, data: { status: 'ACTIVE' } });
        }
        user = (await prisma.user.findUnique({ where: { id: user.id } }))!;
      }

      // NOTE: PENDING/SUSPENDED users may still log in — the UI needs the
      // session to show the proper "waiting"/"suspended" screen. Every
      // feature route is gated server-side by requireActive.
      const tokens = await issueTokens(user as DbUser);
      await audit({ userId: user.id, actorUserId: user.id, action: 'auth.login' });

      res.json({ ...tokens, user: publicUser(user as DbUser) });
    } catch (error: any) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Login failed', message: error.message });
    }
  }

  /** Rotate: exchange a valid refresh token for a fresh access+refresh pair. */
  async refresh(req: Request, res: Response) {
    try {
      const { refreshToken } = req.body || {};
      if (!refreshToken || typeof refreshToken !== 'string') {
        return res.status(400).json({ error: 'refreshToken required' });
      }
      const stored = await prisma.refreshToken.findUnique({
        where: { tokenHash: hashToken(refreshToken) },
        include: { user: true }
      });
      if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
        return res.status(401).json({ error: 'Invalid refresh token', code: 'invalid_refresh' });
      }
      await prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() }
      });
      const tokens = await issueTokens(stored.user as DbUser);
      res.json({ ...tokens, user: publicUser(stored.user as DbUser) });
    } catch (error: any) {
      console.error('Refresh error:', error);
      res.status(500).json({ error: 'Refresh failed', message: error.message });
    }
  }

  /** Revoke the presented refresh token (logout this session). */
  async logout(req: Request, res: Response) {
    try {
      const { refreshToken } = req.body || {};
      if (refreshToken && typeof refreshToken === 'string') {
        await prisma.refreshToken.updateMany({
          where: { tokenHash: hashToken(refreshToken), revokedAt: null },
          data: { revokedAt: new Date() }
        });
      }
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: 'Logout failed', message: error.message });
    }
  }

  async verifyEmail(req: Request, res: Response) {
    try {
      const { token } = req.params;

      const user = await prisma.user.findFirst({
        where: { verifyToken: token }
      });

      if (!user) {
        return res.status(400).json({ error: 'Invalid verification token' });
      }

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
