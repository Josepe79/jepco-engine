/**
 * Genera una credencial para el panel de administración.
 *
 * Uso:
 *   node scratch/admin-user.js josep              contraseña aleatoria (recomendado)
 *   node scratch/admin-user.js josep miClave123   contraseña propia
 *
 * Imprime la cadena que hay que añadir a ADMIN_USERS. Para varias cuentas, se
 * concatenan separadas por coma.
 *
 * La contraseña no se guarda en ningún sitio: solo se almacena el hash con su
 * salt. Si se pierde, se genera una credencial nueva.
 */
const crypto = require('crypto');
const { generateCredential } = require('../src/services/auth.service');

const user     = process.argv[2];
let   password = process.argv[3];

if (!user) {
  console.error('\nFalta el nombre de usuario.\n');
  console.error('  node scratch/admin-user.js <usuario> [contraseña]\n');
  process.exit(1);
}

if (!/^[a-zA-Z0-9._-]+$/.test(user)) {
  console.error('\nEl usuario solo puede llevar letras, números, punto, guion y guion bajo.');
  console.error('Los dos puntos y la coma se usan como separadores en ADMIN_USERS.\n');
  process.exit(1);
}

let generated = false;
if (!password) {
  // 18 bytes en base64url ≈ 24 caracteres, sin ambigüedad de codificación
  password = crypto.randomBytes(18).toString('base64url');
  generated = true;
}

const credential = generateCredential(user, password);

console.log(`\n${'─'.repeat(72)}`);
console.log(`Credencial para "${user}"`);
console.log('─'.repeat(72));

if (generated) {
  console.log(`\n  CONTRASEÑA   ${password}`);
  console.log('               Guárdala ahora: no se puede recuperar después.\n');
} else {
  console.log('\n  Contraseña facilitada por línea de comandos.');
  console.log('  Recuerda que puede quedar en el historial del terminal.\n');
}

console.log('  Añade esto a ADMIN_USERS (varias cuentas se separan por coma):\n');
console.log(`  ${credential}\n`);
console.log('─'.repeat(72) + '\n');
