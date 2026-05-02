const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TOKEN_PREFIX = 'Bearer ';

function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith(TOKEN_PREFIX)) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = header.slice(TOKEN_PREFIX.length).trim();

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email, roles: payload.roles || [] };
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function signToken(user, opts = {}) {
  return jwt.sign(
    { sub: user.id, email: user.email, roles: user.roles || [] },
    JWT_SECRET,
    { expiresIn: opts.expiresIn || '1h' },
  );
}

module.exports = { authenticate, signToken, JWT_SECRET };
