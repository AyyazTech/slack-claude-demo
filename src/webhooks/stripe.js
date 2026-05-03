const crypto = require('crypto');

const STRIPE_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const TOLERANCE_SECONDS = 5 * 60;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 250;

function verifySignature(rawBody, header) {
  if (!header || !STRIPE_SECRET) return false;
  const parts = Object.fromEntries(
    header.split(',').map((kv) => kv.trim().split('=')),
  );
  const timestamp = Number(parts.t);
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const age = Math.floor(Date.now() / 1000) - timestamp;
  if (Math.abs(age) > TOLERANCE_SECONDS) return false;

  const payload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', STRIPE_SECRET).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

async function dispatchWithRetry(handler, event) {
  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      return await handler(event);
    } catch (err) {
      lastErr = err;
      const delay = RETRY_BASE_MS * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

const HANDLERS = {
  'payment_intent.succeeded': async (event) => {
    console.log('[stripe] payment succeeded', event.data.object.id);
  },
  'invoice.payment_failed': async (event) => {
    console.warn('[stripe] invoice payment failed', event.data.object.id);
  },
};

async function handleStripeWebhook(req, res) {
  const rawBody = req.rawBody || '';
  const sigHeader = req.headers['stripe-signature'];

  if (!verifySignature(rawBody, sigHeader)) {
    return res.status(400).json({ error: 'invalid_signature' });
  }

  // BUG: JSON.parse can throw on malformed payloads; not wrapped in try/catch.
  const event = JSON.parse(rawBody);

  const handler = HANDLERS[event.type];
  if (!handler) {
    return res.status(200).json({ received: true, handled: false });
  }

  try {
    await dispatchWithRetry(handler, event);
    return res.status(200).json({ received: true, handled: true });
  } catch (err) {
    console.error('[stripe] handler failed after retries', err);
    return res.status(500).json({ error: 'handler_failed', type: event.type });
  }
}

module.exports = { handleStripeWebhook, verifySignature, dispatchWithRetry };
