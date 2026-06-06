const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config');
const vectorService = require('./vector.service');

const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY, { apiVersion: 'v1' });

async function getAIResponse(brandId, userMessage, history = [], category = null) {
  const brand = config.BRANDS[brandId];
  if (!brand) throw new Error('Unknown brand');

  // 1. Obtener contexto relevante de la base de conocimientos
  let context = '';
  try {
    const queryEmbedding = await vectorService.generateEmbedding(userMessage);
    let similarChunks = await vectorService.findSimilarDocuments(brandId, queryEmbedding, 3, category);
    
    // Si no hay resultados en la categoría específica, buscar en la general
    if (similarChunks.length === 0 && category !== null) {
      console.log(`>>> No context for ${category}, falling back to general...`);
      similarChunks = await vectorService.findSimilarDocuments(brandId, queryEmbedding, 3, null);
    }
    
    if (similarChunks.length > 0) {
      context = similarChunks.map(c => c.content).join('\n---\n');
    }
  } catch (err) {
    console.error('Error retrieving context:', err);
  }

  const model = genAI.getGenerativeModel({ 
    model: 'gemini-2.5-flash-lite',
    generationConfig: {
      maxOutputTokens: 2048,
      temperature: 0.7,
    }
  }, { apiVersion: 'v1beta' });

  const systemInstruction = `
    Eres el asistente inteligente de la marca ${brand.name}.
    Tu personalidad: ${brand.personality}
    Tu conocimiento base general: ${brand.manual}
    
    INFORMACIÓN ESPECÍFICA RECUPERADA (Usa esto para responder si es relevante):
    ${context || 'No se encontró información específica adicional.'}
    
    Instrucciones críticas:
    1. Responde de forma concisa y útil.
    2. Si el usuario pregunta o menciona temas de "Salud" (seguro médico, pólizas, coberturas de salud, etc.), indícale amablemente que para esos casos debe dirigirse al mediador de la póliza.
    3. Si el usuario hace una pregunta técnica compleja sobre temas legales que no están en el manual, o si detectas que el usuario necesita atención humana urgente, di exactamente: "[ESCALAR_A_HUMANO]" al inicio de tu respuesta.
    4. Si no estás seguro de la respuesta, di: "[ESCALAR_A_HUMANO] Lo siento, no tengo esa información específica ahora mismo, pero he pasado tu consulta a Josep para que te responda personalmente."
  `;

  // Format history for Gemini
  const chatHistory = history.map(msg => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [{ text: msg.text }]
  }));

  const chat = model.startChat({
    history: chatHistory,
    generationConfig: {
      maxOutputTokens: 500,
    },
  });

  const prompt = `${systemInstruction}\n\nMensaje del usuario: ${userMessage}`;
  let result;
  try {
    result = await chat.sendMessage(prompt);
  } catch (geminiError) {
    const msg = geminiError.message || '';
    if (msg.includes('429') || msg.includes('quota') || msg.includes('Too Many Requests')) {
      return {
        text: 'En este momento el asistente está recibiendo muchas consultas. Por favor, inténtalo de nuevo en unos segundos.',
        shouldEscalate: false
      };
    }
    if (msg.includes('503') || msg.includes('Service Unavailable')) {
      return {
        text: 'El asistente no está disponible temporalmente. Por favor, inténtalo de nuevo en unos minutos.',
        shouldEscalate: false
      };
    }
    throw geminiError;
  }

  const responseText = result.response.text();
  const shouldEscalate = responseText.includes('[ESCALAR_A_HUMANO]');

  return {
    text: responseText.replace('[ESCALAR_A_HUMANO]', '').trim(),
    shouldEscalate
  };
}

module.exports = { getAIResponse };
