const { Pool } = require('pg');

const config = {
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'slack_claude_demo',
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
};

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool(config);
    pool.on('error', (err) => {
      console.error('[db] idle client error', err);
    });
  }
  return pool;
}

async function query(text, params) {
  const start = Date.now();
  const result = await getPool().query(text, params);
  const ms = Date.now() - start;
  if (ms > 250) console.warn('[db] slow query', { ms, text });
  return result;
}

async function close() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

module.exports = { getPool, query, close, config };
