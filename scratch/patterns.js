/**
 * Detector de patrones por línea de comandos.
 *
 * Usa el mismo servicio que el panel web (`src/services/analytics.service.js`),
 * así que ambos dicen siempre lo mismo. El panel está en /admin.
 *
 * Uso:
 *   node scratch/patterns.js                   últimos 7 días, todas las marcas
 *   node scratch/patterns.js snfplus_rrhh      una marca
 *   node scratch/patterns.js snfplus_rrhh 30   una marca, 30 días
 */
require('dotenv').config();
const analytics = require('../src/services/analytics.service');
const prisma    = require('../src/services/db.service');

const BRAND = process.argv[2] || null;
const DAYS  = parseInt(process.argv[3] || '7', 10);

const trim = (s, n = 66) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const pct  = (a, b) => (b === 0 ? '0' : ((a / b) * 100).toFixed(0));

function section(title, count) {
  console.log(`\n\n${title}  (${count})`);
  console.log('─'.repeat(78));
}

async function main() {
  const d = await analytics.getOverview({ brandId: BRAND, days: DAYS, take: 15 });
  const s = d.summary;

  console.log(`\n${'═'.repeat(78)}`);
  console.log(`PATRONES · ${BRAND || 'todas las marcas'} · últimos ${DAYS} días`);
  console.log('═'.repeat(78));

  if (s.total === 0) {
    console.log('\nNo hay interacciones registradas en este periodo.\n');
    return;
  }

  console.log(`\n  Intercambios      ${s.total}`);
  console.log(`  Escalados         ${s.escalated}  (${pct(s.escalated, s.total)}%)`);
  console.log(`  Sin contexto      ${s.noContext}  (${pct(s.noContext, s.total)}%)`);
  console.log(`  Categoría vacía   ${s.fallback}  (${pct(s.fallback, s.total)}%)`);
  console.log(`  Texto libre       ${s.freeText}  (${pct(s.freeText, s.total)}%)`);

  if (d.escalations.length) {
    section('ESCALADOS · hueco confirmado, máxima prioridad', d.escalations.length);
    d.escalations.forEach(e => {
      const sim = e.topSimilarity != null ? e.topSimilarity.toFixed(2) : ' — ';
      console.log(`  ${sim}  [${e.brandId}/${e.category || 'libre'}]  ${trim(e.question)}`);
    });
  }

  if (d.fidelityReview.length) {
    section(`REVISIÓN DE FIDELIDAD · similitud ≥ ${analytics.STRONG_MATCH} sin escalar`, d.fidelityReview.length);
    console.log('  Las métricas salen sanas. Hay que leerlas para saber si la respuesta');
    console.log('  se ciñó al manual o la IA tiró de conocimiento propio.\n');
    d.fidelityReview.forEach(r => {
      console.log(`  ${r.topSimilarity.toFixed(2)}  ${trim(r.question)}`);
      console.log(`        ↳ ${trim(r.answer, 64)}`);
    });
  }

  if (d.gaps.length) {
    section('HUECO TOTAL · no hay nada parecido en el conocimiento', d.gaps.length);
    d.gaps.forEach(g => console.log(`  [${g.brandId}/${g.category || 'libre'}]  ${trim(g.question)}`));
  }

  if (d.weakMatches.length) {
    section(`MATCH DÉBIL · existe contenido pero encaja mal (< ${analytics.WEAK_MATCH})`, d.weakMatches.length);
    d.weakMatches.forEach(w =>
      console.log(`  ${w.topSimilarity.toFixed(2)}  [${w.category || 'libre'}]  ${trim(w.question)}`));
  }

  if (d.rephrases.length) {
    section(`REFORMULACIONES · repreguntó en menos de ${analytics.REPHRASE_WINDOW_S}s`, d.rephrases.length);
    d.rephrases.forEach(r => {
      console.log(`  ${String(r.gapSeconds).padStart(3)}s  ${trim(r.first, 64)}`);
      console.log(`        ↳ ${trim(r.then, 62)}`);
    });
  }

  if (d.emptyCategories.length) {
    section('CATEGORÍA VACÍA · el botón no encuentra contenido propio', d.emptyCategories.length);
    d.emptyCategories.forEach(c => console.log(`  ${String(c.count).padStart(4)}  ${c.category}`));
  }

  if (d.categoryUsage.length) {
    section('USO POR CATEGORÍA', d.categoryUsage.length);
    d.categoryUsage.forEach(c => console.log(`  ${String(c.count).padStart(4)}  ${c.category}`));
  }

  if (d.freeText.length) {
    section('TEXTO LIBRE · escribió en vez de usar el menú', d.freeText.length);
    d.freeText.forEach(f => console.log(`  [${f.brandId}]  ${trim(f.question)}`));
  }

  if (d.chunks.dead.length) {
    section('FRAGMENTOS SIN USAR · nunca se han recuperado', d.chunks.dead.length);
    console.log(`  ${d.chunks.usedChunks} de ${d.chunks.totalChunks} fragmentos se usan.`);
    console.log('  Con poco tráfico casi todo parece muerto: solo es fiable con volumen.\n');
    d.chunks.dead.forEach(c => console.log(`  [${c.brandId}]  ${c.category || 'sin categoría'}`));
  }

  console.log('\n');
}

main()
  .catch(err => { console.error('\nERROR:', err.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
