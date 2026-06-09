/**
 * Migración: renombra brandId 'snfplus' → 'snfplus_usuario' en la BD.
 * Afecta a knowledge_chunks y conversations.
 *
 * Uso: node scratch/migrate-brand-snfplus.js
 */

require('dotenv').config();
const prisma = require('../src/services/db.service');

async function main() {
  console.log('Iniciando migración snfplus → snfplus_usuario...\n');

  // Chunks de conocimiento
  const chunks = await prisma.$executeRaw`
    UPDATE "KnowledgeChunk"
    SET "brandId" = 'snfplus_usuario'
    WHERE "brandId" = 'snfplus'
  `;
  console.log(`KnowledgeChunk actualizados: ${chunks}`);

  // Conversaciones
  const convs = await prisma.$executeRaw`
    UPDATE "Conversation"
    SET "brandId" = 'snfplus_usuario'
    WHERE "brandId" = 'snfplus'
  `;
  console.log(`Conversation actualizadas: ${convs}`);

  console.log('\nMigración completada.');
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
