const fastify = require('fastify')({ logger: true });
const config = require('./config');
const telegram = require('./services/telegram.service');
const db = require('./services/db.service');
const cors = require('@fastify/cors');
const multipart = require('@fastify/multipart');
const fastifyStatic = require('@fastify/static');
const path = require('path');
const ingestionService = require('./services/ingestion.service');
const aiService = require('./services/ai.service');

// Register Static Files (for widgets)
fastify.register(fastifyStatic, {
  root: path.join(__dirname, '../public'),
  prefix: '/public/', // Files will be at http://localhost:3001/public/...
});

// Register Multipart
fastify.register(multipart, {
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB
  }
});

// Register CORS
fastify.register(cors, {
  origin: '*', // Adjust for production
});

// Health check
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date() };
});

/**
 * Web Chat Endpoint (REST)
 * Used by the frontend widget to send messages
 */
fastify.post('/api/chat', async (request, reply) => {
  const { brandId, userId, message, category } = request.body;

  if (!brandId || !userId || !message) {
    return reply.status(400).send({ error: 'Missing required fields' });
  }

  try {
    const result = await telegram.handleMessage(brandId, 'WEB', userId, message, category);
    return {
      reply: result.text,
      status: result.shouldEscalate ? 'escalated' : 'ok'
    };
  } catch (error) {
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Internal server error' });
  }
});

/**
 * Get Conversation History
 */
fastify.get('/api/history/:brandId/:userId', async (request, reply) => {
  const { brandId, userId } = request.params;

  try {
    const conversation = await db.conversation.findFirst({
      where: { brandId, userId }
    });
    return conversation ? conversation.history : [];
  } catch (error) {
    return reply.status(500).send({ error: 'Internal server error' });
  }
});

/**
 * Knowledge Base Upload
 */
fastify.post('/api/knowledge/upload', async (request, reply) => {
  const data = await request.file();
  if (!data) {
    return reply.status(400).send({ error: 'No file uploaded' });
  }

  const { brandId } = data.fields;
  if (!brandId || !brandId.value) {
    return reply.status(400).send({ error: 'Missing brandId' });
  }

  try {
    const buffer = await data.toBuffer();
    const result = await ingestionService.processFile(
      brandId.value,
      buffer,
      data.filename,
      data.mimetype
    );
    return result;
  } catch (error) {
    const fs = require('fs');
    const logMessage = `\n[${new Date().toISOString()}] UPLOAD ERROR: ${error.stack || error.message}\n`;
    fs.appendFileSync('error_log.txt', logMessage);
    console.error('FULL ERROR IN UPLOAD:', error);
    fastify.log.error(error);
    return reply.status(500).send({ error: 'Error processing file' });
  }
});

// Endpoint de subida directo para terminal y API
fastify.post('/upload', async (request, reply) => {
  console.log('>>> Upload request received');
  try {
    const data = await request.file();
    if (!data) {
      console.log('>>> No data found in request');
      return reply.status(400).send({ error: 'No file uploaded' });
    }

    console.log(`>>> Receiving file: ${data.filename}`);
    const brandId = data.fields.brandId ? data.fields.brandId.value : 'snfplus';
    const category = data.fields.category ? data.fields.category.value : null;
    console.log(`>>> Brand ID: ${brandId}, Category: ${category}`);
    
    // Leemos el archivo como chunks para evitar saturar la memoria
    const chunks = [];
    for await (const chunk of data.file) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    console.log(`>>> Buffer created: ${buffer.length} bytes`);

    const result = await ingestionService.processFile(brandId, buffer, data.filename, data.mimetype, category);
    console.log('>>> Ingestion successful');
    return result;
  } catch (error) {
    console.error('!!! CRITICAL UPLOAD ERROR:', error);
    const fs = require('fs');
    fs.appendFileSync('error_log.txt', `\n[${new Date().toISOString()}] UPLOAD CRASH: ${error.stack}\n`);
    return reply.status(500).send({ error: 'Error processing file' });
  }
});

// Start Server
const start = async () => {
  try {
    await fastify.listen({ port: config.PORT, host: '0.0.0.0' });
    console.log(`Server listening on ${fastify.server.address().port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
