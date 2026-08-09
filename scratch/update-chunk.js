/**
 * Actualiza o inserta un chunk de conocimiento por brandId + categoria.
 * Uso: node scratch/update-chunk.js
 */
require('dotenv').config();
const crypto = require('crypto');
const vectorService = require('../src/services/vector.service');
const prisma = require('../src/services/db.service');

const BRAND_ID = 'snfplus_usuario';

// Nota sobre las once mensualidades: es normativa general y aplica igual a
// comida, guardería y transporte, así que aparece en los tres fragmentos
// genéricos de abajo. Confirma además el "136,36 € durante once mensualidades"
// que traía la web de Up Spain — no era un dato suyo, era esta misma norma.
const UPDATES = [
  {
    category: 'transporte',
    content: 'Tarjeta Transporte: El límite mensual es de 136,36 €, sin superar los 1.500 € anuales. Como el resto de productos, solo se puede usar once meses al año: por defecto agosto está cerrado y no permite solicitar cantidad. Requiere solicitar la tarjeta física la primera vez, activarla en el móvil y se recarga el día uno de cada mes. Esta ventaja fiscal no se aplica en los territorios forales del País Vasco, es decir en Álava, Vizcaya y Guipúzcoa.',
  },
  {
    // La edad la aporta la web de Pluxee, pero no es un dato suyo: el primer
    // ciclo de Educación Infantil es la definición legal que da derecho a la
    // exención. Va en el fragmento genérico para que también la tengan los
    // usuarios de Edenred, cuya web no la menciona.
    category: 'guarderia',
    content: 'Guardería: La ventaja fiscal cubre el primer ciclo de Educación Infantil, es decir niños de 0 a 3 años. A diferencia de comida y transporte, la exención de guardería no tiene límite anual de importe, salvo en el País Vasco, donde el máximo son 1.000 € al año. Como el resto de productos, solo se puede usar once meses al año: por defecto agosto está cerrado y no permite solicitar cantidad, que es lo que ocurre en los meses sin escolarización. Exige tener al hijo o hija dado de alta en el sistema previamente, y el centro debe estar adherido al proveedor. Para tramitarlo se debe obtener e introducir el código digital específico de la guardería a través del enlace habilitado en el simulador.',
  },
  {
    // Dos correcciones sobre el texto original:
    //
    // 1. Se quitó "Tarjeta Cheque Gourmet". Es la marca de Up Spain, y este
    //    fragmento lo lee todo el mundo, así que a un empleado con tarjeta
    //    Edenred se le estaba diciendo que solicitara la de otro proveedor. El
    //    nombre comercial de cada tarjeta va en el fragmento de su emisor.
    //
    // 2. Se añadió la exclusión de supermercados. No es política de ningún
    //    emisor: la exención del IRPF solo ampara establecimientos de
    //    restauración. Al ser normativa va aquí, y así la responde también a
    //    usuarios de emisores cuya web no la menciona.
    category: 'comida',
    content: 'Tarjeta Comida: Permite destinar hasta 11 € por día trabajado, con un máximo de 20 días al mes. Solo se puede usar en establecimientos de restauración, porque la exención del IRPF no ampara la compra en supermercados ni alimentación para llevar a casa. Como el resto de productos, solo se puede usar once meses al año: por defecto agosto está cerrado y no permite solicitar cantidad. Si es la primera vez, el empleado debe solicitar la tarjeta física a través de la aplicación, activarla desde el móvil y se recarga el día uno de cada mes. El importe concreto lo decide cada empresa dentro de ese máximo legal.',
  },
  {
    // El saldo y la tarjeta son cosas distintas y conviene que el bot no las
    // confunda: la tarjeta de Pluxee caduca a los 48 meses, pero el saldo no
    // caduca nunca y sobrevive al cambio de tarjeta.
    category: 'comida',
    content: 'Saldo de la tarjeta de comida: el saldo no caduca. Lo que no gastes un mes se acumula para el siguiente, no se pierde. Si la tarjeta caduca, se pierde o se extravía, el saldo viaja automáticamente a la tarjeta nueva: caduca la tarjeta como soporte físico, nunca el dinero que tienes en ella.',
  },
];

async function main() {
  console.log(`\nActualizando ${UPDATES.length} chunk(s) para brandId="${BRAND_ID}"\n`);

  // Primero se borran todas las categorías afectadas, y solo después se
  // inserta. Hacerlo en el mismo bucle rompía el caso de dos fragmentos en una
  // misma categoría: el borrado de la segunda vuelta se llevaba por delante lo
  // insertado en la primera.
  const categorias = [...new Set(UPDATES.map(u => u.category))];
  for (const category of categorias) {
    // El filtro por "provider" IS NULL es imprescindible: sin él, actualizar el
    // texto genérico de transporte se llevaría por delante las FAQs de Edenred,
    // Pluxee y compañía, que comparten categoría.
    const deleted = await prisma.$executeRawUnsafe(
      `DELETE FROM "KnowledgeChunk"
        WHERE "brandId" = $1 AND "category" = $2 AND "provider" IS NULL`,
      BRAND_ID, category
    );
    console.log(`  limpiando ${category}: ${deleted} eliminados`);
  }

  console.log('');
  for (const update of UPDATES) {
    process.stdout.write(`  [${update.category}] generando embedding... `);

    const embedding = await vectorService.generateEmbedding(update.content);
    const vectorString = `[${embedding.join(',')}]`;

    const id = crypto.randomUUID();
    const metadata = JSON.stringify({ source: 'snfplus-manual-app', timestamp: new Date() });
    await prisma.$executeRawUnsafe(
      `INSERT INTO "KnowledgeChunk" ("id", "brandId", "content", "embedding", "metadata", "category")
       VALUES ($1, $2, $3, $4::vector, $5, $6)`,
      id, BRAND_ID, update.content, vectorString, metadata, update.category
    );

    console.log('ok');
  }

  console.log('\nListo.\n');
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('\nERROR:', err.message);
  process.exit(1);
});
