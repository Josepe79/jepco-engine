/**
 * Panel de administración: `/admin` y su API en `/api/admin/*`.
 *
 * ACCESO
 * ──────
 * Dos vías, ambas contra las mismas cuentas nominales de ADMIN_USERS:
 *
 *   1. Sesión con cookie firmada — es la del navegador. Login en formulario,
 *      cookie httpOnly + SameSite=Strict, y cierre de sesión de verdad (que el
 *      diálogo de autenticación básica no permite).
 *   2. Autenticación básica HTTP — para curl y scripts, sin pasar por el
 *      formulario.
 *
 * La clave que firma las sesiones se deriva de ADMIN_USERS, así que revocar una
 * cuenta editando esa variable invalida además todas las sesiones abiertas.
 *
 * Todo acceso queda registrado con el nombre de quien lo hizo: detrás de esto
 * hay conversaciones de empleados, y permitir el acceso no basta — hay que
 * poder decir quién accedió.
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const config    = require('./config');
const auth      = require('./services/auth.service');
const analytics = require('./services/analytics.service');

const PANEL_HTML = fs.readFileSync(path.join(__dirname, 'admin', 'panel.html'), 'utf8');
const LOGIN_HTML = fs.readFileSync(path.join(__dirname, 'admin', 'login.html'), 'utf8');

const ALLOWED_DAYS = new Set([1, 7, 30, 90]);

// En local no hay HTTPS, y una cookie Secure no viajaría.
const COOKIE_SECURE = process.env.NODE_ENV !== 'development';

/**
 * Impide que el navegador guarde estas páginas.
 *
 * Hacen falta por dos motivos. El funcional: sin esto, al cerrar sesión el
 * navegador servía el panel desde su caché tras el redirect, y parecía que el
 * botón "Salir" no hacía nada. El de seguridad: el panel muestra conversaciones
 * de empleados, y esas no deben quedarse en el disco de quien las consulta.
 */
function noStore(reply) {
  return reply
    .header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    .header('Pragma', 'no-cache')
    .header('Expires', '0');
}

function registerAdminRoutes(fastify) {
  const users      = auth.parseUsers(config.ADMIN_USERS);
  const signingKey = auth.sessionKey(config.ADMIN_USERS, config.UPLOAD_SECRET);

  if (users.size === 0) {
    fastify.log.warn(
      'ADMIN_USERS sin definir: el panel de administración queda deshabilitado. ' +
      'Genera credenciales con `node scratch/admin-user.js <usuario>`.'
    );
  } else {
    fastify.log.info(`Panel de administración activo · cuentas: ${[...users.keys()].join(', ')}`);
  }

  // Fastify solo interpreta JSON de serie; el formulario de login envía
  // urlencoded. Se añade el parser aquí en vez de sumar una dependencia.
  fastify.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => {
      try {
        done(null, Object.fromEntries(new URLSearchParams(body)));
      } catch (err) {
        done(err);
      }
    }
  );

  /** Identifica al visitante por cookie de sesión o por autenticación básica. */
  function identify(request) {
    const token = auth.readCookie(request.headers.cookie, auth.SESSION_COOKIE);
    const fromSession = auth.verifySessionToken(token, signingKey);
    if (fromSession && users.has(fromSession)) return fromSession;

    return auth.verifyBasicAuth(users, request.headers['authorization']);
  }

  function renderLogin(reply, errorMessage) {
    const block = errorMessage
      ? `<div class="error">${errorMessage}</div>`
      : '';
    return noStore(reply)
      .header('Content-Security-Policy',
        "default-src 'self';base-uri 'self';script-src 'none';" +
        "style-src 'self' 'unsafe-inline';form-action 'self';frame-ancestors 'none'")
      .type('text/html; charset=utf-8')
      .send(LOGIN_HTML.replace('__ERROR__', block));
  }

  /** Protege los endpoints de API. Devuelve el usuario o null si ya respondió. */
  function requireApiAuth(request, reply) {
    if (users.size === 0) {
      reply.status(503).send({ error: 'Admin panel not configured' });
      return null;
    }
    const viewer = identify(request);
    if (!viewer) {
      reply.status(401).send({ error: 'Unauthorized' });
      return null;
    }
    return viewer;
  }

  // ── Login y logout ───────────────────────────────────────────────────────

  fastify.post('/admin/login', {
    config: {
      // Freno a la fuerza bruta: scrypt ya encarece cada intento, esto limita
      // cuántos se pueden encadenar.
      rateLimit: { max: 10, timeWindow: '1 minute' },
    },
  }, async (request, reply) => {
    if (users.size === 0) {
      return reply.status(503).send({ error: 'Admin panel not configured' });
    }

    const { username = '', password = '' } = request.body || {};
    const header = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
    const viewer = auth.verifyBasicAuth(users, header);

    if (!viewer) {
      fastify.log.warn({ username, ip: request.ip }, 'Intento de acceso fallido al panel');
      return renderLogin(reply, 'Usuario o contraseña incorrectos.');
    }

    fastify.log.info({ viewer, ip: request.ip }, 'Inicio de sesión en el panel');

    return reply
      .header('Set-Cookie', auth.sessionCookie(
        auth.createSessionToken(viewer, signingKey),
        { secure: COOKIE_SECURE }
      ))
      .redirect('/admin', 303);
  });

  fastify.post('/admin/logout', async (request, reply) => {
    const viewer = identify(request);
    if (viewer) fastify.log.info({ viewer, ip: request.ip }, 'Cierre de sesión');

    return noStore(reply)
      .header('Set-Cookie', auth.sessionCookie('', { secure: COOKIE_SECURE }))
      .redirect('/admin', 303);
  });

  // ── Panel ────────────────────────────────────────────────────────────────

  fastify.get('/admin', async (request, reply) => {
    if (users.size === 0) {
      return reply.status(503).send({ error: 'Admin panel not configured' });
    }

    const viewer = identify(request);
    if (!viewer) return renderLogin(reply, '');

    fastify.log.info({ viewer, ip: request.ip }, 'Panel abierto');

    // El script del panel va en línea, y helmet aplica `script-src 'self'`, que
    // lo bloquearía. Se autoriza con un nonce de un solo uso en lugar de abrir
    // la política con 'unsafe-inline', que valdría para cualquier inyección.
    const nonce = crypto.randomBytes(16).toString('base64');

    return noStore(reply)
      .header('Content-Security-Policy', [
        "default-src 'self'",
        "base-uri 'self'",
        `script-src 'self' 'nonce-${nonce}'`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "object-src 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join(';'))
      .type('text/html; charset=utf-8')
      .send(PANEL_HTML.replace('__CSP_NONCE__', nonce));
  });

  // ── API ──────────────────────────────────────────────────────────────────

  fastify.get('/api/admin/overview', async (request, reply) => {
    const viewer = requireApiAuth(request, reply);
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
      noStore(reply);
      return { viewer, ...data };
    } catch (err) {
      fastify.log.error({ err }, 'Fallo generando la analítica');
      return reply.status(500).send({ error: 'Error generando la analítica' });
    }
  });

  /**
   * Detalle de una conversación completa.
   * Es el punto donde se accede a datos personales, así que se registra con
   * nivel warn, separado de las consultas agregadas.
   */
  fastify.get('/api/admin/conversation/:id', async (request, reply) => {
    const viewer = requireApiAuth(request, reply);
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
      noStore(reply);
      return conversation;
    } catch (err) {
      fastify.log.error({ err }, 'Fallo recuperando la conversación');
      return reply.status(500).send({ error: 'Error recuperando la conversación' });
    }
  });
}

module.exports = { registerAdminRoutes };
