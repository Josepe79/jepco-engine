const { Client } = require('pg');
require('dotenv').config();

async function enableVector() {
  // Extraemos los datos de la URL manual o usamos pg directamente
  const connectionString = process.env.DATABASE_URL;
  const client = new Client({ connectionString });

  try {
    await client.connect();
    console.log('Connecting to database...');
    await client.query('CREATE EXTENSION IF NOT EXISTS vector;');
    console.log('✅ Extension "vector" enabled successfully!');
  } catch (err) {
    console.error('❌ Error enabling vector extension:', err.message);
  } finally {
    await client.end();
  }
}

enableVector();
