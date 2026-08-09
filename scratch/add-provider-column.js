/**
 * Añade la columna `provider` a KnowledgeChunk e Interaction.
 *
 * SQL directo en lugar de `prisma db push` porque KnowledgeChunk tiene una
 * columna `vector(3072)` que Prisma trata como Unsupported, y un diff
 * automático sobre una base con datos podría intentar alterarla.
 *
 * Idempotente. Uso: node scratch/add-provider-column.js
 */
require('dotenv').config();
const prisma = require('../src/services/db.service');

const STATEMENTS = [
  ['KnowledgeChunk.provider',
   `ALTER TABLE "KnowledgeChunk" ADD COLUMN IF NOT EXISTS "provider" TEXT`],

  ['Interaction.provider',
   `ALTER TABLE "Interaction" ADD COLUMN IF NOT EXISTS "provider" TEXT`],

  ['índice brandId+category+provider',
   `CREATE INDEX IF NOT EXISTS "KnowledgeChunk_brandId_category_provider_idx"
      ON "KnowledgeChunk" ("brandId", "category", "provider")`],
];

async function main() {
  console.log('\nAñadiendo columna provider...\n');

  for (const [label, sql] of STATEMENTS) {
    process.stdout.write(`  ${label} ... `);
    await prisma.$executeRawUnsafe(sql);
    console.log('ok');
  }

  const rows = await prisma.$queryRawUnsafe(`
    SELECT "provider", COUNT(*)::int AS n
    FROM "KnowledgeChunk" GROUP BY "provider" ORDER BY n DESC
  `);
  console.log('\nFragmentos por proveedor:');
  rows.forEach(r => console.log(`  ${(r.provider || '(genérico)').padEnd(14)} ${r.n}`));

  console.log('');
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('\nERROR:', err.message);
  process.exit(1);
});
