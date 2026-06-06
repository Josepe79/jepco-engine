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
 * Realiza una búsqueda de similitud de coseno en la base de datos.
 * @param {string} brandId - El ID de la marca para filtrar.
 * @param {number[]} queryEmbedding - El vector de consulta.
 * @param {number} limit - Número máximo de resultados.
 * @returns {Promise<any[]>}
 */
async function findSimilarDocuments(brandId, queryEmbedding, limit = 5, category = null) {
  try {
    // Usamos $queryRaw para realizar la búsqueda vectorial con pgvector
    // La similitud de coseno es 1 - (embedding <=> vector)
    const vectorString = `[${queryEmbedding.join(',')}]`;
    
    let query = `
      SELECT id, content, metadata, 1 - (embedding <=> $1::vector) as similarity
      FROM "KnowledgeChunk"
      WHERE "brandId" = $2
    `;

    const params = [vectorString, brandId];

    if (category) {
      query += ` AND "category" = $3`;
      params.push(category);
    }

    query += ` ORDER BY similarity DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const results = await prisma.$queryRawUnsafe(query, ...params);

    return results;
  } catch (error) {
    console.error('Error finding similar documents:', error);
    throw error;
  }
}

module.exports = {
  generateEmbedding,
  findSimilarDocuments
};
