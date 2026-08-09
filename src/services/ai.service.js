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
 * Cuántos fragmentos se pasan como contexto.
 *
 * Era 3, y con los proveedores se quedó corto: una categoría contiene ahora el
 * fragmento genérico más los del emisor, y quedaba fuera justo el que respondía
 * la pregunta. Subirlo a 5 tampoco bastó — comida ya tiene 6 — y el síntoma es
 * traicionero, porque la misma pregunta se responde o se escala según cómo
 * ordene la similitud ese día.
 *
 * A 8 cabe una categoría entera con un proveedor activo y sobra margen. Como el
 * filtro por marca, categoría y proveedor ya acota mucho, subirlo no infla el
 * prompt de forma apreciable. Si una categoría llegara a superar los 8
 * fragmentos, habrá que volver aquí.
 */
const RETRIEVAL_LIMIT = 8;

/** Nombres legibles de los emisores, para nombrarlos en el prompt. */
const PROVIDER_LABELS = {
  edenred:  'Edenred',
  pluxee:   'Pluxee',
  up_spain: 'Up Spain',
};

/**
 * @param {object} options  Contexto del entorno que incrusta el widget.
 *   Va en objeto y no como parámetros sueltos porque ya son demasiados: cuando
 *   eran posicionales, `category` acabó colándose en el hueco de `ctx` y la
 *   categoría no llegaba nunca al RAG.
 */
async function getAIResponse(brandId, userMessage, history = [], options = {}) {
  const brand = config.BRANDS[brandId];
  if (!brand) throw new Error('Unknown brand');

  const { category = null, appUrl = null, provider = null,
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
    let similarChunks = await vectorService.findSimilarDocuments(brandId, queryEmbedding, RETRIEVAL_LIMIT, category, provider);

    // Si la categoría pedida no devuelve nada, se reintenta sin filtro.
    // Que esto ocurra es en sí una señal: esa categoría no tiene contenido.
    if (similarChunks.length === 0 && category !== null) {
      retrieval.categoryFallback = true;
      similarChunks = await vectorService.findSimilarDocuments(brandId, queryEmbedding, 3, null, provider);
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

CONTEXTO DE ESTA CONSULTA:
${category ? `El usuario pregunta por la sección "${category}". Lee toda su pregunta en ese contexto, aunque no lo mencione. Esto te dice de QUÉ habla, no lo que debes contestar: la respuesta sigue teniendo que salir de la INFORMACIÓN RECUPERADA.` : 'El usuario no ha indicado sección: es una pregunta abierta.'}
${provider && PROVIDER_LABELS[provider] ? `Su tarjeta la emite ${PROVIDER_LABELS[provider]}, así que la INFORMACIÓN RECUPERADA sobre ese emisor es la que le aplica.` : ''}

INFORMACIÓN RECUPERADA (úsala si es relevante):
${context || 'Sin información adicional.'}

CÓMO DECIDIR QUÉ RESPONDER — sigue estos dos pasos en orden:

PASO 1. Busca el dato en la INFORMACIÓN RECUPERADA. Es tu única fuente: no uses conocimiento propio sobre seguros, fiscalidad, productos financieros ni legislación.

PASO 2. Según lo que encuentres:
   a) Si el dato está, respóndelo. También cuando la respuesta sea negativa: si el contexto dice que algo no se puede hacer, dilo con naturalidad ("No, la tarjeta no sirve para eso"). No escales por prudencia habiendo encontrado la respuesta.
   b) Si el dato no está, escala con el formato de abajo. No lo deduzcas ni lo completes: que no se mencione una limitación no significa que no exista, así que nunca inventes cosas como "se puede usar en cualquier sitio".

CÓMO ESCALAR:
   Empieza obligatoriamente por "[ESCALAR_A_HUMANO]", una sola vez y al principio, sin explicarla ni mencionarla. Después:
   - SOLO si la duda es sobre coberturas o condiciones del SEGURO DE SALUD: "No tengo esa información. Esa consulta la resuelve tu mediador: ${mediadorRef}."
   - En cualquier otro caso, incluidas las tarjetas de comida, guardería y transporte: "No tengo esa información. Consúltalo con ${brand.escalationFallback || 'el equipo de soporte'}."
   El mediador es de seguros: no lo menciones nunca fuera de dudas de la póliza de salud.
   Y nunca digas que has avisado a alguien o que van a contactar al usuario: no es cierto y no puede cumplirse.

CASO ESPECIAL, SEGURO DE SALUD — tiene dos mitades que se tratan distinto:
   - FISCALIDAD Y FUNCIONAMIENTO (límites de importe, quién puede incluirse, edad de los hijos, discapacidad, duración del contrato, requisitos, cómo se contrata): esto sí lo sabes. Respóndelo y no derives al mediador.
   - COBERTURAS Y CONDICIONES DE LA PÓLIZA (qué incluye o excluye, cuadro médico, especialidades, reembolsos, reclamaciones, altas y bajas con la aseguradora): esto no lo sabes. Deriva al mediador: ${mediadorRef}.
   - Si la pregunta es genérica o ambigua, responde la parte fiscal y cierra indicando que para coberturas concretas contacte con el mediador. Ahí NO escales: sí has respondido.

FORMA DE ESCRIBIR:
   Máximo 3 frases cortas, nunca más. Lenguaje simple y directo, como por WhatsApp. Solo texto plano: sin asteriscos, negritas, guiones, listas ni títulos. Nada de introducciones tipo "¡Claro!" o "Por supuesto": ve directo a la respuesta, sin repetir la pregunta.`;

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash-lite',
    systemInstruction,
    generationConfig: {
      maxOutputTokens: 150,
      // Bajado de 0.5: esto es soporte factual, no redacción creativa. Con 0.5
      // la misma pregunta unas veces se respondía y otras se escalaba, teniendo
      // el dato delante en ambos casos.
      temperature: 0.2,
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

  // El escalado se decide por el TEXTO, no por la etiqueta del modelo.
  //
  // La etiqueta falla en las dos direcciones: unas veces responde "No tengo esa
  // información" y se olvida de ponerla — y el hueco se perdía sin aparecer en
  // el panel —, y otras la pone y a continuación responde perfectamente, lo que
  // llenaba el panel de huecos inexistentes.
  //
  // El texto sí es fiable porque su redacción exacta la imponemos en el prompt:
  // toda respuesta de "no lo sé" empieza por esa frase. La etiqueta se sigue
  // limpiando de la salida, pero ya no decide nada.
  const SIN_RESPUESTA = /^\s*no tengo esa informaci[óo]n/i;
  const shouldEscalate = SIN_RESPUESTA.test(cleanText);

  return {
    text: cleanText,
    shouldEscalate,
    retrieval,
  };
}

module.exports = { getAIResponse };
