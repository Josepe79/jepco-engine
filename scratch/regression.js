/**
 * Suite de regresión del comportamiento del asistente.
 *
 * Existe porque afinar el prompt a ojo no funciona: cada retoque arreglaba unos
 * casos y aflojaba otros, y sin medir todo a la vez era imposible saber si un
 * cambio mejoraba o empeoraba el conjunto.
 *
 * Cada caso declara qué se espera:
 *   answer   debe responder con el dato
 *   escalate debe reconocer que no lo sabe
 *   contains la respuesta debe incluir estos textos (sin distinguir acentos)
 *   absent   la respuesta NO debe incluir estos textos (control de invenciones)
 *
 * Uso:
 *   node scratch/regression.js                  contra localhost:3999
 *   node scratch/regression.js --url https://…  contra otro entorno
 *   node scratch/regression.js --grep salud     solo los casos que coincidan
 */
require('dotenv').config();

const args   = process.argv.slice(2);
const argVal = (name, def) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};
const BASE = argVal('--url', 'http://127.0.0.1:3999').replace(/\/$/, '');
const GREP = argVal('--grep', null);

const MED = {
  mediador:      'Correduría Ejemplo S.L.',
  mediadorEmail: 'consultas@ejemplo.es',
  mediadorTel:   '+34 911 234 567',
};

const CASES = [
  // ── Retribución flexible ────────────────────────────────────────────────
  { id: 'rf-productos', brand: 'snfplus_usuario', cat: 'retribucion_general',
    q: '¿Qué productos entran en la retribución flexible?',
    expect: 'answer', contains: ['ahorro', 'comedor', 'salud'],
    absent: ['seguro de vida', 'alquiler de vivienda'] },

  // ── Salud: fiscalidad responde, coberturas derivan ──────────────────────
  { id: 'salud-limite', brand: 'snfplus_usuario', cat: 'salud', med: true,
    q: '¿Cuánto puedo destinar al seguro de salud al año?',
    expect: 'answer', contains: ['500'] },
  { id: 'salud-discapacidad', brand: 'snfplus_usuario', cat: 'salud', med: true,
    q: '¿Y si tengo una discapacidad reconocida?',
    expect: 'answer', contains: ['1.500'] },
  { id: 'salud-hijos', brand: 'snfplus_usuario', cat: 'salud', med: true,
    q: '¿Hasta qué edad puedo incluir a mis hijos?',
    expect: 'answer', contains: ['25'] },
  { id: 'salud-dentista', brand: 'snfplus_usuario', cat: 'salud', med: true,
    q: '¿El seguro de salud incluye dentista?',
    expect: 'escalate', contains: ['Correduría Ejemplo'] },
  { id: 'salud-cuadro', brand: 'snfplus_usuario', cat: 'salud', med: true,
    q: '¿Qué hospitales entran en el cuadro médico?',
    expect: 'escalate', contains: ['Correduría Ejemplo'] },
  { id: 'salud-mediador-datos', brand: 'snfplus_usuario', cat: 'salud', med: true,
    q: '¿Cuánto dura el contrato del seguro de salud?',
    expect: 'answer', contains: ['12 meses', '911 234 567'] },

  // ── Escalado: destino correcto según el tema ────────────────────────────
  { id: 'esc-rrhh', brand: 'snfplus_usuario', med: true,
    q: '¿Cuántos días de vacaciones me quedan este año?',
    expect: 'escalate', contains: ['recursos humanos'], absent: ['Correduría'] },
  { id: 'esc-gestor', brand: 'snfplus_gestor', med: true,
    q: '¿Cuánto cuesta añadir una sucursal extra?',
    expect: 'escalate', contains: ['soporte de SNF+'], absent: ['recursos humanos'] },

  // ── Transporte por emisor ───────────────────────────────────────────────
  { id: 'trans-edenred-donde', brand: 'snfplus_usuario', cat: 'transporte', prov: 'edenred',
    q: '¿Dónde puedo usar la tarjeta de transporte?',
    expect: 'answer', contains: ['metro', 'autobus'] },
  { id: 'trans-edenred-tel', brand: 'snfplus_usuario', cat: 'transporte', prov: 'edenred',
    q: '¿A qué teléfono llamo si tengo un problema con la tarjeta?',
    expect: 'answer', contains: ['931 110 086'] },
  { id: 'trans-generico-limite', brand: 'snfplus_usuario', cat: 'transporte',
    q: '¿Cuál es el límite mensual de la tarjeta de transporte?',
    expect: 'answer', contains: ['136,36'] },
  // Control de invención: sin emisor no sabemos dónde se usa la tarjeta
  { id: 'trans-sin-proveedor', brand: 'snfplus_usuario', cat: 'transporte',
    q: '¿Dónde puedo usar la tarjeta de transporte?',
    expect: 'escalate', absent: ['cualquier lugar', 'cualquier sitio', 'metro'] },
  { id: 'trans-pluxee-sin-faq', brand: 'snfplus_usuario', cat: 'transporte', prov: 'pluxee',
    q: '¿Dónde puedo usar la tarjeta de transporte?',
    expect: 'escalate', absent: ['cualquier lugar', 'cualquier sitio', 'metro'] },

  // ── Comida por emisor ───────────────────────────────────────────────────
  { id: 'com-edenred-nombre', brand: 'snfplus_usuario', cat: 'comida', prov: 'edenred',
    q: '¿Cómo se llama mi tarjeta de comida?',
    expect: 'answer', contains: ['ticket restaurant'] },
  { id: 'com-pluxee-nombre', brand: 'snfplus_usuario', cat: 'comida', prov: 'pluxee',
    q: '¿Cómo se llama mi tarjeta de comida?',
    expect: 'answer', contains: ['pluxee'], absent: ['ticket restaurant'] },
  { id: 'com-edenred-tel', brand: 'snfplus_usuario', cat: 'comida', prov: 'edenred',
    q: '¿A qué teléfono llamo si tengo una incidencia?',
    expect: 'answer', contains: ['931 110 086'], absent: ['900 800 777'] },
  { id: 'com-pluxee-tel', brand: 'snfplus_usuario', cat: 'comida', prov: 'pluxee',
    q: '¿A qué teléfono llamo si tengo una incidencia?',
    expect: 'answer', contains: ['900 800 777'], absent: ['931 110 086'] },
  { id: 'com-supermercado', brand: 'snfplus_usuario', cat: 'comida', prov: 'edenred',
    q: '¿Puedo usarla para hacer la compra en el supermercado?',
    expect: 'answer', contains: ['no'] },
  { id: 'com-delivery', brand: 'snfplus_usuario', cat: 'comida', prov: 'edenred',
    q: '¿Puedo pedir en Glovo o Just Eat con la tarjeta?',
    expect: 'answer', contains: ['glovo'] },
  { id: 'com-perdida', brand: 'snfplus_usuario', cat: 'comida', prov: 'edenred',
    q: 'He perdido la tarjeta de comida, ¿qué hago?',
    expect: 'answer', contains: ['bloquear'] },
  { id: 'com-activacion-corta', brand: 'snfplus_usuario', cat: 'comida', prov: 'edenred',
    q: '¿Cómo activo la tarjeta?',
    expect: 'answer', contains: ['edenred'] },
  { id: 'com-activacion-larga', brand: 'snfplus_usuario', cat: 'comida', prov: 'edenred',
    q: '¿Cómo activo la tarjeta de comida?',
    expect: 'answer', contains: ['edenred'] },
  { id: 'com-limite-generico', brand: 'snfplus_usuario', cat: 'comida', prov: 'edenred',
    q: '¿Cuánto puedo gastar al día?',
    expect: 'answer', contains: ['11'] },
  // La marca de Pluxee no debe aparecer en contenido genérico
  { id: 'com-sin-marca-ajena', brand: 'snfplus_usuario', cat: 'comida', prov: 'edenred',
    q: '¿Qué necesito para empezar a usar la tarjeta de comida?',
    expect: 'answer', absent: ['cheque gourmet'] },

  // ── Guardería ───────────────────────────────────────────────────────────
  { id: 'gua-sin-tarjeta', brand: 'snfplus_usuario', cat: 'guarderia', prov: 'edenred',
    q: '¿Me dan una tarjeta para la guardería?',
    expect: 'answer', contains: ['no'] },
  { id: 'gua-no-adherida', brand: 'snfplus_usuario', cat: 'guarderia', prov: 'edenred',
    q: 'Mi guardería no está adherida, ¿qué puedo hacer?',
    expect: 'answer', contains: ['formulario'] },
  { id: 'gua-cambio', brand: 'snfplus_usuario', cat: 'guarderia', prov: 'edenred',
    q: 'Voy a cambiar a mi hija de guardería, ¿qué hago?',
    expect: 'answer', contains: ['avisar'] },
  // Huecos conocidos: su web no lo dice, no debe inventarlo
  { id: 'gua-hueco-edad', brand: 'snfplus_usuario', cat: 'guarderia', prov: 'edenred',
    q: '¿Hasta qué edad puedo usar el servicio de guardería?',
    expect: 'escalate', absent: ['3 años', 'tres años'] },
  { id: 'gua-hueco-verano', brand: 'snfplus_usuario', cat: 'guarderia', prov: 'edenred',
    q: '¿Qué pasa en julio y agosto si no hay guardería?',
    expect: 'escalate' },

  // ── RRHH y gestor ───────────────────────────────────────────────────────
  { id: 'rrhh-informes', brand: 'snfplus_rrhh', cat: 'informes',
    q: '¿Cómo genero informes de nómina?',
    expect: 'answer', contains: ['excel'] },
  { id: 'gestor-onboarding', brand: 'snfplus_gestor', cat: 'onboarding_companias',
    q: '¿Cómo doy de alta una nueva compañía?',
    expect: 'answer', contains: ['alta'] },
];

// ── Ejecución ───────────────────────────────────────────────────────────────

const norm = s => (s || '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

async function run(c) {
  const body = {
    brandId: c.brand,
    userId:  'reg-' + Math.random().toString(36).slice(2, 10),
    message: c.q,
    category: c.cat || null,
    ...(c.prov ? { provider: c.prov } : {}),
    ...(c.med ? MED : {}),
  };

  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body),
  });
  const d = await res.json();
  const reply = d.reply || '';
  const n = norm(reply);
  const fails = [];

  const escalated = d.status === 'escalated';
  if (c.expect === 'answer'   && escalated)  fails.push('escaló cuando debía responder');
  if (c.expect === 'escalate' && !escalated) fails.push('respondió cuando debía escalar');

  (c.contains || []).forEach(t => {
    if (!n.includes(norm(t))) fails.push(`falta "${t}"`);
  });
  (c.absent || []).forEach(t => {
    if (n.includes(norm(t))) fails.push(`NO debería decir "${t}"`);
  });

  return { ...c, reply, status: d.status, fails };
}

(async () => {
  const lote = GREP ? CASES.filter(c => c.id.includes(GREP)) : CASES;
  console.log(`\nRegresión · ${lote.length} casos · ${BASE}\n${'─'.repeat(74)}`);

  const results = [];
  for (const c of lote) {
    const r = await run(c);
    results.push(r);
    const mark = r.fails.length ? 'FALLA' : '  ok ';
    console.log(`${mark}  ${r.id.padEnd(24)} ${r.fails.join(' · ')}`);
  }

  const bad = results.filter(r => r.fails.length);
  if (bad.length) {
    console.log(`\n${'─'.repeat(74)}\nDetalle de los fallos:\n`);
    bad.forEach(r => {
      console.log(`  [${r.id}]  ${r.q}`);
      console.log(`     → ${r.reply}`);
      console.log(`     ✗ ${r.fails.join(' · ')}\n`);
    });
  }

  console.log(`${'─'.repeat(74)}`);
  console.log(`${lote.length - bad.length}/${lote.length} correctos\n`);
  process.exit(bad.length ? 1 : 0);
})();
