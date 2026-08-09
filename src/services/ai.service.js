const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');
const vectorService = require('./vector.service');

// Elimina saltos de línea y caracteres de control que podrían romper el system prompt
function sanitizeParam(value, maxLen) {
  if (!value) return null;
  return String(value).replace(/[\r\n\t]/g, ' ').slice(0, maxLen).trim();
}

/**
 * Garantiza que los datos de contacto del mediador salgan cuando toca.
 *
 * No se deja en manos del modelo. Aunque el prompt se los da, unas veces los
 * escribe enteros, otras los resume a "contacta con tu mediador" y otras se los
 * salta entero para no pasarse del límite de frases. Como el dato es fijo y no
 * depende de la conversación, se impone aquí.
 *
 * @param {boolean} force  Añadir el cierre aunque el modelo no haya mencionado
 *                         al mediador. Se usa en consultas de salud, donde la
 *                         norma de negocio es indicarlo siempre.
 */
function ensureMediadorContact(text, contacto, { force = false } = {}) {
  if (!contacto || !text) return text;
  if (text.includes(contacto)) return text;

  // Sustituye una referencia genérica ("con tu mediador") por los datos reales
  const generico = /\s*\b(?:a|con)?\s*(?:tu|el|su)\s+mediador(?:\s+de\s+(?:la\s+)?p[óo]liza)?/i;
  if (generico.test(text)) {
    return text.replace(generico, ' con ' + contacto).replace(/\s{2,}/g, ' ');
  }

  if (force) {
    const sep = /[.!?]\s*$/.test(text) ? ' ' : '. ';
    return `${text.trimEnd()}${sep}Para coberturas y condiciones de la póliza, contacta con ${contacto}.`;
  }
  return text;
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

/**
 * @param {object} options  Contexto del entorno que incrusta el widget.
 *   Va en objeto y no como parámetros sueltos porque ya son demasiados: cuando
 *   eran posicionales, `category` acabó colándose en el hueco de `ctx` y la
 *   categoría no llegaba nunca al RAG.
 */
async function getAIResponse(brandId, userMessage, history = [], options = {}) {
  const brand = config.BRANDS[brandId];
  if (!brand) throw new Error('Unknown brand');

  const { category = null, appUrl = null,
          mediador = null, mediadorEmail = null, mediadorTel = null } = options;

  const safeAppUrl        = sanitizeParam(appUrl, 200);
  const safeMediador      = sanitizeParam(mediador, 150);
  const safeMediadorEmail = sanitizeParam(mediadorEmail, 120);
  const safeMediadorTel   = sanitizeParam(mediadorTel, 40);

  // Datos de contacto del mediador tal cual se los daremos al usuario.
  // Son datos de contacto profesional de una empresa, no datos personales del
  // usuario: mostrarlos no supone ninguna cesión.
  const mediadorContacto = [safeMediador, safeMediadorTel, safeMediadorEmail]
    .filter(Boolean).join(', ');
  const mediadorRef = mediadorContacto || 'el mediador de tu póliza';

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
${safeAppUrl ? `URL de acceso a la aplicación: ${safeAppUrl}` : ''}
${mediadorContacto ? `Mediador de seguros de este cliente: ${mediadorContacto}` : ''}

INFORMACIÓN RECUPERADA (úsala si es relevante):
${context || 'Sin información adicional.'}

REGLAS DE RESPUESTA — síguelas siempre sin excepción:
1. Máximo 3 frases cortas. Nunca más.
2. Lenguaje simple y directo, como si respondieras por WhatsApp.
3. Sin asteriscos, sin negritas, sin guiones, sin listas, sin títulos. Solo texto plano.
4. No repitas la pregunta ni pongas introducciones del tipo "¡Claro!", "Por supuesto", "Es un placer", etc. Ve directo a la respuesta.
5. Responde ÚNICAMENTE con lo que esté en la INFORMACIÓN RECUPERADA. No uses conocimiento propio sobre seguros, fiscalidad, productos financieros ni legislación. Si la información no está en el contexto, escala.

SEGURO DE SALUD — distingue siempre entre estas dos cosas:
6. FISCALIDAD Y FUNCIONAMIENTO (límites de importe, quién puede incluirse, edad de los hijos, discapacidad, duración del contrato, requisitos, cómo se contrata en la aplicación): esto SÍ lo sabes. Respóndelo con la INFORMACIÓN RECUPERADA. No derives al mediador.
7. COBERTURAS Y CONDICIONES DE LA PÓLIZA (qué incluye o excluye, cuadro médico, especialidades, reembolsos, reclamaciones, altas y bajas de la aseguradora): esto NO lo sabes. Deriva al mediador con sus datos tal cual: ${mediadorRef}.
8. Si la pregunta sobre el seguro de salud es genérica o ambigua, responde primero lo que sepas de fiscalidad y funcionamiento, y cierra con una frase diciendo que para coberturas concretas contacte con el mediador. En ese caso NO escales: sí has respondido.

CUANDO NO SEPAS LA RESPUESTA:
9. Nunca digas que has avisado a nadie, ni que alguien va a contactar al usuario. No es cierto y no puede cumplirse. Di simplemente que no tienes esa información y a quién puede dirigirse.
10. Si no encuentras la respuesta en la INFORMACIÓN RECUPERADA, empieza obligatoriamente por "[ESCALAR_A_HUMANO]" y continúa así:
   - Si la duda es del seguro o la póliza: "No tengo esa información. Esa consulta la resuelve tu mediador: ${mediadorRef}."
   - En cualquier otro caso: "No tengo esa información. Consúltalo con ${brand.escalationFallback || 'el equipo de soporte'}."
11. La etiqueta [ESCALAR_A_HUMANO] va una sola vez y siempre al principio. Nunca la expliques ni la menciones en el texto.`;

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
  let cleanText = stripMarkdown(rawText.replaceAll('[ESCALAR_A_HUMANO]', ''));

  // En consultas de salud la norma de negocio es indicar siempre el mediador
  // para coberturas, aunque la respuesta en sí sea de fiscalidad.
  cleanText = ensureMediadorContact(cleanText, mediadorContacto, {
    force: category === 'salud',
  });

  // El escalado no puede depender solo de que el modelo acuerde poner la
  // etiqueta: a veces responde "No tengo esa información" y la omite. Cuando eso
  // pasa el escalado se pierde — no sale en el panel ni avisa por Telegram — y
  // el fallo es invisible, porque al usuario le llega la respuesta correcta.
  //
  // Por eso se comprueba también el texto, cuya redacción exacta imponemos
  // desde el prompt.
  const SIN_RESPUESTA = /^\s*no tengo esa informaci[óo]n/i;
  const shouldEscalate = rawText.includes('[ESCALAR_A_HUMANO]')
                      || SIN_RESPUESTA.test(cleanText);

  return {
    text: cleanText,
    shouldEscalate,
    retrieval,
  };
}

module.exports = { getAIResponse };
