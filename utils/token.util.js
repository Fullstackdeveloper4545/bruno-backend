const jwt = require('jsonwebtoken');

function signToken(payload, options = {}) {
  const secret = process.env.JWT_SECRET || 'dev-secret';
  return jwt.sign(payload, secret, { expiresIn: '1d', ...options });
}

function verifyToken(token) {
  const secret = process.env.JWT_SECRET || 'dev-secret';
  return jwt.verify(token, secret);
}

module.exports = {
  signToken,
  verifyToken,
};