const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        console.log('Adding tracking_prefixes column...');
        await prisma.$executeRawUnsafe(`ALTER TABLE shipping_companies ADD COLUMN IF NOT EXISTS tracking_prefixes TEXT;`);
        console.log('Column added successfully!');
    } catch (error) {
        console.error('Error adding column:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
