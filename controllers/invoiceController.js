const pool = require('../config/db');
const { sendInvoiceEmail } = require('../services/mailService');
const { syncInvoice } = require('../services/integration/syncService');

async function listInvoices(req, res) {
  try {
    const result = await pool.query(`SELECT i.*, o.order_number, o.customer_email, o.total FROM invoices i JOIN orders o ON o.id = i.order_id ORDER BY i.id DESC`);
    res.json(result.rows);
  } catch (error) { res.status(500).json({ message: error.message }); }
}

async function getInvoicePdf(req, res) {
  try {
    const id = Number(req.params.id);
    const result = await pool.query(`SELECT * FROM invoices WHERE id = $1`, [id]);
    if (!result.rows[0]) return res.status(404).json({ message: 'Invoice not found' });
    const buffer = Buffer.from(result.rows[0].pdf_base64, 'base64');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=${result.rows[0].invoice_number}.pdf`);
    res.send(buffer);
  } catch (error) { res.status(500).json({ message: error.message }); }
}

async function resendInvoice(req, res) {
  try {
    const id = Number(req.params.id);
    const result = await pool.query(`SELECT i.*, o.customer_email FROM invoices i JOIN orders o ON o.id = i.order_id WHERE i.id = $1`, [id]);
    if (!result.rows[0]) return res.status(404).json({ message: 'Invoice not found' });
    const invoice = result.rows[0];
    await sendInvoiceEmail(invoice.customer_email, invoice.invoice_number, invoice.pdf_base64);
    res.json({ success: true });
  } catch (error) { res.status(500).json({ message: error.message }); }
}

async function syncInvoices(req, res) {
  try {
    const invoices = await pool.query(`SELECT i.*, o.order_number, o.total FROM invoices i JOIN orders o ON o.id = i.order_id WHERE i.synced = false`);
    let synced = 0;
    for (const invoice of invoices.rows) {
      const result = await syncInvoice(pool, { invoice_number: invoice.invoice_number, order_number: invoice.order_number, total: invoice.total, created_at: invoice.created_at });
      if (result.synced) {
        await pool.query(`UPDATE invoices SET synced = true WHERE id = $1`, [invoice.id]);
        synced += 1;
      }
    }
    res.json({ synced });
  } catch (error) { res.status(500).json({ message: error.message }); }
}

module.exports = { listInvoices, getInvoicePdf, resendInvoice, syncInvoices };
