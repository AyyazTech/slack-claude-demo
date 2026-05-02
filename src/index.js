const express = require('express');
const { authenticate } = require('./auth/middleware');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (_req, res) => {
  res.json({ service: 'slack-claude-demo', status: 'ok' });
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
