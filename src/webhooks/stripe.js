const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { query, getPool } = require('../db/connection');

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const QUERY_TIMEOUT_MS = 5000;

async function queryWithTimeout(text, params) {
  const client = await getPool().connect();
  try {
    await client.query(`SET statement_timeout = ${QUERY_TIMEOUT_MS}`);
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

async function isEventProcessed(eventId) {
  const { rows } = await queryWithTimeout(
    'SELECT 1 FROM stripe_events WHERE event_id = $1',
    [eventId]
  );
  return rows.length > 0;
}

async function markEventProcessed(eventId, eventType) {
  await queryWithTimeout(
    'INSERT INTO stripe_events (event_id, event_type, processed_at) VALUES ($1, $2, NOW()) ON CONFLICT (event_id) DO NOTHING',
    [eventId, eventType]
  );
}

async function processWebhook(req, res) {
  const sig = req.headers['stripe-signature'];

  if (!sig || !WEBHOOK_SECRET) {
    return res.status(400).json({ error: 'Missing signature or webhook secret' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe] signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    if (await isEventProcessed(event.id)) {
      console.log('[stripe] skipping duplicate event:', event.id);
      return res.status(200).json({ received: true, duplicate: true });
    }

    await handleEvent(event);
    await markEventProcessed(event.id, event.type);

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[stripe] webhook processing failed:', err);

    if (err.code === 'ECONNREFUSED' || err.code === '57014' || err.message?.includes('timeout')) {
      return res.status(503).json({ error: 'Service temporarily unavailable', retry: true });
    }

    return res.status(500).json({ error: 'Processing failed' });
  }
}

async function handleEvent(event) {
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event.data.object);
      break;
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await handleSubscriptionChange(event.data.object);
      break;
    case 'invoice.payment_failed':
      await handlePaymentFailed(event.data.object);
      break;
    default:
      console.log('[stripe] unhandled event type:', event.type);
  }
}

async function handleCheckoutCompleted(session) {
  const { customer, subscription, metadata } = session;
  await queryWithTimeout(
    'UPDATE users SET stripe_customer_id = $1, subscription_id = $2, subscription_status = $3 WHERE id = $4',
    [customer, subscription, 'active', metadata?.user_id]
  );
}

async function handleSubscriptionChange(subscription) {
  await queryWithTimeout(
    'UPDATE users SET subscription_status = $1 WHERE stripe_customer_id = $2',
    [subscription.status, subscription.customer]
  );
}

async function handlePaymentFailed(invoice) {
  await queryWithTimeout(
    'UPDATE users SET subscription_status = $1 WHERE stripe_customer_id = $2',
    ['past_due', invoice.customer]
  );
}

module.exports = { processWebhook, handleEvent };
