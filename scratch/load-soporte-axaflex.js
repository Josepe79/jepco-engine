/**
 * Conocimiento extraído del buzón de soporte de AXA Flex (axaflex@).
 *
 * Origen: revisión de un año de consultas reales, agrupadas por repetición y
 * validadas una a una por el equipo de soporte. Septiembre de 2026.
 *
 * Uso:
 *   node scratch/load-soporte-axaflex.js
 *
 * Es RELANZABLE. Todo lo que inserta queda marcado en `metadata.source` con la
 * constante MARCA, y el guion empieza borrando lo que lleve esa marca. Volver a
 * ejecutarlo deja la base igual, no duplica.
 *
 * Por qué no se usó `update-chunk.js`:
 *   - Aquel borra la categoría entera antes de insertar. Aquí casi todo son
 *     altas sobre categorías que ya tienen contenido bueno (las FAQ por emisor,
 *     los manuales), y ese borrado se las llevaría por delante.
 *   - Aquel solo sabe de `provider IS NULL` y de un único brandId. Aquí hay
 *     fragmentos de Up Spain y fragmentos de RRHH.
 *
 * Sobre los textos "que amplían" un fragmento existente: se han creado como
 * fragmentos NUEVOS al lado, no añadidos al original. Dos razones: el original
 * no se toca, así que no hay nada que perder si esto se relanza; y cada texto
 * responde a una pregunta distinta, así que separados se recuperan mejor que
 * fundidos en un fragmento largo — un fragmento que crece acaba diluyendo el
 * contexto, que ya nos ha pasado.
 */
require('dotenv').config();
const crypto = require('crypto');
const vectorService = require('../src/services/vector.service');
const prisma = require('../src/services/db.service');

const MARCA = 'buzon-axaflex-2026-09';

// Fragmentos que este guion sustituye. Se borran por id la primera vez; en
// ejecuciones posteriores ya no están y el borrado no hace nada.
const SUSTITUIDOS = [
  // Decía que Up Spain paga a la guardería el último día hábil del mes.
  // Soporte confirma que paga el día 1.
  '05426a5f',
];

const U = 'snfplus_usuario';
const R = 'snfplus_rrhh';

const ENTRADAS = [

  // ── A. Corrección ────────────────────────────────────────────────────────

  { brand: U, cat: 'guarderia', prov: 'up_spain', content:
    `Up educainfantil: cuándo se paga al centro y qué pasa si no cuadra el importe. Up Spain paga a la guardería el día 1 de cada mes, salvo si cae en fin de semana, siempre que la empresa haya pagado antes la factura. Para que la guardería cobre el día 1, el importe de ese mes tiene que estar solicitado antes del día de corte. Up Spain paga el importe que tú solicitas, no la cuota real del centro: si hay diferencia, la ajustas con la guardería por tus medios habituales.` },

  // ── B. Amplían un tema que ya existe ─────────────────────────────────────

  { brand: U, cat: 'contrato_novacion', prov: null, content:
    `El contrato de novación se firma para cada año. Cuando empieza el año nuevo, entra en la sección Contrato de novación de la aplicación y firma el del año en curso. Si ya aparece como firmado, no tienes que hacer nada más. Firmar la novación no contrata ningún producto: después tienes que contratar cada uno.` },

  // El mismo texto en las dos categorías: la búsqueda va acotada por categoría,
  // así que sin las dos copias solo respondería una de ellas.
  { brand: U, cat: 'comida', prov: null, content:
    `Correo de activación de la tarjeta de comida o transporte: al solicitarla no recibirás nada en el momento. SNF+ hace el pedido al emisor el día siguiente al día de corte, y es entonces cuando el emisor (Pluxee, Up Spain o Edenred) te envía el correo para registrarte y activar la tarjeta. Si después de esa fecha no te ha llegado, comprueba primero que el producto aparece en 'Productos contratados' y revisa la carpeta de spam.` },
  { brand: U, cat: 'transporte', prov: null, content:
    `Correo de activación de la tarjeta de comida o transporte: al solicitarla no recibirás nada en el momento. SNF+ hace el pedido al emisor el día siguiente al día de corte, y es entonces cuando el emisor (Pluxee, Up Spain o Edenred) te envía el correo para registrarte y activar la tarjeta. Si después de esa fecha no te ha llegado, comprueba primero que el producto aparece en 'Productos contratados' y revisa la carpeta de spam.` },

  { brand: R, cat: 'gestion_usuarios', prov: null, content:
    `Al dar de baja a un trabajador, en el campo 'Fecha de baja' indica su último día trabajado.` },

  // ── C. Nuevos, empleado ──────────────────────────────────────────────────

  { brand: U, cat: 'acceso_navegacion', prov: null, content:
    `Si no puedes entrar en la aplicación: 1) Tu usuario es tu correo electrónico, no tu DNI. Escríbelo entero en minúsculas. 2) Si no recuerdas la contraseña, pide el cambio desde la pantalla de acceso: te llegará un enlace al correo registrado (revisa también la carpeta de spam). 3) La nueva contraseña debe incluir al menos uno de estos caracteres especiales: ! @ # $ % ^ * ( ) _ - + = { } [ ] ; : , . < > ? 4) Si aun así no puedes entrar o no te llega el correo, puede que tu cuenta esté bloqueada: contacta con el equipo de RRHH de tu empresa o con el soporte de SNF+ para que la desbloqueen.` },

  { brand: U, cat: 'acceso_navegacion', prov: null, content:
    `Si al entrar o al pedir una nueva contraseña te dice que no existe ninguna cuenta con tu correo, es que todavía no estás dado de alta en la plataforma o te dieron de alta con otro correo. El alta la hace tu empresa: pide al equipo de RRHH que te den de alta o que comprueben qué correo tienen registrado. Cuando estés dado de alta, pide la contraseña desde la pantalla de acceso.` },

  { brand: U, cat: 'acceso_navegacion', prov: null, content:
    `Las aplicaciones de los emisores de tarjeta (Pluxee, UpONE de Up Spain y MyEdenred) son independientes de SNF+: tu contraseña de SNF+ no sirve para entrar en ellas y tienes que registrarte en la aplicación del emisor. Regístrate con el mismo correo con el que entras en SNF+. El emisor te envía un correo para hacerlo cuando se tramita tu tarjeta.` },

  { brand: U, cat: 'productos_general', prov: null, content:
    `Un producto solo está solicitado cuando aparece en el apartado 'Productos contratados'. Si lo ves en 'Productos en curso' o como simulado, la contratación no se ha completado y no se tramitará, aunque hayas firmado el contrato de novación. Para completarla: 1) entra en el producto; 2) pulsa Calcular; 3) pulsa Guardar simulación; 4) pulsa Contratar; 5) pulsa Confirmar. El seguro de salud es distinto: después de confirmar aparece como 'Solicitado' dentro de 'Productos en curso' hasta que la aseguradora lo aprueba. En el apartado Ayuda tienes vídeos que muestran el proceso.` },

  { brand: U, cat: 'productos_general', prov: null, content:
    `Simular no te compromete a nada: puedes simular, borrar la simulación y volver a simular las veces que quieras. Pero mientras un producto esté solo simulado no se tramita: no se paga nada y sus importes se quedan a 0. Si pasa el día de corte de un mes con el producto solo simulado, ese mes se pierde.` },

  { brand: U, cat: 'productos_general', prov: null, content:
    `Para cambiar el importe de un producto que ya tienes contratado: entra en el producto, cambia el importe de los meses que quieras, pulsa Calcular y después Guardar simulación. Para dejar de usarlo, pon a 0 los meses siguientes. Los meses cuyo día de corte ya ha pasado no se pueden cambiar.` },

  { brand: U, cat: 'guarderia', prov: null, content:
    `Pago a la guardería: el emisor paga a la guardería cuando tu empresa le ha pagado la factura del mes; si tu empresa se retrasa en ese pago, también se retrasa el pago a la guardería. Los meses siguientes se pagan de forma automática mientras el producto siga contratado. Si tu guardería no ha cobrado un mes, comprueba primero que el producto aparece en 'Productos contratados'; si está bien, consúltalo con el equipo de RRHH de tu empresa.` },

  { brand: U, cat: 'guarderia', prov: 'up_spain', content:
    `Up educainfantil: justificantes para la renta. Up Spain envía cada mes por correo electrónico el comprobante del pago a la guardería. Guárdalos: te servirán para la declaración de la renta.` },

  { brand: U, cat: 'transporte', prov: 'up_spain', content:
    `Tarjetas de Up Spain: confirmación de compras online. Cuando pagas online con la tarjeta de Up Spain, por seguridad UpONE te envía una notificación para confirmar que eres tú. Abre la aplicación UpONE y confirma la compra con el código o con la huella o la cara. Es obligatorio y no se puede desactivar.` },
  { brand: U, cat: 'comida', prov: 'up_spain', content:
    `Tarjetas de Up Spain: confirmación de compras online. Cuando pagas online con la tarjeta de Up Spain, por seguridad UpONE te envía una notificación para confirmar que eres tú. Abre la aplicación UpONE y confirma la compra con el código o con la huella o la cara. Es obligatorio y no se puede desactivar.` },

  { brand: U, cat: 'comida', prov: 'up_spain', content:
    `Tarjetas de Up Spain: pérdida y duplicado. Si pierdes la tarjeta de Up Spain (Cheque Gourmet o Up transporte), puedes pedir un duplicado tú mismo a Up Spain o pedírselo al soporte de SNF+. Up Spain lo envía a tu empresa, no a tu domicilio. El saldo no se pierde: pasa a la tarjeta nueva.` },
  { brand: U, cat: 'transporte', prov: 'up_spain', content:
    `Tarjetas de Up Spain: pérdida y duplicado. Si pierdes la tarjeta de Up Spain (Cheque Gourmet o Up transporte), puedes pedir un duplicado tú mismo a Up Spain o pedírselo al soporte de SNF+. Up Spain lo envía a tu empresa, no a tu domicilio. El saldo no se pierde: pasa a la tarjeta nueva.` },

  { brand: U, cat: 'comida', prov: null, content:
    `Vuelta a la empresa tras una baja: tu tarjeta de comida o transporte anterior sigue activa, sea del emisor que sea. Solo tienes que volver a indicar importes en el producto y se recargará. Si ya no la tienes, puedes pedir una nueva.` },
  { brand: U, cat: 'transporte', prov: null, content:
    `Vuelta a la empresa tras una baja: tu tarjeta de comida o transporte anterior sigue activa, sea del emisor que sea. Solo tienes que volver a indicar importes en el producto y se recargará. Si ya no la tienes, puedes pedir una nueva.` },

  { brand: U, cat: 'salud', prov: null, content:
    `No puedes contratar un seguro de salud solo para un familiar: los familiares tienen que ir incluidos en el mismo producto que tiene contratado el titular.` },

  { brand: U, cat: 'familiares', prov: null, content:
    `Si tu hijo o hija aún no tiene DNI, escribe MENOR en el campo del DNI al darlo de alta. Si has puesto mal el DNI de un familiar, puedes corregirlo tú en el apartado Familiares, editando sus datos.` },

  { brand: U, cat: 'salud', prov: null, content:
    `Si tú o un familiar tenéis reconocida una discapacidad, indícalo en el apartado de fiscalidad de la aplicación. El cambio se aplica desde el momento en que lo indicas; si quieres que se aplique con efecto retroactivo, pídelo al equipo de RRHH de tu empresa.` },

  // ── C. Nuevos, RRHH ──────────────────────────────────────────────────────

  { brand: R, cat: 'gestion_usuarios', prov: null, content:
    `Las altas y bajas de trabajadores y de familiares tienen que hacerse dentro de la plataforma: si se gestionan por fuera, no llegan al informe de nómina. Los familiares los da de alta el propio empleado desde su aplicación. Si necesitáis que un alta o una baja sea efectiva en una fecha concreta, o ya se hizo por fuera, enviad los datos y la fecha a soporte para que lo carguen.` },

  { brand: R, cat: 'administracion_grupos', prov: null, content:
    `Si un empleado no ve productos disponibles, o le aparece como pagado por la empresa un producto que debería pagar él (o al revés), casi siempre es por el grupo al que está asignado: los productos disponibles y quién los paga dependen del grupo. Revisa su grupo en su ficha y, si hace falta, cámbialo desde Administración de grupos.` },

  { brand: R, cat: 'informes', prov: null, content:
    `En el informe de nómina, el seguro de salud se reparte entre EXENTO y ESPECIE. Está exento hasta 500 € al año por asegurado (titular, cónyuge e hijos menores de 25 años), o 1.500 € si tiene reconocida una discapacidad; lo que supera ese límite, y lo de los hijos de 25 años o más, va a ESPECIE. Por eso dos empleados con el mismo número de asegurados pueden tener importes distintos. Los productos configurados como paga en especie, y no como retribución flexible, no tienen esta exención.` },

  { brand: R, cat: 'gestion_usuarios', prov: null, content:
    `Si cambia el dominio del correo de vuestra empresa (por ejemplo, de .es a .com), los trabajadores no podrán entrar con el correo nuevo hasta que se actualice en la plataforma. Pedid a soporte el cambio de forma masiva; después, cada trabajador pide una nueva contraseña desde la pantalla de acceso.` },

  { brand: R, cat: 'gestion_usuarios', prov: null, content:
    `El campo de situación familiar del trabajador corresponde a la situación del modelo 145 del IRPF. La más habitual es la situación 3.` },
];

async function main() {
  console.log(`\nBuzón de soporte AXA Flex · ${ENTRADAS.length} fragmentos\n`);

  const antes = await prisma.$queryRawUnsafe('SELECT count(*)::int AS n FROM "KnowledgeChunk"');
  console.log(`  fragmentos en la base antes: ${antes[0].n}`);

  // 1. Limpieza de ejecuciones anteriores de este mismo guion.
  const previos = await prisma.$executeRawUnsafe(
    `DELETE FROM "KnowledgeChunk" WHERE "metadata"->>'source' = $1`, MARCA);
  console.log(`  de una ejecución anterior: ${previos} eliminados`);

  // 2. Fragmentos que este lote sustituye.
  for (const pref of SUSTITUIDOS) {
    const n = await prisma.$executeRawUnsafe(
      `DELETE FROM "KnowledgeChunk" WHERE "id"::text LIKE $1`, pref + '%');
    console.log(`  sustituido ${pref}: ${n} eliminados`);
  }

  console.log('');

  // 3. Alta.
  for (const e of ENTRADAS) {
    const etiqueta = `${e.brand.replace('snfplus_', '')}/${e.cat}${e.prov ? '/' + e.prov : ''}`;
    process.stdout.write(`  ${etiqueta.padEnd(42)} `);

    const embedding = await vectorService.generateEmbedding(e.content);
    const vectorString = `[${embedding.join(',')}]`;
    const metadata = JSON.stringify({ source: MARCA, timestamp: new Date() });

    await prisma.$executeRawUnsafe(
      `INSERT INTO "KnowledgeChunk" ("id", "brandId", "content", "embedding", "metadata", "category", "provider")
       VALUES ($1, $2, $3, $4::vector, $5, $6, $7)`,
      crypto.randomUUID(), e.brand, e.content, vectorString, metadata, e.cat, e.prov
    );
    console.log('ok');
  }

  const despues = await prisma.$queryRawUnsafe('SELECT count(*)::int AS n FROM "KnowledgeChunk"');
  console.log(`\n  fragmentos en la base después: ${despues[0].n}\n`);

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('\nERROR:', err.message);
  process.exit(1);
});
