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
    // Horario tomado de la página de Ticket Restaurant: son los mismos números
    // de atención de Edenred, no una línea distinta por producto.
    content: 'Tarjeta de transporte de Edenred: atención al cliente y ayuda. Si tienes cualquier problema, incidencia o duda con la tarjeta, puedes llamar al 931 110 086 o al 919 100 757, de lunes a jueves de 9 a 18 horas y los viernes de 8 a 15 horas. El centro de ayuda de Edenred está en edenred.es/ayuda.',
  },

  // ── Edenred · Comida ──────────────────────────────────────────────────────
  // Fuente: edenred.es/ticket-restaurant/usuarios · redactado de nuevo
  {
    provider: 'edenred',
    category: 'comida',
    content: 'La tarjeta de comida de Edenred se llama Ticket Restaurant. Dónde se usa: se acepta en más de 50.000 establecimientos de hostelería adheridos en España, es decir restaurantes, bares y cafeterías. También sirve para pedir comida a domicilio en Just Eat, Glovo y Uber Eats. No se puede usar en supermercados ni para hacer la compra.',
  },
  {
    provider: 'edenred',
    category: 'comida',
    content: 'Tarjeta de comida de Edenred: cuándo se puede usar, horarios, fines de semana y cenas. Está pensada para la comida dentro de la jornada laboral, en la pausa establecida para comer, y se puede usar en cualquier momento de ese horario. El saldo se calcula por día trabajado. Cada empresa puede fijar restricciones adicionales sobre esa norma general, por ejemplo de horario o de días de la semana, así que si tienes dudas sobre si puedes usarla un día concreto conviene confirmarlo con tu empresa.',
  },
  {
    provider: 'edenred',
    category: 'comida',
    content: 'Tarjeta de comida de Edenred: activación y PIN. La primera vez se activa desde la aplicación MyEdenred o desde clientes.edenred.es. Hay que iniciar sesión, introducir el código de activación y el CVC2 que vienen con la tarjeta, y elegir un PIN. También se puede activar por teléfono llamando al 931 110 086 o al 919 100 757.',
  },
  {
    provider: 'edenred',
    category: 'comida',
    content: 'Tarjeta de comida de Edenred: aplicación y saldo. La aplicación se llama MyEdenred y está disponible para iOS y Android; también se puede entrar desde clientes.edenred.es. Desde ahí se consultan el saldo y los movimientos. La tarjeta se puede añadir a Google Pay, Apple Pay y Samsung Pay para pagar con el móvil.',
  },
  {
    provider: 'edenred',
    category: 'comida',
    content: 'Tarjeta de comida de Edenred: pérdida, robo y atención al cliente. Si pierdes la tarjeta o te la roban, puedes bloquearla tú mismo desde la aplicación MyEdenred o desde tu cuenta en clientes.edenred.es. También puedes llamar al 931 110 086 o al 919 100 757, de lunes a jueves de 9 a 18 horas y los viernes de 8 a 15 horas. El centro de ayuda está en edenred.es/ayuda.',
  },

  // ── Edenred · Guardería ───────────────────────────────────────────────────
  // Fuente: edenred.es/ticket-guarderia/usuarios · redactado de nuevo
  //
  // Guardería no funciona con tarjeta: el pago va al centro. Por eso aquí no
  // hay activación, PIN ni saldo, y en cambio importan la adhesión del centro y
  // los cambios de guardería.
  {
    provider: 'edenred',
    category: 'guarderia',
    content: 'Guardería con Edenred: cómo funciona el pago. No hay tarjeta física, la gestión es totalmente digital y el pago se hace directamente a la guardería. Hay dos modalidades: Direct, en la que gestionas tú el pago, y Direct Plus, en la que Edenred se encarga de que el pago llegue al centro de forma automática.',
  },
  {
    provider: 'edenred',
    category: 'guarderia',
    content: 'Guardería con Edenred: centros adheridos y qué hacer si el tuyo no lo está. Edenred tiene una red de guarderías asociadas y dispone de un buscador en su web para comprobar si un centro concreto está adherido. Si tu guardería todavía no forma parte de la red, puedes recomendarla a través del formulario de contacto de su web para que se pongan en contacto con ella.',
  },
  {
    provider: 'edenred',
    category: 'guarderia',
    content: 'Guardería con Edenred: cambios de centro y bajas. Si cambias de guardería, basta con avisar antes de la fecha prevista del siguiente pago. Si tu hijo o hija deja la guardería antes de que termine el curso no hay ningún problema, se puede gestionar sin inconveniente.',
  },
  {
    provider: 'edenred',
    category: 'guarderia',
    content: 'Guardería con Edenred: consultas y atención al cliente. La gestión y el seguimiento de los pagos se hacen desde la aplicación MyEdenred España, disponible para iOS y Android, o desde el área de clientes de su web. Para cualquier incidencia puedes llamar al 931 110 086 o al 919 100 757, de lunes a jueves de 9 a 18 horas y los viernes de 8 a 15 horas.',
  },

  // ── Pluxee · Comida ───────────────────────────────────────────────────────
  // Fuente: pluxee.es/tarjeta-restaurante · redactado de nuevo
  {
    provider: 'pluxee',
    category: 'comida',
    content: 'La tarjeta de comida de Pluxee se llama Tarjeta Restaurante Pluxee. Dónde se usa: en establecimientos de restauración de su red, es decir restaurantes y cafeterías, y también en las plataformas de comida a domicilio que forman parte de esa red. No se puede usar en supermercados: la exención fiscal del IRPF solo permite usarla en establecimientos de restauración.',
  },
  {
    provider: 'pluxee',
    category: 'comida',
    content: 'Tarjeta Restaurante Pluxee: activación y PIN. Cada empleado activa su tarjeta desde la aplicación de Pluxee. Durante ese proceso también puede enlazarla con Google Pay o Apple Pay. El PIN de la tarjeta se consulta desde la propia aplicación, o llamando al 900 800 777.',
  },
  {
    provider: 'pluxee',
    category: 'comida',
    content: 'Tarjeta Restaurante Pluxee: aplicación, saldo y pago con el móvil. La aplicación de Pluxee está disponible en Google Play y en la App Store, y desde ella se consultan el saldo y los movimientos de la tarjeta. La tarjeta es compatible con Google Pay y Apple Pay, así que se puede pagar directamente con el móvil.',
  },
  {
    provider: 'pluxee',
    category: 'comida',
    content: 'Tarjeta Restaurante Pluxee: atención al cliente y ayuda. Si tienes cualquier problema, incidencia o duda con la tarjeta, puedes llamar al teléfono de atención de Pluxee, el 900 800 777. Es el mismo número para consultar el PIN.',
  },

  // ── Pluxee · Guardería ────────────────────────────────────────────────────
  // Fuente: pluxee.es/cheque-guarderia · redactado de nuevo
  {
    provider: 'pluxee',
    category: 'guarderia',
    content: 'El producto de guardería de Pluxee se llama Cheque guardería Pluxee. Cómo funciona el pago: se emiten cheques virtuales que llegan por correo electrónico, y también pueden ir integrados en la tarjeta multibeneficio de Pluxee, ya sea física o virtual. Con esa tarjeta se puede pagar desde el móvil con Google Pay o Apple Pay.',
  },
  {
    provider: 'pluxee',
    category: 'guarderia',
    content: 'Cheque guardería Pluxee: centros adheridos y qué hacer si el tuyo no lo está. La guardería tiene que estar adherida previamente, y se puede comprobar en el buscador de establecimientos de Pluxee. Si tu centro no está afiliado, puedes ponerte en contacto con Pluxee y solicitar su afiliación de forma gratuita a través del formulario de su web.',
  },
  {
    provider: 'pluxee',
    category: 'guarderia',
    content: 'Cheque guardería Pluxee: cómo se solicita y cómo se consulta. La solicitud se tramita a través de tu empresa, que hace el pedido a Pluxee y te entrega los cheques. Desde la aplicación de Pluxee, disponible para iOS y Android, puedes consultar las transacciones, el saldo y el ahorro acumulado en tiempo real.',
  },

  // ── Pluxee · Transporte ───────────────────────────────────────────────────
  // Fuente: pluxee.es/tarjeta-transporte · redactado de nuevo
  {
    provider: 'pluxee',
    category: 'transporte',
    content: 'La tarjeta de transporte de Pluxee se llama Ticket Transporte de Pluxee. Dónde se usa: en metro, autobús, tranvía y tren de cercanías, y también en Renfe, Ouigo e Iryo, incluidas sus páginas web. Además se puede usar en estancos, taquillas y máquinas expendedoras. Funciona en toda España.',
  },
  {
    provider: 'pluxee',
    category: 'transporte',
    content: 'Ticket Transporte de Pluxee: activación, recarga y saldo. La tarjeta se activa descargando la aplicación de Pluxee o llamando al 900 800 777. La recarga es automática, con la periodicidad que decida tu empresa. El saldo y los movimientos se consultan desde la aplicación o llamando a ese mismo número.',
  },
  {
    provider: 'pluxee',
    category: 'transporte',
    content: 'Ticket Transporte de Pluxee: pago con el móvil y caducidad. La aplicación de Pluxee está en App Store y Play Store, y la tarjeta es compatible con Google Pay y Apple Pay, así que se puede pagar directamente con el teléfono. La tarjeta caduca a los 48 meses desde su emisión.',
  },
  {
    provider: 'pluxee',
    category: 'transporte',
    content: 'Ticket Transporte de Pluxee: atención al cliente. Si tienes cualquier problema, incidencia o duda con la tarjeta de transporte, el teléfono de atención de Pluxee es el 900 800 777. Ese mismo número sirve para activar la tarjeta y para consultar el saldo.',
  },

  // ── Up Spain · Comida ─────────────────────────────────────────────────────
  // Fuente: up-spain.com/cheque-gourmet · redactado de nuevo
  {
    provider: 'up_spain',
    category: 'comida',
    content: 'La tarjeta de comida de Up Spain se llama Cheque Gourmet. Puede ser una tarjeta contactless física o virtual, para llevarla en el móvil. Dónde se usa: en más de 45.000 establecimientos asociados en España, entre restaurantes, bares, take away, vending y plataformas de comida a domicilio. En la práctica sirve en cualquier establecimiento de restauración que acepte Mastercard.',
  },
  {
    provider: 'up_spain',
    category: 'comida',
    content: 'Cheque Gourmet de Up Spain: aplicación y saldo. La gestión se hace desde UpONE, que es la plataforma digital de Up Spain. Su aplicación está disponible en App Store y en Google Play, y desde ella se consultan el saldo y los movimientos de la tarjeta.',
  },

  // ── Up Spain · Transporte ─────────────────────────────────────────────────
  // Fuente: up-spain.com/cheque-transporte · redactado de nuevo
  {
    provider: 'up_spain',
    category: 'transporte',
    content: 'El producto de transporte de Up Spain se llama Up transporte. Dónde se usa: en autobús, tren, metro, tranvía, AVE o cualquier otro medio de transporte público colectivo, en toda España. Sirve tanto para billetes sueltos como para bonos.',
  },
  {
    provider: 'up_spain',
    category: 'transporte',
    content: 'Up transporte: formato y forma de pago. Puede llevarse como tarjeta física contactless o directamente en el móvil, y es compatible con los principales servicios de pago por móvil. Up Spain dispone además de una aplicación propia de Up transporte para gestionarla.',
  },
  {
    provider: 'up_spain',
    category: 'transporte',
    content: 'Up transporte: cómo se reparte el importe. El máximo exento son 136,36 € al mes durante un máximo de once mensualidades, lo que suma los 1.500 € anuales que permite la exención fiscal.',
  },

  // ── Up Spain · Guardería ──────────────────────────────────────────────────
  // Fuente: up-spain.com/cheque-guarderia · redactado de nuevo
  {
    provider: 'up_spain',
    category: 'guarderia',
    content: 'El producto de guardería de Up Spain se llama Up educainfantil, también conocido como cheque guardería. Funciona con cheques virtuales, sin ningún cheque físico circulando: Up Spain hace una transferencia bancaria directa a la escuela infantil.',
  },
  {
    provider: 'up_spain',
    category: 'guarderia',
    content: 'Up educainfantil: cuándo se paga al centro y qué pasa si no cuadra el importe. Las transferencias a las escuelas infantiles se procesan el último día hábil de cada mes. Si hay diferencia entre el importe gestionado por Up Spain y la cuota real de la guardería, el empleado abona esa diferencia al centro por sus medios habituales.',
  },
  {
    provider: 'up_spain',
    category: 'guarderia',
    content: 'Up educainfantil: centros adheridos y cambios. Up Spain tiene una red de más de 16.500 escuelas infantiles adheridas en toda España, y dispone de un buscador en su web para localizar las afiliadas. El centro debe estar adherido previamente. Se puede cambiar de guardería sin salir del sistema, y conviene comunicar el cambio tanto a la empresa como al centro.',
  },
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
