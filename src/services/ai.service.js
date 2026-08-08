const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');
const vectorService = require('./vector.service');

// Elimina saltos de línea y caracteres de control que podrían romper el system prompt
function sanitizeParam(value, maxLen) {
  if (!value) return null;
  return String(value).replace(/[\r\n\t]/g, ' ').slice(0, maxLen).trim();
}

function stripMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/`{1,3}([\s\S]*?)`{1,3}/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .trim();
}

const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY, { apiVersion: 'v1' });

async function getAIResponse(brandId, userMessage, history = [], category = null, appUrl = null, mediador = null) {
  const brand = config.BRANDS[brandId];
  if (!brand) throw new Error('Unknown brand');

  const safeAppUrl   = sanitizeParam(appUrl, 200);
  const safeMediador = sanitizeParam(mediador, 150);

  // 1. Obtener contexto relevante de la base de conocimientos.
  //
  // `retrieval` acompaña a la respuesta para poder registrar POR QUÉ salió como
  // salió. Sin esto, un fallo solo se ve como "el bot contestó mal", sin saber
  // si faltaba el fragmento, si existía pero no encajaba, o si la categoría
  // estaba mal mapeada.
  let context = '';
  const retrieval = {
    categoryFallback: false,
    chunksFound:      0,
    topSimilarity:    null,
    chunkIds:         [],
  };

  try {
    const queryEmbedding = await vectorService.generateEmbedding(userMessage);
    let similarChunks = await vectorService.findSimilarDocuments(brandId, queryEmbedding, 3, category);

    // Si la categoría pedida no devuelve nada, se reintenta sin filtro.
    // Que esto ocurra es en sí una señal: esa categoría no tiene contenido.
    if (similarChunks.length === 0 && category !== null) {
      retrieval.categoryFallback = true;
      similarChunks = await vectorService.findSimilarDocuments(brandId, queryEmbedding, 3, null);
    }

    if (similarChunks.length > 0) {
      context = similarChunks.map(c => c.content).join('\n---\n');
      retrieval.chunksFound   = similarChunks.length;
      retrieval.chunkIds      = similarChunks.map(c => c.id);
      // La similitud viene del propio pgvector: 1 - distancia coseno
      retrieval.topSimilarity = Number(similarChunks[0].similarity);
    }
  } catch (err) {
    console.error('Error retrieving context:', err);
  }

  const systemInstruction = `Eres el asistente de ${brand.name}. ${brand.personality}
Conocimiento base: ${brand.manual}
${safeAppUrl   ? `URL de acceso a la aplicación: ${safeAppUrl}` : ''}
${safeMediador ? `Mediador de seguros de este cliente: ${safeMediador}` : ''}

INFORMACIÓN RECUPERADA (úsala si es relevante):
${context || 'Sin información adicional.'}

REGLAS DE RESPUESTA — síguelas siempre sin excepción:
1. Máximo 2-3 frases cortas. Nunca más.
2. Lenguaje simple y directo, como si respondieras por WhatsApp.
3. Sin asteriscos, sin negritas, sin guiones, sin listas, sin títulos. Solo texto plano.
4. No repitas la pregunta ni pongas introducciones del tipo "¡Claro!", "Por supuesto", "Es un placer", etc. Ve directo a la respuesta.
5. Responde ÚNICAMENTE con lo que esté en la INFORMACIÓN RECUPERADA. No uses conocimiento propio sobre seguros, fiscalidad, productos financieros ni legislación. Si la información no está en el contexto, escala.
6. Si el usuario pregunta por coberturas, condiciones o exclusiones del seguro de salud, responde siempre que debe contactar con ${safeMediador ? `el mediador: ${safeMediador}` : 'el mediador de la póliza'}.
7. Si la pregunta es legal o compleja y no está en el manual, responde exactamente: "[ESCALAR_A_HUMANO] No tengo esa información ahora mismo, pero he avisado a un agente para que te contacte."
8. Si no estás seguro o la información no aparece en el contexto, responde exactamente: "[ESCALAR_A_HUMANO] No tengo esa información ahora mismo, pero he avisado a un agente para que te contacte."`;

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash-lite',
    systemInstruction,
    generationConfig: {
      maxOutputTokens: 150,
      temperature: 0.5,
    }
  }, { apiVersion: 'v1beta' });

  // Format history for Gemini
  const chatHistory = history.map(msg => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [{ text: msg.text }]
  }));

  const chat = model.startChat({
    history: chatHistory,
  });

  let result;
  try {
    result = await chat.sendMessage(userMessage);
  } catch (geminiError) {
    const msg = geminiError.message || '';
    if (msg.includes('429') || msg.includes('quota') || msg.includes('Too Many Requests')) {
      return {
        text: 'En este momento el asistente está recibiendo muchas consultas. Por favor, inténtalo de nuevo en unos segundos.',
        shouldEscalate: false,
        retrieval,
        degraded: 'quota',
      };
    }
    if (msg.includes('503') || msg.includes('Service Unavailable')) {
      return {
        text: 'El asistente no está disponible temporalmente. Por favor, inténtalo de nuevo en unos minutos.',
        shouldEscalate: false,
        retrieval,
        degraded: 'unavailable',
      };
    }
    throw geminiError;
  }

  const rawText = result.response.text();
  const shouldEscalate = rawText.includes('[ESCALAR_A_HUMANO]');
  const cleanText = stripMarkdown(rawText.replaceAll('[ESCALAR_A_HUMANO]', ''));

  return {
    text: cleanText,
    shouldEscalate,
    retrieval,
  };
}

module.exports = { getAIResponse };
