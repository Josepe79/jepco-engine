/**
 * Prueba de carga del endpoint de chat.
 *
 * Qué mide de verdad: dónde está el techo de Gemini y si al llegar degrada con
 * elegancia. Fastify y Postgres no son el cuello de botella a estas escalas —
 * cada mensaje son dos llamadas a Gemini (embedding + generación) de 1,5-2 s.
 *
 * IMPORTANTE antes de lanzarlo:
 *   - Contra una instancia local apuntando a la base real, no contra
 *     producción: gasta la misma cuota de Gemini, que es lo que queremos medir,
 *     pero no ensucia la telemetría del panel.
 *   - Con RATE_LIMIT_MAX alto, o medirías el límite en vez de la capacidad.
 *   - Gasta cuota: cada petición son dos llamadas a Gemini.
 *
 * Los usuarios de prueba llevan prefijo `load-` para poder borrarlos después.
 *
 * Uso:
 *   node scratch/load-test.js
 *   node scratch/load-test.js --levels 1,5,10,20 --waves 2
 *   node scratch/load-test.js --url https://…            (¡ojo, producción!)
 */
require('dotenv').config();

const args   = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(n); return i !== -1 && args[i+1] ? args[i+1] : d; };

const BASE   = argVal('--url', 'http://127.0.0.1:3999').replace(/\/$/, '');
const LEVELS = argVal('--levels', '1,5,10,20').split(',').map(Number);
const WAVES  = parseInt(argVal('--waves', '2'), 10);

// Preguntas reales, para que la recuperación trabaje como en producción.
const PREGUNTAS = [
  ['¿Cuánto puedo destinar al seguro de salud?',        'salud',                null],
  ['¿Dónde puedo usar la tarjeta de transporte?',       'transporte',           'edenred'],
  ['¿Puedo usarla en el supermercado?',                 'comida',               'pluxee'],
  ['¿Qué productos entran en la retribución flexible?', 'retribucion_general',  null],
  ['¿Hasta qué edad cubre la guardería?',               'guarderia',            'up_spain'],
  ['¿Cómo activo la tarjeta?',                          'comida',               'edenred'],
];

// Mensajes con los que el servidor avisa de que Gemini está saturado o caído.
const DEGRADADO = /muchas consultas|no está disponible temporalmente/i;

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};

async function unaPeticion(i) {
  const [message, category, provider] = PREGUNTAS[i % PREGUNTAS.length];
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        brandId: 'snfplus_usuario',
        userId:  'load-' + Math.random().toString(36).slice(2, 10),
        message, category,
        ...(provider ? { provider } : {}),
      }),
    });
    const ms = Date.now() - t0;

    if (res.status === 429) return { ms, tipo: 'limitado' };
    if (!res.ok)            return { ms, tipo: 'error', detalle: `HTTP ${res.status}` };

    const d = await res.json();
    if (DEGRADADO.test(d.reply || '')) return { ms, tipo: 'degradado' };
    return { ms, tipo: 'ok' };
  } catch (err) {
    return { ms: Date.now() - t0, tipo: 'error', detalle: err.message };
  }
}

async function nivel(concurrencia) {
  const todos = [];
  for (let w = 0; w < WAVES; w++) {
    const lote = Array.from({ length: concurrencia }, (_, k) => unaPeticion(w * concurrencia + k));
    todos.push(...await Promise.all(lote));
  }
  return todos;
}

(async () => {
  console.log(`\nPrueba de carga · ${BASE}`);
  console.log(`Niveles: ${LEVELS.join(', ')} · ${WAVES} oleadas por nivel`);
  console.log(`Total: ${LEVELS.reduce((a, c) => a + c * WAVES, 0)} peticiones ` +
              `(el doble de llamadas a Gemini)\n`);
  console.log('─'.repeat(78));
  console.log('conc.   peticiones    ok  degrad.  limit.  error      p50      p95      max');
  console.log('─'.repeat(78));

  const resumen = [];

  for (const c of LEVELS) {
    const r = await nivel(c);
    const ms = r.map(x => x.ms);
    const cuenta = t => r.filter(x => x.tipo === t).length;

    const fila = {
      concurrencia: c,
      total: r.length,
      ok: cuenta('ok'),
      degradado: cuenta('degradado'),
      limitado: cuenta('limitado'),
      error: cuenta('error'),
      p50: pct(ms, 0.5),
      p95: pct(ms, 0.95),
      max: Math.max(...ms),
    };
    resumen.push(fila);

    console.log(
      String(c).padStart(4) + '  ' +
      String(fila.total).padStart(11) + '  ' +
      String(fila.ok).padStart(4) + '  ' +
      String(fila.degradado).padStart(7) + '  ' +
      String(fila.limitado).padStart(6) + '  ' +
      String(fila.error).padStart(5) + '  ' +
      (fila.p50 + 'ms').padStart(7) + '  ' +
      (fila.p95 + 'ms').padStart(7) + '  ' +
      (fila.max + 'ms').padStart(7)
    );

    const errores = r.filter(x => x.tipo === 'error');
    if (errores.length) {
      const tipos = [...new Set(errores.map(e => e.detalle))];
      tipos.forEach(t => console.log(`        └─ ${t}`));
    }
  }

  console.log('─'.repeat(78));

  const conDegradacion = resumen.find(f => f.degradado > 0 || f.error > 0);
  console.log('');
  if (!conDegradacion) {
    console.log(`Sin degradación hasta ${LEVELS[LEVELS.length - 1]} usuarios concurrentes.`);
  } else {
    console.log(`Primera degradación a ${conDegradacion.concurrencia} concurrentes: ` +
                `${conDegradacion.degradado} respuestas de saturación, ${conDegradacion.error} errores.`);
  }
  const base = resumen[0], tope = resumen[resumen.length - 1];
  console.log(`Latencia p95: ${base.p95} ms con ${base.concurrencia} → ` +
              `${tope.p95} ms con ${tope.concurrencia}.`);
  console.log('\nRecuerda limpiar los usuarios `load-` de la telemetría.\n');
})();
