/**
 * Carga el manual de Gestor (snfplus_gestor) en la base de conocimiento.
 * Uso: node scratch/load-gestor-manual.js
 */
require('dotenv').config();
const crypto = require('crypto');
const vectorService = require('../src/services/vector.service');
const prisma = require('../src/services/db.service');

const BRAND_ID = 'snfplus_gestor';

const CHUNKS = [
  {
    category: 'onboarding_companias',
    content: 'Onboarding Compañías: Sección destinada al proceso de alta, configuración inicial y despliegue de nuevas empresas en la plataforma.',
  },
  {
    category: 'administrar_companias',
    content: 'Administrar Compañías: Área para gestionar, actualizar y editar los datos o la estructura de las empresas que ya están registradas en el sistema.',
  },
  {
    category: 'resumen_salud',
    content: 'Resumen Salud: Apartado enfocado en la consulta de informes, estadísticas y datos globales relacionados específicamente con el estado de los seguros de salud.',
  },
  {
    category: 'control_companias',
    content: 'Control Compañías: Módulo diseñado para la supervisión, seguimiento, auditoría y monitorización general de la actividad de las distintas compañías.',
  },
  {
    category: 'contrataciones',
    content: 'Contrataciones: Menú utilizado para gestionar, revisar y hacer un control de las solicitudes y altas de los diferentes productos y servicios de retribución flexible.',
  },
];

async function main() {
  console.log(`\nCargando ${CHUNKS.length} chunks para brandId="${BRAND_ID}"\n`);

  for (const chunk of CHUNKS) {
    process.stdout.write(`  [${chunk.category}] generando embedding... `);

    const embedding = await vectorService.generateEmbedding(chunk.content);
    const vectorString = `[${embedding.join(',')}]`;

    const deleted = await prisma.$executeRawUnsafe(
      `DELETE FROM "KnowledgeChunk" WHERE "brandId" = $1 AND "category" = $2`,
      BRAND_ID, chunk.category
    );

    const id = crypto.randomUUID();
    const metadata = JSON.stringify({ source: 'snfplus-gestor-manual', timestamp: new Date() });
    await prisma.$executeRawUnsafe(
      `INSERT INTO "KnowledgeChunk" ("id", "brandId", "content", "embedding", "metadata", "category")
       VALUES ($1, $2, $3, $4::vector, $5, $6)`,
      id, BRAND_ID, chunk.content, vectorString, metadata, chunk.category
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
