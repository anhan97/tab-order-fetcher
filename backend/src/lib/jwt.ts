/**
 * Access + refresh token helpers.
 *
 * Access JWT: short-lived (ACCESS_TOKEN_TTL, default 15m). The payload keeps
 * the legacy `id` field (require-auth/resolveStore already read `payload.id`)
 * and adds `status`/`role` so middleware can gate PENDING/SUSPENDED users
 * without a DB hit.
 *
 * Refresh token: opaque 48-byte random string; only its SHA-256 hash is
 * stored (RefreshToken table). Rotated on every /api/auth/refresh; revoking
 * a user's rows (admin suspend) kills their sessions as soon as the current
 * access token expires.
 */
import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'default-secret';
const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || '15m';
const REFRESH_TOKEN_TTL_DAYS = parseInt(process.env.REFRESH_TOKEN_TTL_DAYS || '30', 10);

export interface AccessTokenClaims {
  id: string;      // userId — legacy field name, do not rename
  status: string;  // PENDING | ACTIVE | SUSPENDED
  role: string;    // user | admin | cs | finance
}

export function signAccessToken(claims: AccessTokenClaims): string {
  return jwt.sign(claims, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  return jwt.verify(token, JWT_SECRET) as AccessTokenClaims;
}

export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(48).toString('hex');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function refreshExpiry(): Date {
  const d = new Date();
  d.setDate(d.getDate() + REFRESH_TOKEN_TTL_DAYS);
  return d;
}
