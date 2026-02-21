const path = require('path');
const nodemailer = require('nodemailer');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  logger: process.env.NODE_ENV === 'development',
  debug: process.env.NODE_ENV === 'development',
});

let transporterVerified = false;

const ensureTransporter = async () => {
  if (transporterVerified) return;
  await transporter.verify();
  transporterVerified = true;
};

async function sendEmail({ to, subject, text, html, attachments = [] }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    throw new Error('EMAIL_USER/EMAIL_PASS missing in backend .env');
  }

  await ensureTransporter();
  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;

  await transporter.sendMail({ from, to, subject, text, html, attachments });
}

const sendOtpEmail = async (to, otp) => {
  await sendEmail({
    to,
    subject: 'Your OTP Code',
    text: `Your OTP is ${otp}`,
    html: `<p>Your OTP is <strong>${otp}</strong>.</p>`,
  });
};

const sendInvoiceEmail = async (to, invoiceNumber, pdfBase64) => {
  await sendEmail({
    to,
    subject: `Invoice ${invoiceNumber}`,
    text: `Your invoice ${invoiceNumber} is attached.`,
    html: `<p>Your invoice <strong>${invoiceNumber}</strong> is attached.</p>`,
    attachments: [
      {
        filename: `${invoiceNumber}.pdf`,
        content: pdfBase64,
        encoding: 'base64',
      },
    ],
  });
};

const sendOrderTrackingEmail = async (to, orderNumber, trackingCode, labelUrl) => {
  await sendEmail({
    to,
    subject: `Tracking for ${orderNumber}`,
    text: `Your tracking code is ${trackingCode}. Label URL: ${labelUrl}`,
    html: `<p>Your order <strong>${orderNumber}</strong> has a tracking code: <strong>${trackingCode}</strong>.</p><p>Label: <a href="${labelUrl}">${labelUrl}</a></p>`,
  });
};

const sendReportEmail = async (to, subject, text, html) => {
  await sendEmail({ to, subject, text, html });
};

module.exports = {
  sendOtpEmail,
  sendInvoiceEmail,
  sendOrderTrackingEmail,
  sendReportEmail,
};
