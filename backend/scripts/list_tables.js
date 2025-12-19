const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        console.log('Listing tables...');
        const result = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `;
        console.log('Tables:', result);
    } catch (error) {
        console.error('Error listing tables:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
