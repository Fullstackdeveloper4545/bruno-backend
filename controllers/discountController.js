const pool = require('../config/db');

const ALLOWED_TYPES = new Set(['percentage', 'fixed']);
const ALLOWED_RESTRICTIONS = new Set(['global', 'product', 'category']);

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNullableText(value) {
  if (value == null) return null;
  const normalized = normalizeText(value);
  return normalized || null;
}

function parseCouponId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseUsageLimit(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

function parseExpiration(value) {
  if (value == null || value === '') return null;
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return normalized;
}

function normalizeIdentifier(value) {
  if (value == null) return '';
  return String(value).trim().toLowerCase();
}

async function listCoupons(req, res) {
  try {
    const result = await pool.query(`SELECT * FROM coupons ORDER BY id DESC`);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function createCoupon(req, res) {
  try {
    const code = normalizeText(req.body.code).toUpperCase();
    const type = normalizeText(req.body.type).toLowerCase();
    const value = parseValue(req.body.value);
    const restrictionType = normalizeText(req.body.restriction_type || 'global').toLowerCase();
    const expiration = parseExpiration(req.body.expiration);
    const usageLimit = parseUsageLimit(req.body.usage_limit);
    const isActive = req.body.is_active == null ? true : Boolean(req.body.is_active);
    const restrictionId =
      restrictionType === 'global' ? null : normalizeNullableText(req.body.restriction_id);

    if (!code) {
      return res.status(400).json({ message: 'Coupon code is required' });
    }
    if (!ALLOWED_TYPES.has(type)) {
      return res.status(400).json({ message: 'Coupon type must be percentage or fixed' });
    }
    if (value == null) {
      return res.status(400).json({ message: 'Coupon value must be a number greater than 0' });
    }
    if (type === 'percentage' && value > 100) {
      return res.status(400).json({ message: 'Percentage coupons cannot exceed 100' });
    }
    if (!ALLOWED_RESTRICTIONS.has(restrictionType)) {
      return res.status(400).json({ message: 'Restriction type must be global, product, or category' });
    }
    if (restrictionType !== 'global' && !restrictionId) {
      return res.status(400).json({ message: 'Restriction id is required for product/category coupons' });
    }
    if (req.body.usage_limit != null && req.body.usage_limit !== '' && usageLimit == null) {
      return res.status(400).json({ message: 'Usage limit must be an integer greater than 0' });
    }
    if (expiration === undefined) {
      return res.status(400).json({ message: 'Expiration date is invalid' });
    }

    const result = await pool.query(
      `INSERT INTO coupons (code, type, value, expiration, usage_limit, restriction_type, restriction_id, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [code, type, value, expiration, usageLimit, restrictionType, restrictionId, isActive]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error?.code === '23505') {
      return res.status(400).json({ message: 'Coupon code already exists' });
    }
    res.status(500).json({ message: error.message });
  }
}

async function updateCoupon(req, res) {
  try {
    const id = parseCouponId(req.params.id);
    if (!id) {
      return res.status(400).json({ message: 'Invalid coupon id' });
    }

    const existingResult = await pool.query(`SELECT * FROM coupons WHERE id = $1`, [id]);
    if (!existingResult.rows[0]) {
      return res.status(404).json({ message: 'Coupon not found' });
    }

    const existing = existingResult.rows[0];

    const nextCode = Object.prototype.hasOwnProperty.call(req.body, 'code')
      ? normalizeText(req.body.code).toUpperCase()
      : existing.code;
    const nextType = Object.prototype.hasOwnProperty.call(req.body, 'type')
      ? normalizeText(req.body.type).toLowerCase()
      : existing.type;
    const nextValue = Object.prototype.hasOwnProperty.call(req.body, 'value')
      ? parseValue(req.body.value)
      : Number(existing.value);
    const nextRestrictionType = Object.prototype.hasOwnProperty.call(req.body, 'restriction_type')
      ? normalizeText(req.body.restriction_type).toLowerCase()
      : existing.restriction_type;
    const parsedExpiration = Object.prototype.hasOwnProperty.call(req.body, 'expiration')
      ? parseExpiration(req.body.expiration)
      : existing.expiration;
    const parsedUsageLimit = Object.prototype.hasOwnProperty.call(req.body, 'usage_limit')
      ? parseUsageLimit(req.body.usage_limit)
      : existing.usage_limit;
    const nextIsActive = Object.prototype.hasOwnProperty.call(req.body, 'is_active')
      ? Boolean(req.body.is_active)
      : existing.is_active;

    const rawRestrictionId = Object.prototype.hasOwnProperty.call(req.body, 'restriction_id')
      ? normalizeNullableText(req.body.restriction_id)
      : existing.restriction_id;
    const nextRestrictionId = nextRestrictionType === 'global' ? null : rawRestrictionId;

    if (!nextCode) {
      return res.status(400).json({ message: 'Coupon code is required' });
    }
    if (!ALLOWED_TYPES.has(nextType)) {
      return res.status(400).json({ message: 'Coupon type must be percentage or fixed' });
    }
    if (nextValue == null) {
      return res.status(400).json({ message: 'Coupon value must be a number greater than 0' });
    }
    if (nextType === 'percentage' && nextValue > 100) {
      return res.status(400).json({ message: 'Percentage coupons cannot exceed 100' });
    }
    if (!ALLOWED_RESTRICTIONS.has(nextRestrictionType)) {
      return res.status(400).json({ message: 'Restriction type must be global, product, or category' });
    }
    if (nextRestrictionType !== 'global' && !nextRestrictionId) {
      return res.status(400).json({ message: 'Restriction id is required for product/category coupons' });
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'usage_limit') && req.body.usage_limit != null && req.body.usage_limit !== '' && parsedUsageLimit == null) {
      return res.status(400).json({ message: 'Usage limit must be an integer greater than 0' });
    }
    if (parsedExpiration === undefined) {
      return res.status(400).json({ message: 'Expiration date is invalid' });
    }

    const result = await pool.query(
      `UPDATE coupons
       SET code = $1,
           type = $2,
           value = $3,
           expiration = $4,
           usage_limit = $5,
           restriction_type = $6,
           restriction_id = $7,
           is_active = $8
       WHERE id = $9
       RETURNING *`,
      [
        nextCode,
        nextType,
        nextValue,
        parsedExpiration,
        parsedUsageLimit,
        nextRestrictionType,
        nextRestrictionId,
        nextIsActive,
        id,
      ]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Coupon not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    if (error?.code === '23505') {
      return res.status(400).json({ message: 'Coupon code already exists' });
    }
    res.status(500).json({ message: error.message });
  }
}

async function deleteCoupon(req, res) {
  try {
    const id = parseCouponId(req.params.id);
    if (!id) {
      return res.status(400).json({ message: 'Invalid coupon id' });
    }
    await pool.query(`DELETE FROM coupons WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function applyCoupon(req, res) {
  try {
    const code = normalizeText(req.body.code).toUpperCase();
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!code) {
      return res.status(400).json({ message: 'Coupon code is required' });
    }

    const couponResult = await pool.query(
      `SELECT * FROM coupons WHERE UPPER(code) = UPPER($1) AND is_active = true LIMIT 1`,
      [code]
    );

    if (!couponResult.rows[0]) {
      return res.status(404).json({ message: 'Coupon not found' });
    }

    const coupon = couponResult.rows[0];

    if (coupon.expiration && new Date(coupon.expiration) < new Date()) {
      return res.status(400).json({ message: 'Coupon expired' });
    }

    if (coupon.usage_limit != null && coupon.usage_count >= coupon.usage_limit) {
      return res.status(400).json({ message: 'Coupon usage limit reached' });
    }

    const lineTotal = (item) => {
      const explicit = Number(item?.line_total);
      if (Number.isFinite(explicit) && explicit >= 0) return explicit;
      const quantity = Number(item?.quantity);
      const unitPrice = Number(item?.unit_price);
      if (Number.isFinite(quantity) && Number.isFinite(unitPrice) && quantity > 0 && unitPrice >= 0) {
        return quantity * unitPrice;
      }
      return 0;
    };

    let eligibleTotal = items.reduce((sum, item) => sum + lineTotal(item), 0);

    if (coupon.restriction_type === 'product') {
      const targetId = normalizeIdentifier(coupon.restriction_id);
      eligibleTotal = items
        .filter((item) => normalizeIdentifier(item?.product_id) === targetId)
        .reduce((sum, item) => sum + lineTotal(item), 0);
    }

    if (coupon.restriction_type === 'category') {
      const targetId = normalizeIdentifier(coupon.restriction_id);
      eligibleTotal = items
        .filter((item) => normalizeIdentifier(item?.category_id) === targetId)
        .reduce((sum, item) => sum + lineTotal(item), 0);
    }

    if (eligibleTotal <= 0) {
      return res.status(400).json({ message: 'Coupon is not applicable to selected items' });
    }

    const discount = coupon.type === 'percentage'
      ? (eligibleTotal * Number(coupon.value)) / 100
      : Math.min(Number(coupon.value), eligibleTotal);

    res.json({ coupon_id: coupon.id, discount: Number(discount.toFixed(2)) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

module.exports = { listCoupons, createCoupon, updateCoupon, deleteCoupon, applyCoupon };
