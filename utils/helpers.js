function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBool(value, fallback = false) {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  return String(value).toLowerCase() === 'true';
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

module.exports = {
  toNumber,
  toBool,
  hasText,
};