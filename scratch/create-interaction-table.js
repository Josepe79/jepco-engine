/**
 * Crea la tabla "Interaction" (telemetría de intercambios).
 *
 * Se hace con SQL directo en lugar de `prisma db push` porque KnowledgeChunk
 * usa una columna `vector(3072)` que Prisma trata como `Unsupported`. Un diff
 * automático sobre una base con datos reales podría intentar alterarla.
 *
 * Es idempotente: se puede ejecutar las veces que haga falta.
 *
 * Uso: node scratch/create-interaction-table.js
 */
require('dotenv').config();
const prisma = require('../src/services/db.service');

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "Interaction" (
     "id"               TEXT PRIMARY KEY,
     "brandId"          TEXT NOT NULL,
     "conversationId"   TEXT,
     "question"         TEXT NOT NULL,
     "answer"           TEXT NOT NULL,
     "category"         TEXT,
     "categoryFallback" BOOLEAN NOT NULL DEFAULT false,
     "chunksFound"      INTEGER NOT NULL DEFAULT 0,
     "topSimilarity"    DOUBLE PRECISION,
     "chunkIds"         JSONB,
     "escalated"        BOOLEAN NOT NULL DEFAULT false,
     "latencyMs"        INTEGER,
     "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,

  `CREATE INDEX IF NOT EXISTS "Interaction_brandId_createdAt_idx"
     ON "Interaction" ("brandId", "createdAt")`,

  `CREATE INDEX IF NOT EXISTS "Interaction_brandId_escalated_idx"
     ON "Interaction" ("brandId", "escalated")`,

  `CREATE INDEX IF NOT EXISTS "Interaction_brandId_category_idx"
     ON "Interaction" ("brandId", "category")`,

  `CREATE INDEX IF NOT EXISTS "Interaction_conversationId_createdAt_idx"
     ON "Interaction" ("conversationId", "createdAt")`,
];

async function main() {
  console.log('\nCreando tabla Interaction...\n');

  for (const sql of STATEMENTS) {
    const label = sql.trim().split('\n')[0].replace(/CREATE (TABLE|INDEX) IF NOT EXISTS /, '').trim();
    process.stdout.write(`  ${label} ... `);
    await prisma.$executeRawUnsafe(sql);
    console.log('ok');
  }

  const [{ count }] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS count FROM "Interaction"`
  );
  console.log(`\nListo. Filas actuales: ${count}\n`);

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('\nERROR:', err.message);
  process.exit(1);
});
