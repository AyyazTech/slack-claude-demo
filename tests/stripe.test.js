const crypto = require('crypto');

const WEBHOOK_SECRET = 'whsec_test_secret';
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;

const { handleStripeWebhook, verifySignature, dispatchWithRetry, clearProcessedEvents } = require('../src/webhooks/stripe');

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function createSignature(payload, timestamp, secret = WEBHOOK_SECRET) {
  const signedPayload = `${timestamp}.${payload}`;
  return crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
}

function createSignedRequest(event, timestampOffset = 0) {
  const rawBody = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000) + timestampOffset;
  const signature = createSignature(rawBody, timestamp);
  return {
    rawBody,
    headers: {
      'stripe-signature': `t=${timestamp},v1=${signature}`,
    },
  };
}

describe('verifySignature', () => {
  const rawBody = '{"test": true}';
  const timestamp = Math.floor(Date.now() / 1000);

  test('returns true for valid signature', () => {
    const sig = createSignature(rawBody, timestamp);
    const header = `t=${timestamp},v1=${sig}`;
    expect(verifySignature(rawBody, header)).toBe(true);
  });

  test('returns false for invalid signature', () => {
    const header = `t=${timestamp},v1=invalidsignature`;
    expect(verifySignature(rawBody, header)).toBe(false);
  });

  test('returns false for expired timestamp', () => {
    const oldTimestamp = timestamp - 6 * 60;
    const sig = createSignature(rawBody, oldTimestamp);
    const header = `t=${oldTimestamp},v1=${sig}`;
    expect(verifySignature(rawBody, header)).toBe(false);
  });

  test('returns false for missing header parts', () => {
    expect(verifySignature(rawBody, '')).toBe(false);
    expect(verifySignature(rawBody, null)).toBe(false);
    expect(verifySignature(rawBody, `t=${timestamp}`)).toBe(false);
    expect(verifySignature(rawBody, 'v1=somesig')).toBe(false);
  });

  test('returns false for buffer length mismatch without crashing', () => {
    const header = `t=${timestamp},v1=short`;
    expect(verifySignature(rawBody, header)).toBe(false);
  });
});

describe('dispatchWithRetry', () => {
  test('returns immediately on success', async () => {
    const handler = jest.fn().mockResolvedValue('result');
    const result = await dispatchWithRetry(handler, { id: 'evt_1' });
    expect(result).toBe('result');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('retries and succeeds after failures', async () => {
    const handler = jest.fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValue('success');
    const result = await dispatchWithRetry(handler, { id: 'evt_2' });
    expect(result).toBe('success');
    expect(handler).toHaveBeenCalledTimes(3);
  });

  test('throws after max retries exceeded', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('always fails'));
    await expect(dispatchWithRetry(handler, { id: 'evt_3' })).rejects.toThrow('always fails');
    expect(handler).toHaveBeenCalledTimes(3);
  });
});

describe('handleStripeWebhook', () => {
  beforeEach(() => {
    clearProcessedEvents();
  });

  test('returns 400 for invalid signature', async () => {
    const req = {
      rawBody: '{}',
      headers: { 'stripe-signature': 't=123,v1=invalid' },
    };
    const res = mockRes();
    await handleStripeWebhook(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_signature' });
  });

  test('returns 400 for malformed JSON', async () => {
    const rawBody = 'not json';
    const timestamp = Math.floor(Date.now() / 1000);
    const sig = createSignature(rawBody, timestamp);
    const req = {
      rawBody,
      headers: { 'stripe-signature': `t=${timestamp},v1=${sig}` },
    };
    const res = mockRes();
    await handleStripeWebhook(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_json' });
  });

  test('returns 200 with handled:false for unknown event type', async () => {
    const event = { id: 'evt_unknown', type: 'unknown.event', data: { object: {} } };
    const req = createSignedRequest(event);
    const res = mockRes();
    await handleStripeWebhook(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true, handled: false });
  });

  test('returns 200 with handled:true for known event type', async () => {
    const event = { id: 'evt_pi', type: 'payment_intent.succeeded', data: { object: { id: 'pi_123' } } };
    const req = createSignedRequest(event);
    const res = mockRes();
    await handleStripeWebhook(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true, handled: true });
  });

  test('handles invoice.payment_succeeded event', async () => {
    const event = { id: 'evt_inv_success', type: 'invoice.payment_succeeded', data: { object: { id: 'inv_123' } } };
    const req = createSignedRequest(event);
    const res = mockRes();
    await handleStripeWebhook(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true, handled: true });
  });

  test('returns duplicate:true for already processed event', async () => {
    const event = { id: 'evt_dup', type: 'payment_intent.succeeded', data: { object: { id: 'pi_dup' } } };
    const req1 = createSignedRequest(event);
    const res1 = mockRes();
    await handleStripeWebhook(req1, res1);
    expect(res1.body).toEqual({ received: true, handled: true });

    const req2 = createSignedRequest(event);
    const res2 = mockRes();
    await handleStripeWebhook(req2, res2);
    expect(res2.statusCode).toBe(200);
    expect(res2.body).toEqual({ received: true, handled: false, duplicate: true });
  });

  test('returns 500 when handler fails after retries', async () => {
    const originalHandler = jest.requireActual('../src/webhooks/stripe');
    jest.resetModules();
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const stripe = require('../src/webhooks/stripe');

    const event = { id: 'evt_fail', type: 'payment_intent.succeeded', data: { object: { id: 'pi_fail' } } };
    const req = createSignedRequest(event);
    const res = mockRes();

    jest.spyOn(console, 'log').mockImplementation(() => { throw new Error('handler error'); });

    await stripe.handleStripeWebhook(req, res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'handler_failed', type: 'payment_intent.succeeded' });

    console.log.mockRestore();
    jest.resetModules();
  });
});
