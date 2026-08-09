const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');
const prisma = require('./db.service');

const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);
// Modelo estable de 3072 dimensiones verificado en esta cuenta
const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" }, { apiVersion: "v1beta" });

/**
 * Genera un embedding para un texto dado.
 * @param {string} text 
 * @returns {Promise<number[]>}
 */
async function generateEmbedding(text) {
  try {
    const result = await embeddingModel.embedContent(text);
    return result.embedding.values;
  } catch (error) {
    console.error('Error generating embedding:', error);
    throw error;
  }
}

/**
 * Búsqueda por similitud de coseno sobre la base de conocimiento.
 *
 * @param {string}   brandId
 * @param {number[]} queryEmbedding
 * @param {number}   limit
 * @param {string?}  category  Acota a una sección concreta.
 * @param {string?}  provider  Emisor de la tarjeta (edenred, pluxee, …).
 *
 * Sobre el proveedor: los fragmentos con `provider = NULL` son genéricos y
 * entran siempre; los que llevan proveedor solo entran si coincide con el del
 * usuario. Así la parte fiscal —idéntica para todos— se guarda una sola vez, y
 * la operativa —dónde se usa la tarjeta, qué app— queda acotada a su emisor.
 *
 * Sin proveedor conocido se devuelve solo lo genérico: es preferible no
 * responder a responder con los datos del emisor equivocado.
 */
async function findSimilarDocuments(brandId, queryEmbedding, limit = 5, category = null, provider = null) {
  try {
    // pgvector: la similitud de coseno es 1 - (embedding <=> vector)
    const vectorString = `[${queryEmbedding.join(',')}]`;

    let query = `
      SELECT id, content, metadata, "provider",
             1 - (embedding <=> $1::vector) as similarity
      FROM "KnowledgeChunk"
      WHERE "brandId" = $2
    `;

    const params = [vectorString, brandId];

    if (category) {
      params.push(category);
      query += ` AND "category" = $${params.length}`;
    }

    if (provider) {
      params.push(provider);
      query += ` AND ("provider" IS NULL OR "provider" = $${params.length})`;
    } else {
      query += ` AND "provider" IS NULL`;
    }

    params.push(limit);
    query += ` ORDER BY similarity DESC LIMIT $${params.length}`;

    return await prisma.$queryRawUnsafe(query, ...params);
  } catch (error) {
    console.error('Error finding similar documents:', error);
    throw error;
  }
}

module.exports = {
  generateEmbedding,
  findSimilarDocuments
};
