/**
 * Carga el manual de RRHH (snfplus_rrhh) en la base de conocimiento.
 * Uso: node scratch/load-rrhh-manual.js
 */
require('dotenv').config();
const crypto = require('crypto');
const vectorService = require('../src/services/vector.service');
const prisma = require('../src/services/db.service');

const BRAND_ID = 'snfplus_rrhh';

const CHUNKS = [
  {
    category: 'acceso_navegacion',
    content: 'Para acceder a la aplicación, el responsable de recursos humanos debe hacer login con un correo electrónico y una contraseña, teniendo que definirla si es su primera vez en la plataforma. La navegación está dividida en cuatro zonas: menú principal, contenidos dinámicos, barra de ayuda y aviso legal, y contacto con el soporte técnico.',
  },
  {
    category: 'administracion_empresas_sucursales',
    content: 'El sistema permite dar de alta, editar los datos y eliminar tanto empresas como las sucursales vinculadas a las mismas. En esta sección también se gestionan los códigos de proveedor y se define al representante de la empresa para la firma del contrato de novación.',
  },
  {
    category: 'administracion_grupos',
    content: 'Se pueden crear, editar o eliminar grupos de trabajadores definiendo su nombre, descripción y un límite de salario. También permite trasladar a los usuarios para cambiarles de grupo fácilmente.',
  },
  {
    category: 'importacion_y_actualizacion_masiva',
    content: 'La plataforma facilita la importación de usuarios en bloque descargando, rellenando y subiendo una plantilla en formato Excel. Del mismo modo, es posible realizar una actualización masiva de la base de datos descargando un Excel para modificar exclusivamente la retribución anual, el salario cotizable o la sucursal de los empleados.',
  },
  {
    category: 'gestion_usuarios',
    content: 'A nivel individual, se puede añadir a un nuevo trabajador rellenando manualmente sus datos personales, dirección, datos de empresa (como el grupo asignado) y datos económicos. Desde este menú, RRHH también puede restablecer la contraseña de un usuario, buscar a cualquier empleado introduciendo su DNI y tramitar bajas de trabajadores de forma permanente, conservando solo el historial de los productos contratados previamente.',
  },
  {
    category: 'seguimiento_planes',
    content: 'En esta área se hace el seguimiento de los productos solicitados y contratados, pudiendo identificar fácilmente qué planes están pendientes de aprobación. Al entrar en el perfil de un empleado específico, se visualiza su situación actual frente a su salario con Retribución Flexible, se pueden modificar los estados de aprobación y se comprueba si el contrato de novación está firmado correctamente.',
  },
  {
    category: 'informes',
    content: 'Permite generar y descargar informes de nómina en formato Excel en base a los datos cargados. Se pueden seleccionar meses y años concretos, y el informe puede extraerse buscando los datos de un único trabajador o listando a todos los empleados de la empresa a la vez.',
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
    const metadata = JSON.stringify({ source: 'snfplus-rrhh-manual', timestamp: new Date() });
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
