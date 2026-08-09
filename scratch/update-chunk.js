/**
 * Actualiza o inserta un chunk de conocimiento por brandId + categoria.
 * Uso: node scratch/update-chunk.js
 */
require('dotenv').config();
const crypto = require('crypto');
const vectorService = require('../src/services/vector.service');
const prisma = require('../src/services/db.service');

const BRAND_ID = 'snfplus_usuario';

const UPDATES = [
  {
    category: 'transporte',
    content: 'Tarjeta Transporte: El límite mensual es de 136,36 €, sin superar los 1.500 € anuales. Al igual que la de comida, requiere solicitar la tarjeta física la primera vez, activarla en el móvil y se recarga el día uno de cada mes. Esta ventaja fiscal no se aplica en los territorios forales del País Vasco, es decir en Álava, Vizcaya y Guipúzcoa.',
  },
];

async function main() {
  console.log(`\nActualizando ${UPDATES.length} chunk(s) para brandId="${BRAND_ID}"\n`);

  for (const update of UPDATES) {
    process.stdout.write(`  [${update.category}] generando embedding... `);

    const embedding = await vectorService.generateEmbedding(update.content);
    const vectorString = `[${embedding.join(',')}]`;

    // Borra solo el fragmento genérico de esa categoría.
    // El filtro por "provider" IS NULL es imprescindible: sin él, actualizar el
    // texto genérico de transporte se llevaría por delante las FAQs de Edenred,
    // Pluxee y compañía, que comparten categoría.
    const deleted = await prisma.$executeRawUnsafe(
      `DELETE FROM "KnowledgeChunk"
        WHERE "brandId" = $1 AND "category" = $2 AND "provider" IS NULL`,
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
