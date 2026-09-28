const { Pool } = require('pg');
require('dotenv').config();

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    console.log('Enabling vector extension...');
    await pool.query('CREATE EXTENSION IF NOT EXISTS vector;');
    console.log('Extension enabled.');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}
main();
