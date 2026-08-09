/**
 * Autenticación básica HTTP con cuentas nominales.
 *
 * Las credenciales viven en la variable ADMIN_USERS, sin tabla ni gestión de
 * usuarios. Formato, separando cuentas por coma:
 *
 *   usuario:salt:hash,otro:salt:hash
 *
 * Se generan con `node scratch/admin-user.js <usuario>`.
 *
 * Por qué nominal y no un secreto compartido: lo que hay detrás del panel son
 * conversaciones de empleados. Con una llave única es imposible responder a
 * "quién accedió a este registro"; con cuentas por persona, el acceso queda
 * atribuido en los logs.
 */

const crypto = require('crypto');

// Parámetros de scrypt. N alto encarece el ataque por fuerza bruta sin que se
// note en un login puntual.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p,
  });
}

/**
 * Genera la cadena de credencial para pegar en ADMIN_USERS.
 */
function generateCredential(user, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt).toString('hex');
  return `${user}:${salt}:${hash}`;
}

/**
 * Convierte el valor de ADMIN_USERS en un mapa usuario → { salt, hash }.
 */
function parseUsers(raw) {
  const users = new Map();
  if (!raw) return users;

  raw.split(',').map(s => s.trim()).filter(Boolean).forEach(entry => {
    const [user, salt, hash] = entry.split(':');
    if (user && salt && hash) {
      users.set(user, { salt, hash });
    }
  });
  return users;
}

/**
 * Valida una cabecera `Authorization: Basic …`.
 * Devuelve el nombre de usuario si es válida, o null.
 *
 * No revela por tiempo de respuesta si el usuario existe: cuando no existe se
 * ejecuta igualmente un hash señuelo antes de devolver null.
 */
function verifyBasicAuth(users, headerValue) {
  if (!headerValue || !headerValue.startsWith('Basic ')) return null;

  let decoded;
  try {
    decoded = Buffer.from(headerValue.slice(6), 'base64').toString('utf8');
  } catch {
    return null;
  }

  const sep = decoded.indexOf(':');
  if (sep === -1) return null;

  const user     = decoded.slice(0, sep);
  const password = decoded.slice(sep + 1);
  const record   = users.get(user);

  if (!record) {
    hashPassword(password, 'senuelo-para-igualar-el-tiempo');
    return null;
  }

  const candidate = hashPassword(password, record.salt);
  const expected  = Buffer.from(record.hash, 'hex');

  if (candidate.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(candidate, expected)) return null;

  return user;
}

// ── Sesiones ─────────────────────────────────────────────────────────────────

const SESSION_COOKIE = 'jepco_admin';
const SESSION_TTL_S  = 8 * 60 * 60; // 8 horas: una jornada

const b64u  = buf => Buffer.from(buf).toString('base64url');
const unb64 = str => Buffer.from(str, 'base64url');

/**
 * Deriva la clave de firma de las propias credenciales configuradas.
 *
 * Así no hace falta una variable de entorno más, y además se obtiene el
 * comportamiento correcto: si se revoca una cuenta editando ADMIN_USERS, todas
 * las sesiones vivas dejan de validar automáticamente.
 */
function sessionKey(adminUsers, uploadSecret) {
  return crypto.createHash('sha256')
    .update(`jepco-admin-session|${adminUsers}|${uploadSecret || ''}`)
    .digest();
}

function createSessionToken(user, key, ttlSeconds = SESSION_TTL_S) {
  const payload   = b64u(JSON.stringify({ u: user, exp: Date.now() + ttlSeconds * 1000 }));
  const signature = b64u(crypto.createHmac('sha256', key).update(payload).digest());
  return `${payload}.${signature}`;
}

/**
 * Valida un token de sesión. Devuelve el usuario, o null.
 * La firma se compara en tiempo constante.
 */
function verifySessionToken(token, key) {
  if (!token || typeof token !== 'string') return null;

  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;

  const payload   = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  const expected = crypto.createHmac('sha256', key).update(payload).digest();
  let given;
  try {
    given = unb64(signature);
  } catch {
    return null;
  }
  if (given.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(given, expected)) return null;

  let data;
  try {
    data = JSON.parse(unb64(payload).toString('utf8'));
  } catch {
    return null;
  }
  if (!data || typeof data.u !== 'string' || typeof data.exp !== 'number') return null;
  if (Date.now() > data.exp) return null;

  return data.u;
}

/** Lee una cookie concreta de la cabecera Cookie. */
function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/**
 * Construye la cabecera Set-Cookie de la sesión.
 *
 * httpOnly    el JavaScript de la página no puede leerla
 * sameSite    no se envía desde otros sitios, lo que corta el CSRF
 * secure      solo por HTTPS (se omite en local para poder probar)
 */
function sessionCookie(token, { secure = true, maxAge = SESSION_TTL_S } = {}) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${token ? maxAge : 0}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

module.exports = {
  SESSION_COOKIE,
  generateCredential, parseUsers, verifyBasicAuth,
  sessionKey, createSessionToken, verifySessionToken,
  readCookie, sessionCookie,
};
