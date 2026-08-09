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

module.exports = { generateCredential, parseUsers, verifyBasicAuth };
