/**
 * Detección de patrones sobre la telemetría de interacciones.
 *
 * Fuente única de verdad: la consumen tanto el panel de administración como
 * `scratch/patterns.js`, para que la línea de comandos y la web nunca digan
 * cosas distintas.
 *
 * Cada patrón apunta a un tipo de fallo distinto, y cada tipo se corrige de una
 * manera distinta — por eso van separados en lugar de un listado plano.
 */

const prisma = require('./db.service');

/** Por debajo de esto, el fragmento recuperado no se parece de verdad. */
const WEAK_MATCH = 0.60;
/** Dos preguntas de la misma sesión dentro de este margen = reformulación. */
const REPHRASE_WINDOW_S = 90;
/** Por encima de esto la recuperación fue buena: si aun así falla, es fidelidad. */
const STRONG_MATCH = 0.70;

function buildWhere(brandId, days) {
  const since = new Date(Date.now() - days * 86_400_000);
  return brandId
    ? { brandId, createdAt: { gte: since } }
    : { createdAt: { gte: since } };
}

async function getSummary(where) {
  const [total, escalated, noContext, fallback, freeText] = await Promise.all([
    prisma.interaction.count({ where }),
    prisma.interaction.count({ where: { ...where, escalated: true } }),
    prisma.interaction.count({ where: { ...where, chunksFound: 0 } }),
    prisma.interaction.count({ where: { ...where, categoryFallback: true } }),
    prisma.interaction.count({ where: { ...where, category: null } }),
  ]);
  return { total, escalated, noContext, fallback, freeText };
}

/** Hueco total: no hay nada parecido en el conocimiento. */
function getGaps(where, take) {
  return prisma.interaction.findMany({
    where:   { ...where, chunksFound: 0 },
    orderBy: { createdAt: 'desc' },
    take,
    select:  { id: true, question: true, category: true, brandId: true, createdAt: true },
  });
}

/** Match débil: existe contenido pero no encaja con cómo se pregunta. */
function getWeakMatches(where, take) {
  return prisma.interaction.findMany({
    where:   { ...where, chunksFound: { gt: 0 }, topSimilarity: { lt: WEAK_MATCH } },
    orderBy: { topSimilarity: 'asc' },
    take,
    select:  { id: true, question: true, category: true, brandId: true, topSimilarity: true, createdAt: true },
  });
}

/** Escalados: la IA se rindió. Hueco confirmado. */
function getEscalations(where, take) {
  return prisma.interaction.findMany({
    where:   { ...where, escalated: true },
    orderBy: { createdAt: 'desc' },
    take,
    select:  { id: true, question: true, answer: true, category: true, brandId: true, topSimilarity: true, createdAt: true },
  });
}

/**
 * Recuperación buena que no escaló.
 *
 * Es la vista contraintuitiva: aquí las métricas salen sanas y aun así puede
 * haber respuestas que se salen del manual. No se detecta por número — hay que
 * leerlas. Es el único patrón que exige revisión humana.
 */
function getFidelityReview(where, take) {
  return prisma.interaction.findMany({
    where:   { ...where, escalated: false, topSimilarity: { gte: STRONG_MATCH } },
    orderBy: { createdAt: 'desc' },
    take,
    select:  { id: true, question: true, answer: true, category: true, brandId: true, topSimilarity: true, createdAt: true },
  });
}

/** Categorías cuyo botón no encuentra contenido propio. */
async function getEmptyCategories(where) {
  const rows = await prisma.interaction.groupBy({
    by:     ['category'],
    where:  { ...where, categoryFallback: true },
    _count: { _all: true },
  });
  return rows
    .map(r => ({ category: r.category, count: r._count._all }))
    .sort((a, b) => b.count - a.count);
}

/** Uso por categoría, para ver qué botones sobran y cuáles faltan. */
async function getCategoryUsage(where) {
  const rows = await prisma.interaction.groupBy({
    by:     ['category'],
    where,
    _count: { _all: true },
  });
  return rows
    .map(r => ({ category: r.category || '(texto libre)', count: r._count._all }))
    .sort((a, b) => b.count - a.count);
}

/** Preguntas escritas a mano: lo que el menú de botones no cubre. */
function getFreeText(where, take) {
  return prisma.interaction.findMany({
    where:   { ...where, category: null },
    orderBy: { createdAt: 'desc' },
    take,
    select:  { id: true, question: true, brandId: true, escalated: true, createdAt: true },
  });
}

/** Repreguntas inmediatas: la respuesta anterior no convenció. */
async function getRephrases(where, take) {
  const rows = await prisma.interaction.findMany({
    where:   { ...where, conversationId: { not: null } },
    orderBy: [{ conversationId: 'asc' }, { createdAt: 'asc' }],
    select:  { id: true, conversationId: true, question: true, createdAt: true, brandId: true },
  });

  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur  = rows[i];
    if (prev.conversationId !== cur.conversationId) continue;

    const gapSeconds = (cur.createdAt - prev.createdAt) / 1000;
    if (gapSeconds <= REPHRASE_WINDOW_S) {
      out.push({
        id: cur.id,
        brandId: cur.brandId,
        first: prev.question,
        then: cur.question,
        gapSeconds: Math.round(gapSeconds),
        createdAt: cur.createdAt,
      });
    }
  }
  return out.slice(-take).reverse();
}

/**
 * Fragmentos que nunca se recuperan.
 *
 * Ojo al interpretarlo: con poco tráfico casi todo parece muerto. Solo es
 * señal fiable cuando hay volumen suficiente en el periodo consultado.
 */
async function getDeadChunks(where, brandId) {
  const used = new Set();
  const rows = await prisma.interaction.findMany({
    where:  { ...where, chunksFound: { gt: 0 } },
    select: { chunkIds: true },
  });
  rows.forEach(r => {
    (Array.isArray(r.chunkIds) ? r.chunkIds : []).forEach(id => used.add(id));
  });

  const all = await prisma.knowledgeChunk.findMany({
    where:  brandId ? { brandId } : {},
    select: { id: true, brandId: true, category: true, content: true },
  });

  return {
    totalChunks: all.length,
    usedChunks:  used.size,
    dead: all
      .filter(c => !used.has(c.id))
      .map(c => ({
        id: c.id,
        brandId: c.brandId,
        category: c.category,
        preview: c.content.slice(0, 90),
      })),
  };
}

/**
 * Todo lo que necesita el panel en una sola llamada.
 */
async function getOverview({ brandId = null, days = 7, take = 20 } = {}) {
  const where = buildWhere(brandId, days);

  const [
    summary, gaps, weakMatches, escalations, fidelityReview,
    emptyCategories, categoryUsage, freeText, rephrases, chunks,
  ] = await Promise.all([
    getSummary(where),
    getGaps(where, take),
    getWeakMatches(where, take),
    getEscalations(where, take),
    getFidelityReview(where, take),
    getEmptyCategories(where),
    getCategoryUsage(where),
    getFreeText(where, take),
    getRephrases(where, take),
    getDeadChunks(where, brandId),
  ]);

  return {
    meta: { brandId, days, generatedAt: new Date(), thresholds: { WEAK_MATCH, STRONG_MATCH, REPHRASE_WINDOW_S } },
    summary,
    gaps,
    weakMatches,
    escalations,
    fidelityReview,
    emptyCategories,
    categoryUsage,
    freeText,
    rephrases,
    chunks,
  };
}

module.exports = {
  WEAK_MATCH, STRONG_MATCH, REPHRASE_WINDOW_S,
  buildWhere, getOverview, getSummary, getGaps, getWeakMatches,
  getEscalations, getFidelityReview, getEmptyCategories,
  getCategoryUsage, getFreeText, getRephrases, getDeadChunks,
};
