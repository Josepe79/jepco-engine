/**
 * Carga las FAQs operativas de un proveedor de tarjeta.
 *
 * Estos fragmentos llevan `provider`, así que solo se recuperan para usuarios de
 * ese emisor. La parte fiscal (límites, requisitos) va aparte, con
 * `provider = NULL`, y se comparte entre todos: no se duplica aquí.
 *
 * Al añadir un proveedor nuevo, basta con ampliar CHUNKS. El id debe coincidir
 * con ALLOWED_PROVIDERS en src/index.js y con PROVIDERS en el widget.
 *
 * Uso:
 *   node scratch/load-provider-faq.js              carga todo
 *   node scratch/load-provider-faq.js edenred      solo un proveedor
 */
require('dotenv').config();
const crypto = require('crypto');
const vectorService = require('../src/services/vector.service');
const prisma = require('../src/services/db.service');

const BRAND_ID = 'snfplus_usuario';

const CHUNKS = [
  // ── Edenred · Transporte ──────────────────────────────────────────────────
  // Fuente: edenred.es/ticket-transporte/usuarios · redactado de nuevo
  {
    provider: 'edenred',
    category: 'transporte',
    content: 'Tarjeta de transporte de Edenred: dónde se usa. Sirve para metro, autobús, tranvía, cercanías y trenes de media distancia. Funciona en cualquier punto de venta que acepte Mastercard, ya sea taquilla, máquina expendedora o plataforma digital, y no tiene limitaciones geográficas dentro de España. Es compatible con los descuentos habituales como el abono joven, el de familia numerosa y otras tarifas reducidas.',
  },
  {
    provider: 'edenred',
    category: 'transporte',
    content: 'Tarjeta de transporte de Edenred: activación y PIN. La primera vez hay que activarla desde la aplicación MyEdenred o desde clientes.edenred.es, introduciendo el código de activación junto al CVC2 que figura en el dorso de la tarjeta. Durante ese proceso se elige el PIN. El PIN se puede recuperar o cambiar más adelante desde la aplicación o desde la web de clientes, en las tarjetas emitidas a partir de febrero de 2023.',
  },
  {
    provider: 'edenred',
    category: 'transporte',
    content: 'Tarjeta de transporte de Edenred: uso diario y saldo. La aplicación se llama MyEdenred y está disponible para iOS y Android. Desde ella se consultan el saldo y los movimientos de la tarjeta. La tarjeta se puede añadir a Apple Wallet y a Google Wallet para pagar con el móvil.',
  },
  {
    // Va en fragmento aparte a propósito: cuando el teléfono compartía sitio con
    // la app y el saldo, el modelo lo pasaba por alto la mitad de las veces
    // aunque lo tuviera delante. Un dato que se pregunta solo, se guarda solo.
    provider: 'edenred',
    category: 'transporte',
    content: 'Tarjeta de transporte de Edenred: atención al cliente y ayuda. Si tienes cualquier problema, incidencia o duda con la tarjeta, puedes llamar por teléfono al 931 110 086 o al 919 100 757. Estos son los números de atención al usuario de Edenred.',
  },

  // ── Pendiente ─────────────────────────────────────────────────────────────
  // pluxee / up_spain / up_one  ×  comida / guarderia / transporte
  // Añadir aquí según se recopilen sus FAQs.
];

async function main() {
  const filtro = process.argv[2] || null;
  const lote = filtro ? CHUNKS.filter(c => c.provider === filtro) : CHUNKS;

  if (lote.length === 0) {
    console.error(`\nNo hay fragmentos para "${filtro}".\n`);
    process.exit(1);
  }

  console.log(`\nCargando ${lote.length} fragmento(s) para brandId="${BRAND_ID}"\n`);

  // Se borra por proveedor+categoría, no fragmento a fragmento, para que al
  // recargar no queden restos de una versión anterior con más fragmentos.
  const grupos = [...new Set(lote.map(c => `${c.provider}|${c.category}`))];
  for (const g of grupos) {
    const [provider, category] = g.split('|');
    const n = await prisma.$executeRawUnsafe(
      `DELETE FROM "KnowledgeChunk"
        WHERE "brandId" = $1 AND "provider" = $2 AND "category" = $3`,
      BRAND_ID, provider, category
    );
    console.log(`  limpiando ${provider}/${category}: ${n} eliminados`);
  }

  console.log('');
  for (const chunk of lote) {
    process.stdout.write(`  [${chunk.provider}/${chunk.category}] embedding... `);

    const embedding = await vectorService.generateEmbedding(chunk.content);
    const vectorString = `[${embedding.join(',')}]`;

    await prisma.$executeRawUnsafe(
      `INSERT INTO "KnowledgeChunk"
         ("id", "brandId", "content", "embedding", "metadata", "category", "provider")
       VALUES ($1, $2, $3, $4::vector, $5, $6, $7)`,
      crypto.randomUUID(), BRAND_ID, chunk.content, vectorString,
      JSON.stringify({ source: `faq-${chunk.provider}`, timestamp: new Date() }),
      chunk.category, chunk.provider
    );

    console.log('ok');
  }

  const resumen = await prisma.$queryRawUnsafe(`
    SELECT "provider", "category", COUNT(*)::int AS n
    FROM "KnowledgeChunk" WHERE "brandId" = $1 AND "provider" IS NOT NULL
    GROUP BY "provider", "category" ORDER BY "provider", "category"
  `, BRAND_ID);

  console.log('\nFragmentos por proveedor en la base:');
  resumen.forEach(r => console.log(`  ${r.provider}/${r.category}: ${r.n}`));

  console.log('');
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('\nERROR:', err.message);
  process.exit(1);
});
