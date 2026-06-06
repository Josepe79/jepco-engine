/**
 * Script de carga del manual SNF Plus categorizado.
 * Ejecutar desde la raíz del proyecto: node scratch/load-snfplus-manual.js
 */
require('dotenv').config();
const crypto = require('crypto');
const vectorService = require('../src/services/vector.service');
const prisma = require('../src/services/db.service');

const BRAND_ID = 'snfplus';

const CHUNKS = [
  {
    category: 'acceso_navegacion',
    content: 'Para acceder a la aplicación SNF+ (Sistema de Nómina Flexible), el empleado debe introducir su correo electrónico y contraseña, y aceptar la política de privacidad. La plataforma se divide en un menú principal, una zona de contenido dinámico y una barra de estado que incluye el simulador general y opciones de ayuda.'
  },
  {
    category: 'perfil',
    content: 'En la sección "Mi perfil" el usuario puede consultar, editar y actualizar su información personal, datos de contacto y dirección.'
  },
  {
    category: 'familiares',
    content: 'El sistema permite dar de alta a familiares (cónyuge o hijos), un paso que es estrictamente necesario y obligatorio antes de poder contratar los productos de guardería o el seguro de salud.'
  },
  {
    category: 'productos_general',
    content: 'El catálogo de servicios muestra los productos disponibles. Cada uno cuenta con un documento PDF informativo que se debe leer previamente y un simulador. En el simulador, el empleado puede ver su situación actual, hacer estimaciones de ahorro, guardar la simulación o proceder directamente a la contratación.'
  },
  {
    category: 'ahorro',
    content: 'Ahorro: Permite aportar desde un mínimo de 40 € al mes hasta un máximo de 100.000 € al año. Para formalizarlo, es imprescindible descargar, rellenar, firmar y subir un formulario de adhesión antes de pulsar el botón de contratar.'
  },
  {
    category: 'salud',
    content: 'Seguro de Salud: Es un contrato de póliza con duración de 12 meses. Requiere haber registrado a los familiares en el menú correspondiente y disponer de una copia del DNI.'
  },
  {
    category: 'guarderia',
    content: 'Guardería: Exige tener al hijo/a dado de alta en el sistema previamente. Para tramitarlo, se debe obtener e introducir el código digital específico de la guardería a través de un enlace habilitado en el simulador.'
  },
  {
    category: 'comida',
    content: 'Tarjeta Comida: Permite destinar hasta 11 € diarios con un máximo de 20 días al mes. Si es la primera vez que se usa, el empleado debe solicitar la Tarjeta Cheque Gourmet, la cual se activa vía móvil y se recarga el día uno de cada mes.'
  },
  {
    category: 'transporte',
    content: 'Tarjeta Transporte: El límite mensual es de 136,36 €, sin superar los 1.500 € anuales. Al igual que la de comida, requiere solicitar la tarjeta física la primera vez, activarla en el móvil y se recarga el día uno de cada mes.'
  },
  {
    category: 'formacion',
    content: 'Formación: Para contratar este beneficio, se debe adjuntar la factura del curso a nombre de la empresa. La solicitud no es automática y queda sujeta a la aprobación de la empresa.'
  },
  {
    category: 'renting',
    content: 'Renting: Se debe ingresar información detallada del vehículo (marca, modelo, coste, tipo de motorización para el cálculo de exenciones) y adjuntar el presupuesto. El uso estipulado es del 100% y la contratación requiere la aprobación previa de la empresa.'
  },
  {
    category: 'contrato_novacion',
    content: 'Contrato de Novación: Es el documento legal y único que formaliza el acuerdo de retribución flexible entre el empleado y la empresa para todos los productos. Debe firmarse obligatoriamente para poder llevar a cabo cualquier contratación, pudiendo hacerse de antemano o en el momento de adquirir el primer producto.'
  }
];

async function ensureTableExists() {
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "KnowledgeChunk" (
        "id"        TEXT NOT NULL PRIMARY KEY,
        "brandId"   TEXT NOT NULL,
        "content"   TEXT NOT NULL,
        "embedding" vector(3072),
        "metadata"  JSONB,
        "category"  TEXT,
        "createdAt" TIMESTAMP DEFAULT NOW()
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "KnowledgeChunk_brandId_idx" ON "KnowledgeChunk"("brandId")
    `);
    console.log('✓ Tabla KnowledgeChunk verificada');
  } catch (err) {
    // La extensión vector debe estar habilitada en Railway antes de correr esto
    if (err.message.includes('type "vector" does not exist')) {
      console.error('ERROR: La extensión pgvector no está habilitada en la base de datos.');
      console.error('Ejecuta en Railway PostgreSQL: CREATE EXTENSION vector;');
      process.exit(1);
    }
    if (!err.message.includes('already exists')) throw err;
  }
}

async function chunkExists(category) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id FROM "KnowledgeChunk" WHERE "brandId" = $1 AND "category" = $2 LIMIT 1`,
    BRAND_ID, category
  );
  return rows.length > 0;
}

async function main() {
  console.log(`\nCargando manual SNF Plus — ${CHUNKS.length} fragmentos\n`);

  await ensureTableExists();

  let inserted = 0;
  let skipped = 0;

  for (const chunk of CHUNKS) {
    process.stdout.write(`  [${chunk.category}] ... `);

    // Evitar duplicados: si ya existe un chunk con esa categoría, lo saltamos
    if (await chunkExists(chunk.category)) {
      console.log('ya existe, omitido');
      skipped++;
      continue;
    }

    const embedding = await vectorService.generateEmbedding(chunk.content);
    const vectorString = `[${embedding.join(',')}]`;
    const id = crypto.randomUUID();
    const metadata = JSON.stringify({ source: 'snfplus-manual-app', timestamp: new Date() });

    await prisma.$executeRawUnsafe(
      `INSERT INTO "KnowledgeChunk" ("id", "brandId", "content", "embedding", "metadata", "category")
       VALUES ($1, $2, $3, $4::vector, $5, $6)`,
      id, BRAND_ID, chunk.content, vectorString, metadata, chunk.category
    );

    console.log('✓');
    inserted++;
  }

  console.log(`\nCompletado: ${inserted} insertados, ${skipped} omitidos.\n`);
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('\nERROR:', err.message);
  process.exit(1);
});
