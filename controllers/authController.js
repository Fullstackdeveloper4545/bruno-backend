const pool = require('../config/db');
const bcrypt = require('bcrypt');
const { sendOtpEmail } = require('../services/mailService');
const jwt = require('jsonwebtoken');

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function otpExpiryDate() {
  return new Date(Date.now() + 10 * 60 * 1000);
}

function isSixDigitOtp(value) {
  return /^\d{6}$/.test(String(value || ''));
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
    const { email, password } = req.body;
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

    const token = jwt.sign(
      { id: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({ message: "Login successful", token });

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
