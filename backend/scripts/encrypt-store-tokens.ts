/**
 * One-time: encrypt every plaintext ShopifyStore.accessToken at rest.
 * Idempotent — rows already in `enc2:` format are skipped, and decryptToken
 * passes plaintext through, so running the app before/after this is safe.
 *
 * Usage: ts-node backend/scripts/encrypt-store-tokens.ts
 */
import { PrismaClient } from '@prisma/client';
import { encryptToken } from '../src/lib/token-crypto';

const prisma = new PrismaClient();

async function main() {
  const stores = await prisma.shopifyStore.findMany({ select: { id: true, storeDomain: true, accessToken: true } });
  let encrypted = 0, skipped = 0;
  for (const s of stores) {
    if (s.accessToken.startsWith('enc2:')) { skipped++; continue; }
    await prisma.shopifyStore.update({
      where: { id: s.id },
      data: { accessToken: encryptToken(s.accessToken) }
    });
    encrypted++;
    console.log(`encrypted token for ${s.storeDomain}`);
  }
  console.log(`Done: ${encrypted} encrypted, ${skipped} already encrypted.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
