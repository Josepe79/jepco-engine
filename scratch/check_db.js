const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const count = await prisma.knowledgeChunk.count();
  console.log(`Chunks totales en DB: ${count}`);
  
  if (count > 0) {
    const categories = await prisma.$queryRaw`SELECT category, COUNT(*) as count FROM "KnowledgeChunk" GROUP BY category`;
    console.log('Categorías encontradas:', categories);
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
