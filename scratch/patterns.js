/**
 * Detector de patrones sobre la telemetría de interacciones.
 *
 * Cada patrón apunta a un tipo distinto de fallo, y cada tipo se corrige de una
 * manera distinta. Esa es la razón de separarlos en vez de mirar un listado.
 *
 *   HUECO TOTAL      la búsqueda no encontró nada    → falta el fragmento
 *   MATCH DÉBIL      encontró algo pero encaja mal   → reescribir con el
 *                                                      vocabulario del usuario
 *   CATEGORÍA VACÍA  el botón apunta a la nada       → mapeo mal, o falta
 *                                                      contenido en esa categoría
 *   ESCALADO         la IA se rindió                 → hueco confirmado
 *   REFORMULACIÓN    volvió a preguntar enseguida    → la respuesta no convenció
 *   FRAGMENTO MUERTO nunca se recupera               → sobra, o está mal redactado
 *   TEXTO LIBRE      escribió en vez de usar botón   → el menú no cubre eso
 *
 * Uso:
 *   node scratch/patterns.js                   últimos 7 días, todas las marcas
 *   node scratch/patterns.js snfplus_rrhh      una marca
 *   node scratch/patterns.js snfplus_rrhh 30   una marca, 30 días
 */
require('dotenv').config();
const prisma = require('../src/services/db.service');

const BRAND = process.argv[2] || null;
const DAYS  = parseInt(process.argv[3] || '7', 10);

// Por debajo de esto, el fragmento recuperado no se parece de verdad a la
// pregunta. Ajustable según lo que se observe en la práctica.
const WEAK_MATCH = 0.60;
// Dos preguntas de la misma sesión en menos de este margen se consideran
// reformulación de la anterior.
const REPHRASE_WINDOW_S = 90;

const since = new Date(Date.now() - DAYS * 86400_000);
const where = BRAND ? { brandId: BRAND, createdAt: { gte: since } }
                    : { createdAt: { gte: since } };

const trim = (s, n = 68) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const pct  = (a, b) => (b === 0 ? '0' : ((a / b) * 100).toFixed(0));

function section(title, count) {
  console.log(`\n\n${title}${count !== undefined ? `  (${count})` : ''}`);
  console.log('─'.repeat(78));
}

async function main() {
  const total = await prisma.interaction.count({ where });

  console.log(`\n${'═'.repeat(78)}`);
  console.log(`PATRONES · ${BRAND || 'todas las marcas'} · últimos ${DAYS} días`);
  console.log('═'.repeat(78));

  if (total === 0) {
    console.log('\nNo hay interacciones registradas en este periodo.\n');
    return;
  }

  // ── Resumen ────────────────────────────────────────────────────────────────

  const [escalated, noContext, fallback, freeText] = await Promise.all([
    prisma.interaction.count({ where: { ...where, escalated: true } }),
    prisma.interaction.count({ where: { ...where, chunksFound: 0 } }),
    prisma.interaction.count({ where: { ...where, categoryFallback: true } }),
    prisma.interaction.count({ where: { ...where, category: null } }),
  ]);

  console.log(`\n  Intercambios      ${total}`);
  console.log(`  Escalados         ${escalated}  (${pct(escalated, total)}%)`);
  console.log(`  Sin contexto      ${noContext}  (${pct(noContext, total)}%)`);
  console.log(`  Categoría vacía   ${fallback}  (${pct(fallback, total)}%)`);
  console.log(`  Texto libre       ${freeText}  (${pct(freeText, total)}%)`);

  // ── 1. Hueco total ─────────────────────────────────────────────────────────

  const gaps = await prisma.interaction.findMany({
    where:   { ...where, chunksFound: 0 },
    orderBy: { createdAt: 'desc' },
    take:    15,
    select:  { question: true, category: true, brandId: true },
  });
  if (gaps.length) {
    section('HUECO TOTAL · no hay nada parecido en el conocimiento', gaps.length);
    gaps.forEach(g => console.log(`  [${g.brandId}/${g.category || 'libre'}]  ${trim(g.question)}`));
  }

  // ── 2. Match débil ─────────────────────────────────────────────────────────

  const weak = await prisma.interaction.findMany({
    where:   { ...where, chunksFound: { gt: 0 }, topSimilarity: { lt: WEAK_MATCH } },
    orderBy: { topSimilarity: 'asc' },
    take:    15,
    select:  { question: true, category: true, topSimilarity: true },
  });
  if (weak.length) {
    section(`MATCH DÉBIL · existe contenido pero encaja mal (< ${WEAK_MATCH})`, weak.length);
    weak.forEach(w =>
      console.log(`  ${w.topSimilarity.toFixed(2)}  [${w.category || 'libre'}]  ${trim(w.question)}`)
    );
  }

  // ── 3. Categoría vacía ─────────────────────────────────────────────────────

  const emptyCats = await prisma.interaction.groupBy({
    by:      ['category'],
    where:   { ...where, categoryFallback: true },
    _count:  { _all: true },
    orderBy: { _count: { category: 'desc' } },
  });
  if (emptyCats.length) {
    section('CATEGORÍA VACÍA · el botón no encuentra contenido propio', emptyCats.length);
    emptyCats.forEach(c => console.log(`  ${String(c._count._all).padStart(4)}  ${c.category}`));
  }

  // ── 4. Escalados ───────────────────────────────────────────────────────────

  const esc = await prisma.interaction.findMany({
    where:   { ...where, escalated: true },
    orderBy: { createdAt: 'desc' },
    take:    15,
    select:  { question: true, category: true, topSimilarity: true, brandId: true },
  });
  if (esc.length) {
    section('ESCALADOS · la IA no pudo responder', esc.length);
    esc.forEach(e => {
      const sim = e.topSimilarity != null ? e.topSimilarity.toFixed(2) : ' — ';
      console.log(`  ${sim}  [${e.brandId}/${e.category || 'libre'}]  ${trim(e.question)}`);
    });
  }

  // ── 5. Reformulaciones ─────────────────────────────────────────────────────

  const seq = await prisma.interaction.findMany({
    where:   { ...where, conversationId: { not: null } },
    orderBy: [{ conversationId: 'asc' }, { createdAt: 'asc' }],
    select:  { conversationId: true, question: true, createdAt: true },
  });

  const rephrases = [];
  for (let i = 1; i < seq.length; i++) {
    const prev = seq[i - 1], cur = seq[i];
    if (prev.conversationId !== cur.conversationId) continue;
    const gap = (cur.createdAt - prev.createdAt) / 1000;
    if (gap <= REPHRASE_WINDOW_S) rephrases.push({ prev, cur, gap });
  }
  if (rephrases.length) {
    section(`REFORMULACIONES · repreguntó en menos de ${REPHRASE_WINDOW_S}s`, rephrases.length);
    rephrases.slice(-12).forEach(r => {
      console.log(`  ${String(Math.round(r.gap)).padStart(3)}s  ${trim(r.prev.question, 66)}`);
      console.log(`        ↳ ${trim(r.cur.question, 64)}`);
    });
  }

  // ── 6. Fragmentos muertos ──────────────────────────────────────────────────

  const used = new Set();
  const rows = await prisma.interaction.findMany({
    where: { ...where, chunksFound: { gt: 0 } },
    select: { chunkIds: true },
  });
  rows.forEach(r => (Array.isArray(r.chunkIds) ? r.chunkIds : []).forEach(id => used.add(id)));

  const chunkWhere = BRAND ? { brandId: BRAND } : {};
  const allChunks = await prisma.knowledgeChunk.findMany({
    where:  chunkWhere,
    select: { id: true, brandId: true, category: true },
  });
  const dead = allChunks.filter(c => !used.has(c.id));
  if (dead.length) {
    section('FRAGMENTOS MUERTOS · nunca se han recuperado', dead.length);
    console.log(`  De ${allChunks.length} fragmentos, ${used.size} se usan y ${dead.length} no.\n`);
    dead.forEach(d => console.log(`  [${d.brandId}]  ${d.category || 'sin categoría'}`));
  }

  // ── 7. Texto libre ─────────────────────────────────────────────────────────

  const free = await prisma.interaction.findMany({
    where:   { ...where, category: null },
    orderBy: { createdAt: 'desc' },
    take:    15,
    select:  { question: true, brandId: true },
  });
  if (free.length) {
    section('TEXTO LIBRE · escribió en vez de usar el menú', free.length);
    free.forEach(f => console.log(`  [${f.brandId}]  ${trim(f.question)}`));
  }

  console.log('\n');
}

main()
  .catch(err => { console.error('\nERROR:', err.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
