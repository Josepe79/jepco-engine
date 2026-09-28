const { Client } = require('pg');
require('dotenv').config();

async function check() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  await client.connect();
  
  const res = await client.query('SELECT COUNT(*) FROM "KnowledgeChunk"');
  console.log('Total chunks in DB:', res.rows[0].count);
  
  const categories = await client.query('SELECT category, COUNT(*) FROM "KnowledgeChunk" GROUP BY category');
  console.log('Categories found:', categories.rows);
  
  await client.end();
}

check().catch(console.error);
