/**
 * At-rest encryption for Shopify store access tokens (AES-256-CBC).
 *
 * Format: `enc2:<iv-hex>:<ciphertext-hex>` — the prefix is deliberately NOT
 * `enc:` because UserFacebookConnection historically used that for a retired
 * scheme and treats it as "please reconnect".
 *
 * decryptToken() passes plaintext through untouched, so rows written before
 * this landed keep working; they get upgraded to ciphertext the next time
 * the token is (re)saved.
 */
import * as crypto from 'crypto';

const PREFIX = 'enc2:';

function encryptionKey(): Buffer {
  const secret = process.env.TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET || 'default-secret';
  // Always derive via SHA-256 so any secret length yields a valid 32-byte key.
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptToken(plain: string): string {
  if (!plain || plain.startsWith(PREFIX)) return plain;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptToken(stored: string): string {
  if (!stored || !stored.startsWith(PREFIX)) return stored; // legacy plaintext row
  const [ivHex, dataHex] = stored.slice(PREFIX.length).split(':');
  if (!ivHex || !dataHex) throw new Error('Corrupt encrypted token');
  const decipher = crypto.createDecipheriv('aes-256-cbc', encryptionKey(), Buffer.from(ivHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}
