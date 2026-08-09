/**
 * Panel de administración: `/admin` y su API en `/api/admin/*`.
 *
 * Acceso por autenticación básica HTTP con cuentas nominales (ver
 * auth.service.js). Se eligió básica en lugar de un token en sessionStorage
 * porque el navegador se encarga de recordar la credencial: una vez validado
 * `/admin`, las llamadas `fetch` a la API la reenvían solas, sin que el panel
 * tenga que guardar nada.
 *
 * Todo acceso queda registrado con el nombre de quien lo hizo. Detrás de esto
 * hay conversaciones de empleados: permitir el acceso no basta, hay que poder
 * decir quién accedió.
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const config    = require('./config');
const auth      = require('./services/auth.service');
const analytics = require('./services/analytics.service');

const PANEL_HTML = fs.readFileSync(path.join(__dirname, 'admin', 'panel.html'), 'utf8');

const ALLOWED_DAYS = new Set([1, 7, 30, 90]);

function registerAdminRoutes(fastify) {
  const users = auth.parseUsers(config.ADMIN_USERS);

  if (users.size === 0) {
    fastify.log.warn(
      'ADMIN_USERS sin definir: el panel de administración queda deshabilitado. ' +
      'Genera credenciales con `node scratch/admin-user.js <usuario>`.'
    );
  } else {
    fastify.log.info(`Panel de administración activo · cuentas: ${[...users.keys()].join(', ')}`);
  }

  /**
   * Exige autenticación básica válida.
   * Devuelve el nombre de usuario, o null si ya ha respondido con un rechazo.
   */
  function requireAuth(request, reply) {
    if (users.size === 0) {
      reply.status(503).send({ error: 'Admin panel not configured' });
      return null;
    }

    const viewer = auth.verifyBasicAuth(users, request.headers['authorization']);
    if (!viewer) {
      // El header WWW-Authenticate es lo que hace que el navegador muestre el
      // diálogo de usuario y contraseña.
      reply
        .header('WWW-Authenticate', 'Basic realm="Jepco Engine", charset="UTF-8"')
        .status(401)
        .send({ error: 'Unauthorized' });
      return null;
    }
    return viewer;
  }

  // ── Panel ────────────────────────────────────────────────────────────────

  fastify.get('/admin', async (request, reply) => {
    const viewer = requireAuth(request, reply);
    if (!viewer) return;

    fastify.log.info({ viewer, ip: request.ip }, 'Panel abierto');

    // El script del panel va en línea, y helmet aplica `script-src 'self'`, que
    // lo bloquearía. Se autoriza con un nonce de un solo uso en lugar de abrir
    // la política con 'unsafe-inline', que valdría para cualquier inyección.
    const nonce = crypto.randomBytes(16).toString('base64');

    return reply
      .header('Content-Security-Policy', [
        "default-src 'self'",
        "base-uri 'self'",
        `script-src 'self' 'nonce-${nonce}'`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "object-src 'none'",
        "frame-ancestors 'none'",
      ].join(';'))
      .type('text/html; charset=utf-8')
      .send(PANEL_HTML.replace('__CSP_NONCE__', nonce));
  });

  // ── API ──────────────────────────────────────────────────────────────────

  fastify.get('/api/admin/overview', async (request, reply) => {
    const viewer = requireAuth(request, reply);
    if (!viewer) return;

    const brandRaw = (request.query.brand || '').trim();
    const daysRaw  = parseInt(request.query.days || '7', 10);

    if (brandRaw && !config.BRANDS[brandRaw]) {
      return reply.status(400).send({ error: 'Invalid brand' });
    }
    const days = ALLOWED_DAYS.has(daysRaw) ? daysRaw : 7;

    fastify.log.info(
      { viewer, ip: request.ip, brand: brandRaw || 'todas', days },
      'Consulta de analítica'
    );

    try {
      const data = await analytics.getOverview({ brandId: brandRaw || null, days });
      return { viewer, ...data };
    } catch (err) {
      fastify.log.error({ err }, 'Fallo generando la analítica');
      return reply.status(500).send({ error: 'Error generando la analítica' });
    }
  });

  /**
   * Detalle de una conversación completa.
   * Es el punto donde se accede a datos personales, así que el log lo refleja
   * de forma explícita y separada de las consultas agregadas.
   */
  fastify.get('/api/admin/conversation/:id', async (request, reply) => {
    const viewer = requireAuth(request, reply);
    if (!viewer) return;

    const { id } = request.params;
    fastify.log.warn(
      { viewer, ip: request.ip, conversationId: id },
      'Acceso a conversación individual'
    );

    try {
      const db = require('./services/db.service');
      const conversation = await db.conversation.findUnique({ where: { id } });
      if (!conversation) {
        return reply.status(404).send({ error: 'Not found' });
      }
      return conversation;
    } catch (err) {
      fastify.log.error({ err }, 'Fallo recuperando la conversación');
      return reply.status(500).send({ error: 'Error recuperando la conversación' });
    }
  });
}

module.exports = { registerAdminRoutes };
