const { authenticate, signToken } = require('../src/auth/middleware');

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

describe('authenticate middleware', () => {
  test('rejects requests without an Authorization header', () => {
    const req = { headers: {} };
    const res = mockRes();
    const next = jest.fn();

    authenticate(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Missing or malformed Authorization header' });
    expect(next).not.toHaveBeenCalled();
  });

  test('attaches user info when token is valid', () => {
    const token = signToken({ id: 'u_123', email: 'demo@example.com', roles: ['admin'] });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    const next = jest.fn();

    authenticate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toMatchObject({ id: 'u_123', email: 'demo@example.com', roles: ['admin'] });
  });
});
