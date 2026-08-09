/**
 * Jepco Engine — servidor principal.
 *
 * ORDEN DE ARRANQUE (importante, no reordenar sin leer esto)
 * ──────────────────────────────────────────────────────────
 * Fastify aplica los hooks `onRequest` únicamente a las rutas que se registran
 * DESPUÉS de que el hook exista. `fastify.register()` es diferido: encola el
 * plugin y no lo carga hasta `listen()`/`ready()`.
 *
 * Por eso, si las rutas se declaran a nivel de módulo (como estaba antes), el
 * plugin de rate limit todavía no ha instalado su hook cuando esas rutas entran
 * en el árbol, y el límite NUNCA se aplica — ni el global ni el `config.rateLimit`
 * de cada ruta. El síntoma es que las peticiones pasan todas y no aparece ninguna
 * cabecera `x-ratelimit-*`.
 *
 * La solución es la secuencia de `start()`:
 *   1. await registerPlugins()   → los hooks quedan instalados
 *   2. registerRoutes()          → las rutas heredan esos hooks
 *   3. await fastify.listen()
 */

const fastify = require('fastify')({
  logger: true,
  // Railway sirve detrás de un proxy. Sin esto, `req.ip` devuelve la IP interna
  // del proxy y todos los visitantes comparten la misma clave de rate limit.
  trustProxy: true,
});

const crypto        = require('crypto');
const path          = require('path');
const config        = require('./config');
const telegram      = require('./services/telegram.service');
const db            = require('./services/db.service');
const cors          = require('@fastify/cors');
const helmet        = require('@fastify/helmet');
const rateLimit     = require('@fastify/rate-limit');
const multipart     = require('@fastify/multipart');
const fastifyStatic = require('@fastify/static');
const ingestionService = require('./services/ingestion.service');
const { registerAdminRoutes } = require('./admin.routes');

// ── Validación de inputs ───────────────────────────────────────────────────────

const ALLOWED_BRANDS     = new Set(Object.keys(config.BRANDS));
const ALLOWED_CATEGORIES = new Set([
  // snfplus_usuario
  'acceso_navegacion', 'perfil', 'familiares', 'productos_general',
  'ahorro', 'salud', 'guarderia', 'comida', 'transporte',
  'formacion', 'renting', 'contrato_novacion', 'retribucion_general',
  // snfplus_rrhh
  'administracion_empresas_sucursales', 'administracion_grupos',
  'importacion_y_actualizacion_masiva', 'gestion_usuarios',
  'seguimiento_planes', 'informes',
  // snfplus_gestor
  'onboarding_companias', 'administrar_companias', 'resumen_salud',
  'control_companias', 'contrataciones',
]);
const MAX_MESSAGE_LENGTH = 1000;

// Emisores de tarjeta configurados. Solo afectan a Comida, Guardería y
// Transporte: son quienes emiten la tarjeta y determinan dónde se usa, con qué
// app y a quién se llama. La parte fiscal es igual con cualquiera de ellos.
//
// Hubo un cuarto, `up_one`, que resultó no ser un emisor: venía de un cambio de
// productos de Up Spain, y UpONE es su plataforma digital.
const ALLOWED_PROVIDERS = new Set(['edenred', 'pluxee', 'up_spain']);

// ── CORS ───────────────────────────────────────────────────────────────────────

/**
 * Política de orígenes, resuelta una sola vez al arrancar.
 *
 * CORS_ORIGINS admite:
 *   - '*'                          → cualquier origen (solo para desarrollo)
 *   - 'https://app.ejemplo.com'    → origen exacto
 *   - '*.ejemplo.com'              → cualquier subdominio de ejemplo.com
 *   - varios valores separados por coma
 *
 * Nota: esto NO afecta a la carga del widget. Una etiqueta <script src> no pasa
 * por CORS, así que `/public/snfplus-widget.js` se sigue sirviendo a cualquiera.
 * Lo que se protege son las llamadas a /api/*, que son las que cuestan dinero.
 */
const CORS_ALLOW_ALL = config.CORS_ORIGINS.trim() === '*';
const CORS_RULES = CORS_ALLOW_ALL
  ? []
  : config.CORS_ORIGINS.split(',').map(o => o.trim()).filter(Boolean);

function isOriginAllowed(origin) {
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    return false; // Origin malformado
  }

  return CORS_RULES.some(rule => {
    if (rule.startsWith('*.')) {
      const bare = rule.slice(2);           // '*.ejemplo.com' → 'ejemplo.com'
      return host === bare || host.endsWith(`.${bare}`);
    }
    // Comparación por origen completo (esquema + host + puerto)
    try {
      return new URL(rule).origin === new URL(origin).origin;
    } catch {
      return rule === origin;
    }
  });
}

/**
 * Decide si una petición concreta puede pasar la política de orígenes.
 *
 * Se permite en tres casos:
 *   - Ficheros estáticos: el widget debe poder cargarse desde cualquier web.
 *   - Sin cabecera Origin: no hay contexto de navegador (health checks de
 *     Railway, curl, llamadas servidor a servidor). CORS solo protege al
 *     navegador, así que bloquear aquí no aportaría seguridad.
 *   - Origen incluido en CORS_ORIGINS.
 */
function isRequestOriginAllowed(request) {
  if (request.url.startsWith('/public/')) return true;

  const origin = request.headers.origin;
  if (!origin) return true;
  if (CORS_ALLOW_ALL) return true;

  return isOriginAllowed(origin);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Valida el header Authorization contra UPLOAD_SECRET en tiempo constante.
 * Devuelve un valor truthy si la petición ha sido rechazada (el llamante debe
 * hacer `return` inmediatamente).
 */
function validateUploadSecret(request, reply) {
  const auth = request.headers['authorization'];
  if (!config.UPLOAD_SECRET) {
    return reply.status(503).send({ error: 'Upload endpoint not configured' });
  }
  if (!auth) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  // Comparación en tiempo constante para evitar timing attacks
  const expected    = `Bearer ${config.UPLOAD_SECRET}`;
  const authBuf     = Buffer.from(auth.padEnd(expected.length));
  const expectedBuf = Buffer.from(expected);
  if (authBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(authBuf, expectedBuf)) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
}

// ── Plugins ────────────────────────────────────────────────────────────────────

/**
 * Registra todos los plugins y ESPERA a que estén cargados.
 * El `await` es lo que garantiza que sus hooks existan antes de las rutas.
 */
async function registerPlugins() {
  // Cabeceras de seguridad HTTP (CSP, X-Content-Type-Options, HSTS, etc.)
  await fastify.register(helmet);

  await fastify.register(fastifyStatic, {
    root:   path.join(__dirname, '../public'),
    prefix: '/public/',
  });

  await fastify.register(multipart, {
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  // El plugin gestiona el preflight y las cabeceras Access-Control-*.
  // Se usa la forma delegada para poder mirar la URL además del origen.
  await fastify.register(cors, () => (req, cb) => {
    cb(null, { origin: isRequestOriginAllowed(req) });
  });

  // Cortafuegos explícito sobre /api/*.
  //
  // El plugin de CORS por sí solo se limita a no enviar las cabeceras, y es el
  // navegador quien bloquea la respuesta — pero el servidor ya habría hecho el
  // trabajo, incluida la llamada de pago a Gemini. Este hook corta antes.
  fastify.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    if (isRequestOriginAllowed(request)) return;

    fastify.log.warn(
      { origin: request.headers.origin, url: request.url },
      'CORS: petición rechazada'
    );
    return reply.status(403).send({ error: 'Origin not allowed' });
  });

  // Rate limiting global. Es la red de seguridad de base; las rutas sensibles
  // bajan el límite con su propio `config.rateLimit`.
  await fastify.register(rateLimit, {
    global:       true,
    max:          config.RATE_LIMIT_GLOBAL_MAX,
    timeWindow:   '1 minute',
    // Con trustProxy activo, `req.ip` es la IP real del cliente (X-Forwarded-For).
    keyGenerator: (req) => req.ip,
  });
}

// ── Rutas ──────────────────────────────────────────────────────────────────────

/**
 * Declara las rutas. Debe llamarse DESPUÉS de `registerPlugins()` — ver la nota
 * de orden de arranque en la cabecera del fichero.
 */
function registerRoutes() {

  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date() };
  });

  // Panel de administración: /admin y /api/admin/*
  registerAdminRoutes(fastify);

  /**
   * Web Chat — endpoint público del widget.
   * Rate limit: RATE_LIMIT_MAX peticiones/minuto por IP (por defecto 30).
   */
  fastify.post('/api/chat', {
    config: {
      rateLimit: {
        max:        config.RATE_LIMIT_MAX,
        timeWindow: '1 minute',
        errorResponseBuilder: () => ({
          statusCode: 429,
          error:      'Too Many Requests',
          message:    'Has enviado demasiados mensajes. Espera un momento e inténtalo de nuevo.',
        }),
      },
    },
  }, async (request, reply) => {
    const { brandId, userId, message, category, provider,
            appUrl, mediador, mediadorEmail, mediadorTel } = request.body || {};

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
    if (provider && !ALLOWED_PROVIDERS.has(provider)) {
      return reply.status(400).send({ error: 'Invalid provider' });
    }

    try {
      const result = await telegram.handleMessage(
        brandId, 'WEB', userId, message, null,
        { category, provider, appUrl, mediador, mediadorEmail, mediadorTel }
      );
      return {
        reply:  result.text,
        status: result.shouldEscalate ? 'escalated' : 'ok',
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
        where: { brandId, userId },
      });
      return conversation ? conversation.history : [];
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * Diagnóstico de la cadena RAG + Gemini — protegido con UPLOAD_SECRET.
   */
  fastify.get('/debug/chat-test', async (request, reply) => {
    const blocked = validateUploadSecret(request, reply);
    if (blocked) return;
    try {
      const aiService = require('./services/ai.service');
      const result = await aiService.getAIResponse('snfplus_usuario', 'hola', []);
      return { status: 'ok', reply: result.text };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ status: 'error', message: err.message });
    }
  });

  /**
   * Subida de conocimiento vía formulario — protegido con UPLOAD_SECRET.
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
      return await ingestionService.processFile(
        brandId.value, buffer, data.filename, data.mimetype
      );
    } catch (error) {
      fastify.log.error({ err: error }, 'Error procesando fichero de conocimiento');
      return reply.status(500).send({ error: 'Error processing file' });
    }
  });

  /**
   * Subida de conocimiento vía CLI/API — protegido con UPLOAD_SECRET.
   * Acepta `category` para clasificar el contenido.
   */
  fastify.post('/upload', async (request, reply) => {
    const blocked = validateUploadSecret(request, reply);
    if (blocked) return;

    try {
      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: 'No file uploaded' });
      }

      const brandId  = data.fields.brandId  ? data.fields.brandId.value  : 'snfplus_usuario';
      const category = data.fields.category ? data.fields.category.value : null;
      fastify.log.info({ filename: data.filename, brandId, category }, 'Ingesta iniciada');

      const chunks = [];
      for await (const chunk of data.file) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);

      const result = await ingestionService.processFile(
        brandId, buffer, data.filename, data.mimetype, category
      );
      fastify.log.info('Ingesta completada');
      return result;
    } catch (error) {
      fastify.log.error({ err: error }, 'Fallo crítico en la ingesta');
      return reply.status(500).send({ error: 'Error processing file' });
    }
  });

  /**
   * Derecho de supresión (Art. 17 RGPD).
   *
   * No lleva autenticación porque el identificador solo lo conoce el propio
   * usuario: es su UUID de localStorage. El límite de 5/minuto evita que alguien
   * pueda barrer identificadores a fuerza bruta.
   */
  fastify.delete('/api/my-data/:userId', {
    config: {
      rateLimit: {
        max:        5,
        timeWindow: '1 minute',
        errorResponseBuilder: () => ({
          statusCode: 429,
          error:      'Too Many Requests',
          message:    'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.',
        }),
      },
    },
  }, async (request, reply) => {
    const { userId } = request.params;
    if (!userId || userId.length < 8) {
      return reply.status(400).send({ error: 'Invalid userId' });
    }
    try {
      // La telemetría se enlaza por conversationId, no por userId, así que hay
      // que resolver las conversaciones antes de borrarlas.
      const conversations = await db.conversation.findMany({
        where:  { userId },
        select: { id: true },
      });
      const conversationIds = conversations.map(c => c.id);

      if (conversationIds.length > 0) {
        await db.interaction.deleteMany({
          where: { conversationId: { in: conversationIds } },
        });
      }
      await db.conversation.deleteMany({ where: { userId } });

      return { message: 'Tus datos han sido eliminados correctamente.' };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Error al eliminar datos' });
    }
  });
}

// ── RGPD ───────────────────────────────────────────────────────────────────────

/**
 * Elimina datos con más de 90 días (política de retención).
 * Se ejecuta una vez al arrancar el servidor.
 *
 * Cubre también la telemetría de interacciones: contiene el texto literal de
 * las preguntas, así que se rige por la misma ventana. El aprendizaje que sale
 * de esos datos debe consolidarse en fragmentos de conocimiento antes de que
 * caduquen — que es justo el flujo de trabajo previsto.
 */
async function cleanupOldData() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);

  try {
    const conversations = await db.conversation.deleteMany({
      where: { updatedAt: { lt: cutoff } },
    });
    if (conversations.count > 0) {
      fastify.log.info(`RGPD: ${conversations.count} conversaciones eliminadas (>90 días)`);
    }
  } catch (err) {
    fastify.log.error({ err }, 'Fallo en la limpieza de conversaciones');
  }

  try {
    const interactions = await db.interaction.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    if (interactions.count > 0) {
      fastify.log.info(`RGPD: ${interactions.count} interacciones eliminadas (>90 días)`);
    }
  } catch (err) {
    fastify.log.error({ err }, 'Fallo en la limpieza de interacciones');
  }
}

// ── Arranque ───────────────────────────────────────────────────────────────────

const start = async () => {
  try {
    await registerPlugins();   // 1. hooks instalados
    registerRoutes();          // 2. rutas heredan los hooks
    await fastify.listen({ port: config.PORT, host: '0.0.0.0' });

    fastify.log.info(
      `Rate limit — global: ${config.RATE_LIMIT_GLOBAL_MAX}/min · /api/chat: ${config.RATE_LIMIT_MAX}/min · borrado: 5/min`
    );

    if (CORS_ALLOW_ALL) {
      fastify.log.warn(
        'CORS abierto a cualquier origen. Define CORS_ORIGINS con los dominios ' +
        'reales antes de exponer el servicio a usuarios finales.'
      );
    } else {
      fastify.log.info(`CORS restringido a: ${CORS_RULES.join(', ')}`);
    }

    await cleanupOldData();
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
