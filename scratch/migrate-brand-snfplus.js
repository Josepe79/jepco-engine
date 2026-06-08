/**
 * Migración: renombra brandId 'snfplus' → 'snfplus_usuario' en la BD.
 * Afecta a knowledge_chunks y conversations.
 *
 * Uso: node scratch/migrate-brand-snfplus.js
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando migración snfplus → snfplus_usuario...\n');

  // Chunks de conocimiento
  const chunks = await prisma.$executeRaw`
    UPDATE knowledge_chunks
    SET "brandId" = 'snfplus_usuario'
    WHERE "brandId" = 'snfplus'
  `;
  console.log(`knowledge_chunks actualizados: ${chunks}`);

  // Conversaciones
  const convs = await prisma.$executeRaw`
    UPDATE conversations
    SET "brandId" = 'snfplus_usuario'
    WHERE "brandId" = 'snfplus'
  `;
  console.log(`conversations actualizadas: ${convs}`);

  console.log('\nMigración completada.');
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
