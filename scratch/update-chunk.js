/**
 * Actualiza o inserta un chunk de conocimiento por brandId + categoria.
 * Uso: node scratch/update-chunk.js
 */
require('dotenv').config();
const crypto = require('crypto');
const vectorService = require('../src/services/vector.service');
const prisma = require('../src/services/db.service');

const BRAND_ID = 'snfplus';

const UPDATES = [
  {
    category: 'salud',
    content: 'Seguro de Salud: Es un contrato de póliza con duración de 12 meses. Requiere haber dado de alta a los familiares en el sistema previamente y disponer de una copia del DNI. El límite máximo de exención fiscal es de 500 € al año por persona (empleado, cónyuge e hijos de hasta 25 años incluidos). Si el empleado o algún familiar tiene reconocida una discapacidad, el límite sube a 1.500 € por persona. Para cualquier consulta sobre coberturas, condiciones o exclusiones de la póliza, hay que contactar directamente con el mediador.',
  },
];

async function main() {
  console.log(`\nActualizando ${UPDATES.length} chunk(s) para brandId="${BRAND_ID}"\n`);

  for (const update of UPDATES) {
    process.stdout.write(`  [${update.category}] generando embedding... `);

    const embedding = await vectorService.generateEmbedding(update.content);
    const vectorString = `[${embedding.join(',')}]`;

    // Borrar el chunk existente de esa categoría
    const deleted = await prisma.$executeRawUnsafe(
      `DELETE FROM "KnowledgeChunk" WHERE "brandId" = $1 AND "category" = $2`,
      BRAND_ID, update.category
    );

    // Insertar el nuevo
    const id = crypto.randomUUID();
    const metadata = JSON.stringify({ source: 'snfplus-manual-app', timestamp: new Date() });
    await prisma.$executeRawUnsafe(
      `INSERT INTO "KnowledgeChunk" ("id", "brandId", "content", "embedding", "metadata", "category")
       VALUES ($1, $2, $3, $4::vector, $5, $6)`,
      id, BRAND_ID, update.content, vectorString, metadata, update.category
    );

    console.log(`✓ (eliminados ${deleted}, insertado nuevo)`);
  }

  console.log('\nListo.\n');
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('\nERROR:', err.message);
  process.exit(1);
});
