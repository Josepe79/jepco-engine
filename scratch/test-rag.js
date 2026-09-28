require('dotenv').config();
const vectorService = require('../src/services/vector.service');

async function test() {
  console.log('Testing embedding generation...');
  try {
    const embedding = await vectorService.generateEmbedding('Hola, ¿cómo estás?');
    console.log('Embedding length:', embedding.length);
    if (embedding.length === 768) {
      console.log('✅ Embedding generation successful!');
    } else {
      console.log('❌ Unexpected embedding length:', embedding.length);
    }

    console.log('Testing similarity search (empty DB)...');
    const results = await vectorService.findSimilarDocuments('saludflex', embedding, 1);
    console.log('Search completed. Results:', results.length);
    console.log('✅ Similarity search logic works (even if no results found).');
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

test();
