const pdf = require('pdf-extraction');
const crypto = require('crypto');
const vectorService = require('./vector.service');
const prisma = require('./db.service');

/**
 * Procesa un archivo (PDF o JSON) y guarda los chunks vectorizados.
 * @param {string} brandId 
 * @param {Buffer} buffer - Contenido del archivo
 * @param {string} filename 
 * @param {string} mimetype 
 */
async function processFile(brandId, buffer, filename, mimetype, category = null) {
  console.log(`>>> Ingestion Service: Processing file ${filename} (${mimetype})`);
  let content = '';
  
  if (mimetype === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) {
    console.log('>>> Starting PDF extraction (this might take a few seconds)...');
    try {
      const data = await pdf(buffer);
      content = data.text;
      console.log(`>>> PDF extraction complete. Text length: ${content.length}`);
    } catch (pdfError) {
      console.error('>>> CRITICAL ERROR during PDF extraction:', pdfError);
      throw new Error(`PDF parsing failed: ${pdfError.message}`);
    }
  } else if (mimetype === 'application/json' || filename.endsWith('.json')) {
    const json = JSON.parse(buffer.toString());
    content = typeof json === 'string' ? json : JSON.stringify(json, null, 2);
  } else {
    content = buffer.toString();
  }

  if (!content || content.trim().length === 0) {
    throw new Error('Could not extract text from file.');
  }

  // Chunking simple: por párrafos o bloques de ~1000 caracteres
  const chunks = chunkText(content, 1000);
  console.log(`Processing ${chunks.length} chunks for ${filename}...`);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk.trim()) continue;

    console.log(`Processing chunk ${i + 1}/${chunks.length}...`);
    try {
      const embedding = await vectorService.generateEmbedding(chunk);
      const vectorString = `[${embedding.join(',')}]`;
      
      const id = crypto.randomUUID();
      const metadata = JSON.stringify({ filename, timestamp: new Date() });

      // Usamos una forma más robusta de insertar para evitar crashes
      await prisma.$executeRawUnsafe(
        'INSERT INTO "KnowledgeChunk" ("id", "brandId", "content", "embedding", "metadata", "category") VALUES ($1, $2, $3, $4::vector, $5, $6)',
        id, brandId, chunk, vectorString, metadata, category
      );
    } catch (err) {
      console.error(`Error in chunk ${i + 1}:`, err);
      throw err;
    }
  }

  return { success: true, chunksCount: chunks.length };
}

/**
 * Divide el texto en chunks de un tamaño máximo aproximado.
 */
function chunkText(text, maxLength) {
  const paragraphs = text.split(/\n\s*\n/);
  const chunks = [];
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    if ((currentChunk + paragraph).length > maxLength && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = '';
    }
    currentChunk += paragraph + '\n\n';
  }
  
  if (currentChunk) chunks.push(currentChunk.trim());
  return chunks;
}

module.exports = {
  processFile
};
