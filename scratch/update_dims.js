const { Pool } = require('pg');
require('dotenv').config();

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    console.log('Connecting to database...');
    const client = await pool.connect();
    console.log('Updating vector column to 768 dimensions...');
    await client.query('ALTER TABLE "KnowledgeChunk" ALTER COLUMN "embedding" TYPE vector(768);');
    console.log('Successfully updated to 768 dimensions.');
    client.release();
  } catch (err) {
    console.error('Error updating dimensions:', err.message);
  } finally {
    await pool.end();
  }
}

main();
