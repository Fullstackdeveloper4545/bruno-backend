const pool = require('../config/db');
const bcrypt = require('bcrypt');
const { sendOtpEmail } = require('../services/mailService');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function otpExpiryDate() {
  return new Date(Date.now() + 10 * 60 * 1000);
}

function isSixDigitOtp(value) {
  return /^\d{6}$/.test(String(value || ''));
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(input) {
  const clean = String(input || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const output = [];

  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(output);
}

function generateTwoFactorSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function generateTotpCode(secret, timestamp = Date.now()) {
  const counter = Math.floor(timestamp / 30000);
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const code = ((hmac[offset] & 127) << 24)
    | ((hmac[offset + 1] & 255) << 16)
    | ((hmac[offset + 2] & 255) << 8)
    | (hmac[offset + 3] & 255);
  return String(code % 1000000).padStart(6, '0');
}

function verifyTotpCode(secret, code) {
  if (!secret || !isSixDigitOtp(code)) return false;
  for (let offset = -1; offset <= 1; offset += 1) {
    const candidate = generateTotpCode(secret, Date.now() + offset * 30000);
    if (candidate === String(code)) {
      return true;
    }
  }
  return false;
}

function getAdminEmail() {
  return String(process.env.ADMIN_EMAIL || 'admin123ecom@gmail.com').trim().toLowerCase();
}

function isAdminRole(role) {
  return ['admin', 'super_admin'].includes(String(role || '').trim().toLowerCase());
}

function buildOtpAuthUri(email, secret) {
  const issuer = encodeURIComponent('Bruno Admin');
  const label = encodeURIComponent(`Bruno Admin:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}


exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const normalizedEmail = typeof email === "string" ? email.trim() : "";

    if (!name || !normalizedEmail || !password) {
      return res.status(400).json({ message: 'All fields required' });
    }

    const userExists = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [normalizedEmail]
    );

    const hashedPassword = await bcrypt.hash(password, 10);

    const otp = generateOtp();
    const otpExpiry = otpExpiryDate();

    if (userExists.rows.length > 0) {
      const existingUser = userExists.rows[0];
      if (existingUser.is_verified) {
        return res.status(400).json({ message: 'Email already exists' });
      }

      await pool.query(
        `UPDATE users
         SET name = $1, password = $2, password_hash = $3, is_verified = false, otp_code = $4, otp_expires_at = $5
         WHERE email = $6`,
        [name, hashedPassword, hashedPassword, otp, otpExpiry, normalizedEmail]
      );
    } else {
      await pool.query(
        `INSERT INTO users (name, email, password, password_hash, is_verified, otp_code, otp_expires_at)
         VALUES ($1, $2, $3, $4, false, $5, $6)`,
        [name, normalizedEmail, hashedPassword, hashedPassword, otp, otpExpiry]
      );
    }

    let emailDispatchError = null;
    try {
      await sendOtpEmail(normalizedEmail, otp);
    } catch (mailError) {
      emailDispatchError = mailError;
      // In development, allow OTP flow even if SMTP temporarily fails.
      if (process.env.NODE_ENV !== "development") {
        throw mailError;
      }
      console.warn("OTP email dispatch failed in development:", mailError?.message || mailError);
    }

    if (process.env.NODE_ENV === "development") {
      return res.status(201).json({
        message: emailDispatchError
          ? "OTP generated (dev mode). Email delivery failed, use returned OTP."
          : "OTP sent to email (dev mode)",
        otp: otp,
        email_dispatched: !emailDispatchError,
      });
    }

    res.status(201).json({ message: 'OTP sent to email' });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const normalizedEmail = typeof email === "string" ? email.trim() : "";

    if (!normalizedEmail || !otp) {
      return res.status(400).json({ message: "Email and OTP required" });
    }

    if (!isSixDigitOtp(otp)) {
      return res.status(400).json({ message: "OTP must be 6 digits" });
    }

    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: "User not found" });
    }

    const user = result.rows[0];

    if (user.otp_code !== otp) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    if (new Date(user.otp_expires_at) < new Date()) {
      return res.status(400).json({ message: "OTP expired" });
    }

    await pool.query(
      "UPDATE users SET is_verified = true, otp_code = NULL, otp_expires_at = NULL WHERE email = $1",
      [normalizedEmail]
    );

    res.json({ message: "Account verified successfully" });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};
exports.login = async (req, res) => {
  try {
    const { email, password, totp_code } = req.body;
    const normalizedEmail = typeof email === "string" ? email.trim() : "";

    if (!normalizedEmail || !password) {
      return res.status(400).json({ message: "All fields required" });
    }

    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const user = result.rows[0];

    if (user.is_active === false) {
      return res.status(403).json({ message: 'Account is deactivated' });
    }

    const storedHash = user.password || user.password_hash;
    if (!storedHash) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, storedHash);

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    if (!user.is_verified) {
      return res.status(400).json({ message: "Please verify your account first" });
    }

    const isAdminLogin = normalizedEmail.toLowerCase() === getAdminEmail() && isAdminRole(user.role);
    if (isAdminLogin && user.two_factor_enabled) {
      if (!isSixDigitOtp(totp_code)) {
        return res.json({ requires_2fa: true, message: 'Two-factor code required' });
      }
      if (!verifyTotpCode(user.two_factor_secret, totp_code)) {
        return res.status(400).json({ message: 'Invalid two-factor code' });
      }
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({ message: "Login successful", token, role: user.role, requires_2fa: false });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.requestPasswordResetOtp = async (req, res) => {
  try {
    const { email } = req.body;
    const normalizedEmail = typeof email === 'string' ? email.trim() : '';

    if (!normalizedEmail) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const userResult = await pool.query('SELECT id, is_verified FROM users WHERE email = $1', [normalizedEmail]);

    if (userResult.rows.length === 0) {
      return res.status(400).json({ message: 'User not found' });
    }

    if (!userResult.rows[0].is_verified) {
      return res.status(400).json({ message: 'Please verify your account first' });
    }

    const otp = generateOtp();
    const otpExpiry = otpExpiryDate();

    await pool.query('UPDATE users SET otp_code = $1, otp_expires_at = $2 WHERE email = $3', [otp, otpExpiry, normalizedEmail]);

    let emailDispatchError = null;
    try {
      await sendOtpEmail(normalizedEmail, otp);
    } catch (mailError) {
      emailDispatchError = mailError;
      if (process.env.NODE_ENV !== 'development') {
        throw mailError;
      }
      console.warn('Password reset OTP email dispatch failed in development:', mailError?.message || mailError);
    }

    if (process.env.NODE_ENV === 'development') {
      return res.json({
        message: emailDispatchError
          ? 'Password reset OTP generated (dev mode). Email delivery failed, use returned OTP.'
          : 'Password reset OTP sent (dev mode)',
        otp,
        email_dispatched: !emailDispatchError,
      });
    }

    res.json({ message: 'Password reset OTP sent to email' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.resetPasswordWithOtp = async (req, res) => {
  try {
    const { email, otp, new_password } = req.body;
    const normalizedEmail = typeof email === 'string' ? email.trim() : '';
    const normalizedPassword = typeof new_password === 'string' ? new_password : '';

    if (!normalizedEmail || !otp || !normalizedPassword) {
      return res.status(400).json({ message: 'Email, OTP and new password are required' });
    }

    if (!isSixDigitOtp(otp)) {
      return res.status(400).json({ message: 'OTP must be 6 digits' });
    }

    if (normalizedPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }

    const result = await pool.query('SELECT id, otp_code, otp_expires_at FROM users WHERE email = $1', [normalizedEmail]);

    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'User not found' });
    }

    const user = result.rows[0];

    if (!user.otp_code || user.otp_code !== String(otp)) {
      return res.status(400).json({ message: 'Invalid OTP' });
    }

    if (!user.otp_expires_at || new Date(user.otp_expires_at) < new Date()) {
      return res.status(400).json({ message: 'OTP expired' });
    }

    const hashedPassword = await bcrypt.hash(normalizedPassword, 10);

    await pool.query(
      'UPDATE users SET password = $1, password_hash = $2, otp_code = NULL, otp_expires_at = NULL WHERE email = $3',
      [hashedPassword, hashedPassword, normalizedEmail]
    );

    res.json({ message: 'Password reset successful. Please login.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const currentPassword = typeof req.body?.current_password === 'string' ? req.body.current_password : '';
    const newPassword = typeof req.body?.new_password === 'string' ? req.body.new_password : '';

    if (!email || !currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Email, current password, and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }

    const userResult = await pool.query('SELECT id, password, password_hash FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    const user = userResult.rows[0];
    const storedHash = user.password || user.password_hash;
    const isMatch = storedHash ? await bcrypt.compare(currentPassword, storedHash) : false;
    if (!isMatch) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    const nextHash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password = $1, password_hash = $1, updated_at = NOW() WHERE id = $2', [
      nextHash,
      user.id,
    ]);

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('changePassword error', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.deactivateCustomerAccount = async (req, res) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const result = await pool.query(
      `UPDATE users
       SET is_active = false, updated_at = NOW()
       WHERE email = $1
       RETURNING id, name, email, is_active`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      message: 'Customer account deactivated successfully',
      user: result.rows[0],
    });
  } catch (error) {
    console.error('deactivateCustomerAccount error', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getAdminTwoFactorStatus = async (req, res) => {
  try {
    const email = getAdminEmail();
    const result = await pool.query(
      `SELECT email, role, two_factor_enabled
       FROM users
       WHERE LOWER(email) = $1
       LIMIT 1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Admin user not found' });
    }
    if (!isAdminRole(result.rows[0].role)) {
      return res.status(403).json({ message: '2FA is available only for admin accounts' });
    }

    res.json({
      email,
      enabled: Boolean(result.rows[0].two_factor_enabled),
    });
  } catch (error) {
    console.error('getAdminTwoFactorStatus error', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.setupAdminTwoFactor = async (req, res) => {
  try {
    const email = getAdminEmail();
    const currentPassword = typeof req.body?.current_password === 'string' ? req.body.current_password : '';

    if (!currentPassword) {
      return res.status(400).json({ message: 'Current password is required' });
    }

    const result = await pool.query(
      `SELECT id, email, password, password_hash, two_factor_enabled, role
       FROM users
       WHERE LOWER(email) = $1
       LIMIT 1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Admin user not found' });
    }

    const user = result.rows[0];
    if (!isAdminRole(user.role)) {
      return res.status(403).json({ message: '2FA is available only for admin accounts' });
    }
    const storedHash = user.password || user.password_hash;
    const isMatch = storedHash ? await bcrypt.compare(currentPassword, storedHash) : false;
    if (!isMatch) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    const secret = generateTwoFactorSecret();
    await pool.query(
      `UPDATE users
       SET two_factor_temp_secret = $1, updated_at = NOW()
       WHERE id = $2`,
      [secret, user.id]
    );

    res.json({
      email,
      secret,
      otpauth_url: buildOtpAuthUri(email, secret),
      enabled: Boolean(user.two_factor_enabled),
    });
  } catch (error) {
    console.error('setupAdminTwoFactor error', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.enableAdminTwoFactor = async (req, res) => {
  try {
    const email = getAdminEmail();
    const code = typeof req.body?.totp_code === 'string' ? req.body.totp_code.trim() : '';

    if (!isSixDigitOtp(code)) {
      return res.status(400).json({ message: 'A valid 6-digit code is required' });
    }

    const result = await pool.query(
      `SELECT id, role, two_factor_temp_secret
       FROM users
       WHERE LOWER(email) = $1
       LIMIT 1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Admin user not found' });
    }

    const user = result.rows[0];
    if (!isAdminRole(user.role)) {
      return res.status(403).json({ message: '2FA is available only for admin accounts' });
    }
    if (!user.two_factor_temp_secret) {
      return res.status(400).json({ message: 'Two-factor setup has not been started' });
    }

    if (!verifyTotpCode(user.two_factor_temp_secret, code)) {
      return res.status(400).json({ message: 'Invalid two-factor code' });
    }

    await pool.query(
      `UPDATE users
       SET two_factor_enabled = TRUE,
           two_factor_secret = two_factor_temp_secret,
           two_factor_temp_secret = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [user.id]
    );

    res.json({ message: 'Two-factor authentication enabled', enabled: true });
  } catch (error) {
    console.error('enableAdminTwoFactor error', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.disableAdminTwoFactor = async (req, res) => {
  try {
    const email = getAdminEmail();
    const currentPassword = typeof req.body?.current_password === 'string' ? req.body.current_password : '';
    const code = typeof req.body?.totp_code === 'string' ? req.body.totp_code.trim() : '';

    if (!currentPassword) {
      return res.status(400).json({ message: 'Current password is required' });
    }
    if (!isSixDigitOtp(code)) {
      return res.status(400).json({ message: 'A valid 6-digit code is required' });
    }

    const result = await pool.query(
      `SELECT id, password, password_hash, role, two_factor_secret
       FROM users
       WHERE LOWER(email) = $1
       LIMIT 1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Admin user not found' });
    }

    const user = result.rows[0];
    if (!isAdminRole(user.role)) {
      return res.status(403).json({ message: '2FA is available only for admin accounts' });
    }
    const storedHash = user.password || user.password_hash;
    const isMatch = storedHash ? await bcrypt.compare(currentPassword, storedHash) : false;
    if (!isMatch) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }
    if (!verifyTotpCode(user.two_factor_secret, code)) {
      return res.status(400).json({ message: 'Invalid two-factor code' });
    }

    await pool.query(
      `UPDATE users
       SET two_factor_enabled = FALSE,
           two_factor_secret = NULL,
           two_factor_temp_secret = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [user.id]
    );

    res.json({ message: 'Two-factor authentication disabled', enabled: false });
  } catch (error) {
    console.error('disableAdminTwoFactor error', error);
    res.status(500).json({ message: 'Server error' });
  }
};
