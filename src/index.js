const fastify = require('fastify')({ logger: true, trustProxy: true });
const crypto = require('crypto');
const config = require('./config');
const telegram = require('./services/telegram.service');
const db = require('./services/db.service');
const cors = require('@fastify/cors');
const helmet = require('@fastify/helmet');
const rateLimit = require('@fastify/rate-limit');
const multipart = require('@fastify/multipart');
const fastifyStatic = require('@fastify/static');
const path = require('path');
const ingestionService = require('./services/ingestion.service');
const aiService = require('./services/ai.service');

// ── Validación de inputs ────────────────────────────────────────────────────────

const ALLOWED_BRANDS     = new Set(Object.keys(config.BRANDS));
const ALLOWED_CATEGORIES = new Set([
  // snfplus_usuario
  'acceso_navegacion', 'perfil', 'familiares', 'productos_general',
  'ahorro', 'salud', 'guarderia', 'comida', 'transporte',
  'formacion', 'renting', 'contrato_novacion',
  // snfplus_rrhh
  'administracion_empresas_sucursales', 'administracion_grupos',
  'importacion_y_actualizacion_masiva', 'gestion_usuarios',
  'seguimiento_planes', 'informes',
  // snfplus_gestor
  'onboarding_companias', 'administrar_companias', 'resumen_salud',
  'control_companias', 'contrataciones',
]);
const MAX_MESSAGE_LENGTH = 1000;

// ── Helpers ────────────────────────────────────────────────────────────────────

function validateUploadSecret(request, reply) {
  const auth = request.headers['authorization'];
  if (!config.UPLOAD_SECRET) {
    return reply.status(503).send({ error: 'Upload endpoint not configured' });
  }
  if (!auth) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  // Comparación en tiempo constante para evitar timing attacks
  const expected = `Bearer ${config.UPLOAD_SECRET}`;
  const authBuf     = Buffer.from(auth.padEnd(expected.length));
  const expectedBuf = Buffer.from(expected);
  if (authBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(authBuf, expectedBuf)) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
}

// ── Plugins ────────────────────────────────────────────────────────────────────

// Cabeceras de seguridad HTTP (X-Content-Type-Options, Referrer-Policy, etc.)
fastify.register(helmet, { global: true });

fastify.register(fastifyStatic, {
  root: path.join(__dirname, '../public'),
  prefix: '/public/',
});

fastify.register(multipart, {
  limits: { fileSize: 50 * 1024 * 1024 }
});

// CORS: configurable vía CORS_ORIGINS (coma-separado). Por defecto '*' para
// permitir que el widget se incruste en cualquier dominio de cliente.
fastify.register(cors, {
  origin: (origin, cb) => {
    const allowed = config.CORS_ORIGINS;
    if (allowed === '*') return cb(null, true);
    const list = allowed.split(',').map(o => o.trim());
    if (!origin || list.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'), false);
  }
});

// Rate limiting — global:true con límite alto de base; las rutas sensibles
// lo reducen con su propio config.rateLimit.
fastify.register(rateLimit, {
  global: true,
  max: 120,
  timeWindow: '1 minute',
  keyGenerator: (req) => req.ip,
});

// ── Rutas ──────────────────────────────────────────────────────────────────────

fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date() };
});

// Endpoint de diagnóstico — lista ficheros del directorio public
fastify.get('/debug/public-files', async (request, reply) => {
  const blocked = validateUploadSecret(request, reply);
  if (blocked) return;
  const fs = require('fs');
  const publicDir = path.join(__dirname, '../public');
  return { dir: publicDir, files: fs.readdirSync(publicDir) };
});

// Endpoint de diagnóstico — protegido con UPLOAD_SECRET
fastify.get('/debug/chat-test', async (request, reply) => {
  const blocked = validateUploadSecret(request, reply);
  if (blocked) return;
  try {
    const aiService = require('./services/ai.service');
    const result = await aiService.getAIResponse('snfplus', 'hola', []);
    return { status: 'ok', reply: result.text };
  } catch (err) {
    return reply.status(500).send({ status: 'error', message: err.message, type: err.constructor.name });
  }
});

/**
 * Web Chat — endpoint público del widget.
 * Rate limit: RATE_LIMIT_MAX req/min por IP (default 30).
 */
fastify.post('/api/chat', {
  config: {
    rateLimit: {
      max: config.RATE_LIMIT_MAX,
      timeWindow: '1 minute',
      errorResponseBuilder: () => ({
        statusCode: 429,
        error: 'Too Many Requests',
        message: 'Has enviado demasiados mensajes. Espera un momento e inténtalo de nuevo.'
      })
    }
  }
}, async (request, reply) => {
  const { brandId, userId, message, category, appUrl, mediador } = request.body;

  if (!brandId || !userId || !message) {
    return reply.status(400).send({ error: 'Missing required fields' });
  }
  if (!ALLOWED_BRANDS.has(brandId)) {
    return reply.status(400).send({ error: 'Invalid brandId' });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return reply.status(400).send({ error: 'Message too long' });
  }
  if (category && !ALLOWED_CATEGORIES.has(category)) {
    return reply.status(400).send({ error: 'Invalid category' });
  }

  try {
    const result = await telegram.handleMessage(brandId, 'WEB', userId, message, null, category, appUrl, mediador);
    return {
      reply: result.text,
      status: result.shouldEscalate ? 'escalated' : 'ok'
    };
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Internal server error' });
  }
});

/**
 * Historial de conversación — protegido con UPLOAD_SECRET.
 * Endpoint de administración, no expuesto al widget.
 */
fastify.get('/api/history/:brandId/:userId', async (request, reply) => {
  const blocked = validateUploadSecret(request, reply);
  if (blocked) return;

  const { brandId, userId } = request.params;
  try {
    const conversation = await db.conversation.findFirst({
      where: { brandId, userId }
    });
    return conversation ? conversation.history : [];
  } catch (error) {
    return reply.status(500).send({ error: 'Internal server error' });
  }
});

/**
 * Subida de conocimiento — protegido con UPLOAD_SECRET.
 */
fastify.post('/api/knowledge/upload', async (request, reply) => {
  const blocked = validateUploadSecret(request, reply);
  if (blocked) return;

  const data = await request.file();
  if (!data) {
    return reply.status(400).send({ error: 'No file uploaded' });
  }

  const { brandId } = data.fields;
  if (!brandId || !brandId.value) {
    return reply.status(400).send({ error: 'Missing brandId' });
  }

  try {
    const buffer = await data.toBuffer();
    const result = await ingestionService.processFile(
      brandId.value,
      buffer,
      data.filename,
      data.mimetype
    );
    return result;
  } catch (error) {
    const fs = require('fs');
    fs.appendFileSync('error_log.txt', `\n[${new Date().toISOString()}] UPLOAD ERROR: ${error.stack || error.message}\n`);
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Error processing file' });
  }
});

/**
 * Endpoint de subida directo (CLI/API) — protegido con UPLOAD_SECRET.
 */
fastify.post('/upload', async (request, reply) => {
  const blocked = validateUploadSecret(request, reply);
  if (blocked) return;

  console.log('>>> Upload request received');
  try {
    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    console.log(`>>> Receiving file: ${data.filename}`);
    const brandId = data.fields.brandId ? data.fields.brandId.value : 'snfplus';
    const category = data.fields.category ? data.fields.category.value : null;
    console.log(`>>> Brand ID: ${brandId}, Category: ${category}`);

    const chunks = [];
    for await (const chunk of data.file) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    console.log(`>>> Buffer created: ${buffer.length} bytes`);

    const result = await ingestionService.processFile(brandId, buffer, data.filename, data.mimetype, category);
    console.log('>>> Ingestion successful');
    return result;
  } catch (error) {
    console.error('!!! CRITICAL UPLOAD ERROR:', error);
    const fs = require('fs');
    fs.appendFileSync('error_log.txt', `\n[${new Date().toISOString()}] UPLOAD CRASH: ${error.stack}\n`);
    return reply.status(500).send({ error: 'Error processing file' });
  }
});

// ── RGPD ───────────────────────────────────────────────────────────────────────

/**
 * Elimina conversaciones con más de 90 días (retención RGPD).
 * Se ejecuta al arrancar el servidor.
 */
async function cleanupOldConversations() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  try {
    const result = await db.conversation.deleteMany({
      where: { updatedAt: { lt: cutoff } }
    });
    if (result.count > 0) {
      console.log(`RGPD cleanup: ${result.count} conversaciones eliminadas (>90 días)`);
    }
  } catch (err) {
    console.error('RGPD cleanup error:', err.message);
  }
}

/**
 * Derecho al olvido (Art. 17 RGPD).
 * El usuario puede borrar sus propias conversaciones usando el userId almacenado
 * en su localStorage. No requiere auth ya que el UUID sólo lo conoce el propio usuario.
 */
fastify.delete('/api/my-data/:userId', {
  config: {
    rateLimit: {
      max: 5,
      timeWindow: '1 minute',
      errorResponseBuilder: () => ({
        statusCode: 429,
        error: 'Too Many Requests',
        message: 'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.'
      })
    }
  }
}, async (request, reply) => {
  const { userId } = request.params;
  if (!userId || userId.length < 8) {
    return reply.status(400).send({ error: 'Invalid userId' });
  }
  try {
    await db.conversation.deleteMany({ where: { userId } });
    return { message: 'Tus datos han sido eliminados correctamente.' };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Error al eliminar datos' });
  }
});

// ── Start ──────────────────────────────────────────────────────────────────────

const start = async () => {
  try {
    await fastify.listen({ port: config.PORT, host: '0.0.0.0' });
    console.log(`Server listening on ${fastify.server.address().port}`);
    await cleanupOldConversations();
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
