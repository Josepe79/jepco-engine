const { Telegraf } = require('telegraf');
const config = require('../config');
const db = require('./db.service');
const ai = require('./ai.service');

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function stripMarkdown(text) {
  return String(text)
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/`{1,3}(.*?)`{1,3}/gs, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#+\s+/gm, '')
    .trim();
}

const adminBot = config.ADMIN_BOT_TOKEN ? new Telegraf(config.ADMIN_BOT_TOKEN) : null;
const bots = {};

// Initialize brand bots
Object.entries(config.BOT_TOKENS).forEach(([brandId, token]) => {
  if (token) {
    const bot = new Telegraf(token);
    bot.on('text', (ctx) => handleMessage(brandId, 'TELEGRAM', ctx.from.id.toString(), ctx.message.text, ctx));
    bot.catch((err, ctx) => {
      console.error(`Error in bot ${brandId}:`, err);
    });
    bot.launch().catch(err => console.error(`Failed to launch bot ${brandId}:`, err));
    bots[brandId] = bot;
    console.log(`Bot for ${brandId} launched.`);
  }
});

/**
 * Registra un intercambio para análisis posterior.
 *
 * Nunca lanza: la telemetría no puede tumbar una conversación. Si falla, se
 * pierde ese registro y el usuario ni se entera.
 */
async function recordInteraction(data) {
  try {
    await db.interaction.create({ data });
  } catch (err) {
    console.error('No se pudo registrar la interacción:', err.message);
  }
}

async function handleMessage(brandId, platform, userId, text, ctx = null, category = null, appUrl = null, mediador = null) {
  const startedAt = Date.now();
  try {
    // 1. Get or create conversation
    let conversation = await db.conversation.findFirst({
      where: { userId, brandId }
    });

    if (!conversation) {
      conversation = await db.conversation.create({
        data: {
          userId,
          platform,
          brandId,
          history: []
        }
      });
    }

    // 2. Add user message to history
    const history = Array.isArray(conversation.history) ? conversation.history : [];
    history.push({ role: 'user', text, timestamp: new Date() });

    // 3. Get AI response
    const aiResult = await ai.getAIResponse(brandId, text, history, category, appUrl, mediador);

    // 4. Update history with AI response
    history.push({ role: 'ai', text: aiResult.text, timestamp: new Date() });

    await db.conversation.update({
      where: { id: conversation.id },
      data: {
        history,
        status: aiResult.shouldEscalate ? 'ESCALATED' : 'PENDING'
      }
    });

    // 4b. Registrar el intercambio con la telemetría de recuperación.
    //     A diferencia de `status`, esto es inmutable: un escalado queda
    //     registrado aunque la siguiente pregunta se resuelva bien.
    const r = aiResult.retrieval || {};
    await recordInteraction({
      brandId,
      conversationId:   conversation.id,
      question:         text,
      answer:           aiResult.text,
      category:         category || null,
      categoryFallback: Boolean(r.categoryFallback),
      chunksFound:      r.chunksFound   ?? 0,
      topSimilarity:    r.topSimilarity ?? null,
      chunkIds:         r.chunkIds      ?? [],
      escalated:        Boolean(aiResult.shouldEscalate),
      latencyMs:        Date.now() - startedAt,
    });

    // 5. Send response to user — always plain text to avoid Telegram entity parse errors
    if (platform === 'TELEGRAM' && ctx) {
      const plainText = stripMarkdown(aiResult.text);
      try {
        await ctx.reply(plainText);
      } catch (tgError) {
        console.error('Error sending to Telegram:', tgError);
        await ctx.reply('Lo siento, ha ocurrido un error al enviar la respuesta.');
      }
    }

    // 6. If escalated, notify Admin using HTML parse_mode with escaped content
    if (aiResult.shouldEscalate && adminBot && config.ADMIN_TELEGRAM_CHAT_ID) {
      await adminBot.telegram.sendMessage(
        config.ADMIN_TELEGRAM_CHAT_ID,
        `🚨 <b>ESCALAMIENTO - ${escapeHtml(brandId.toUpperCase())}</b>\n\n<b>Usuario:</b> ${escapeHtml(userId)}\n<b>Mensaje:</b> ${escapeHtml(text)}\n\n<b>Respuesta IA:</b> ${escapeHtml(aiResult.text)}\n\nResponde desde el bot correspondiente.`,
        { parse_mode: 'HTML' }
      );
    }

    return aiResult;
  } catch (error) {
    const logMessage = `\n[${new Date().toISOString()}] BOT ERROR: ${error.stack || error.message}\n`;
    require('fs').appendFileSync('error_log.txt', logMessage);
    console.error('Error handling message:', error);
    if (ctx) ctx.reply('Lo siento, ha ocurrido un error interno.');
    throw error;
  }
}

module.exports = { bots, adminBot, handleMessage };
