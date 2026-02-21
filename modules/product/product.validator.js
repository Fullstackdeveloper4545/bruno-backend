function validateProductPayload(req) {
  if (!req?.body) {
    return { valid: false, message: 'Request body is required' };
  }
  return { valid: true };
}

module.exports = { validateProductPayload };