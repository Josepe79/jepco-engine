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
  {
    // La edad la aporta la web de Pluxee, pero no es un dato suyo: el primer
    // ciclo de Educación Infantil es la definición legal que da derecho a la
    // exención. Va en el fragmento genérico para que también la tengan los
    // usuarios de Edenred, cuya web no la menciona.
    category: 'guarderia',
    content: 'Guardería: La ventaja fiscal cubre el primer ciclo de Educación Infantil, es decir niños de 0 a 3 años. Exige tener al hijo o hija dado de alta en el sistema previamente, y el centro debe estar adherido al proveedor. Para tramitarlo se debe obtener e introducir el código digital específico de la guardería a través del enlace habilitado en el simulador.',
  },
  {
    // Se quitó "Tarjeta Cheque Gourmet" del texto: es la marca de Pluxee, y este
    // fragmento lo lee todo el mundo. A un empleado con tarjeta Edenred se le
    // estaba diciendo que solicitara la de otro proveedor. El nombre comercial
    // de cada tarjeta va en el fragmento de su emisor.
    category: 'comida',
    content: 'Tarjeta Comida: Permite destinar hasta 11 € por día trabajado, con un máximo de 20 días al mes. Si es la primera vez, el empleado debe solicitar la tarjeta física a través de la aplicación, activarla desde el móvil y se recarga el día uno de cada mes. El importe concreto lo decide cada empresa dentro de ese máximo legal.',
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
