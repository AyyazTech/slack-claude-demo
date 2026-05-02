const express = require('express');
const { authenticate } = require('./auth/middleware');
const { query } = require('./db/connection');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ service: 'slack-claude-demo', status: 'ok' });
});

app.get('/health', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ status: 'ok', db: 'reachable', uptime: process.uptime() });
  } catch (err) {
    res.status(503).json({ status: 'degraded', db: 'unreachable', error: err.message });
  }
});

app.get('/users', authenticate, async (_req, res, next) => {
  try {
    const { rows } = await query('SELECT id, email, created_at FROM users ORDER BY id LIMIT 100');
    res.json({ users: rows });
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Listening on :${PORT}`);
  });
}

module.exports = { app, authenticate };
