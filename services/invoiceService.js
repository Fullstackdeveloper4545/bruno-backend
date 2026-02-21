const PDFDocument = require('pdfkit');
const { sendInvoiceEmail } = require('./mailService');
const { syncInvoice } = require('./integration/syncService');

function formatDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function formatMoney(value) {
  const numeric = Number(value);
  return `EUR ${Number.isFinite(numeric) ? numeric.toFixed(2) : '0.00'}`;
}

function formatDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '-';
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)}`;
}

function safeText(value, fallback = '-') {
  const text = value == null ? '' : String(value).trim();
  return text || fallback;
}

function truncateText(text, max = 48) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}...`;
}

function toTitle(value) {
  return safeText(value, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase()) || '-';
}

function summarizeSpecifications(rawSpecs) {
  if (rawSpecs == null) return 'Standard product configuration';

  let specs = rawSpecs;
  if (typeof specs === 'string') {
    try {
      specs = JSON.parse(specs);
    } catch (_) {
      return truncateText(safeText(specs, 'Standard product configuration'), 72);
    }
  }

  if (Array.isArray(specs)) {
    const entries = specs
      .map((item) => {
        if (item && typeof item === 'object') {
          const label = item.name || item.key || item.label || item.attribute || item.title;
          const value = item.value || item.val || item.option;
          if (label && value) return `${label}: ${value}`;
          if (label) return String(label);
        }
        if (typeof item === 'string' || typeof item === 'number') return String(item);
        return '';
      })
      .filter(Boolean)
      .slice(0, 3);
    if (entries.length > 0) return truncateText(entries.join(' | '), 90);
    return 'Standard product configuration';
  }

  if (specs && typeof specs === 'object') {
    const entries = Object.entries(specs)
      .map(([key, value]) => `${key}: ${value}`)
      .slice(0, 3);
    if (entries.length > 0) return truncateText(entries.join(' | '), 90);
  }

  return 'Standard product configuration';
}

function renderInvoicePdf(order, items, details = {}) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks = [];
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const contentWidth = right - left;
    const pageBottom = doc.page.height - doc.page.margins.bottom;
    const palette = {
      ink: '#0F172A',
      slate: '#334155',
      muted: '#64748B',
      line: '#CBD5E1',
      panel: '#F8FAFC',
      panelAlt: '#EEF2FF',
      accent: '#1D4ED8',
      accentDark: '#0B1220',
      accentSoft: '#DBEAFE',
      white: '#FFFFFF',
    };

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));

    const payment = details.payment || null;
    const shipment = details.shipment || null;
    const invoiceDate = formatDate(order.created_at);
    const dueDate = formatDate(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const subtotal = Number(order.subtotal || 0);
    const discount = Number(order.discount_total || 0);
    const total = Number(order.total || 0);
    const safeItems = Array.isArray(items) ? items : [];

    const drawTableHeader = (docRef, yPos, cols) => {
      docRef.roundedRect(left, yPos, contentWidth, 24, 6).fill(palette.panelAlt);
      docRef.fillColor(palette.slate).font('Helvetica-Bold').fontSize(8);
      docRef.text('Item', cols.item.x, yPos + 8, { width: cols.item.w });
      docRef.text('SKU', cols.sku.x, yPos + 8, { width: cols.sku.w });
      docRef.text('Specifications', cols.spec.x, yPos + 8, { width: cols.spec.w });
      docRef.text('Qty', cols.qty.x, yPos + 8, { width: cols.qty.w, align: 'right' });
      docRef.text('Unit Price', cols.unit.x, yPos + 8, { width: cols.unit.w, align: 'right' });
      docRef.text('Line Total', cols.total.x, yPos + 8, { width: cols.total.w, align: 'right' });
      return yPos + 24;
    };

    const drawInfoCard = (xPos, yPos, width, height, title, lines) => {
      doc.roundedRect(xPos, yPos, width, height, 8).fill(palette.panel);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(palette.slate).text(title, xPos + 10, yPos + 10);
      let lineY = yPos + 26;
      lines.forEach((line) => {
        doc.font('Helvetica').fontSize(8.5).fillColor(palette.ink);
        doc.text(`${line.label}: ${line.value}`, xPos + 10, lineY, { width: width - 20 });
        lineY += 14;
      });
    };

    // Header band
    doc.rect(0, 0, doc.page.width, 142).fill(palette.accentDark);
    doc.fillColor(palette.white).font('Helvetica-Bold').fontSize(20).text('Bruno Marketplace', left, 42);
    doc.font('Helvetica').fontSize(9.5).fillColor('#93C5FD').text('Portugal & Espanha | support@bruno-marketplace.com', left, 67);
    doc.font('Helvetica').fontSize(9).fillColor('#BFDBFE').text('Rua Comercio 29, Lisbon', left, 84);
    doc.font('Helvetica-Bold').fontSize(26).fillColor('#BFDBFE').text('INVOICE', left, 46, {
      width: contentWidth,
      align: 'right',
    });
    doc.roundedRect(right - 180, 78, 180, 30, 6).fill(palette.accent);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(palette.white).text(`No. ${safeText(order.invoice_number)}`, right - 170, 88, {
      width: 160,
      align: 'right',
    });
    doc.font('Helvetica').fontSize(9).fillColor('#BFDBFE').text(`Generated: ${invoiceDate}`, left, 102, {
      width: contentWidth,
      align: 'right',
    });

    let y = 156;

    // Meta cards with payment and shipment blocks
    const cardGap = 10;
    const cardWidth = (contentWidth - cardGap * 2) / 3;
    const cardHeight = 90;

    drawInfoCard(left, y, cardWidth, cardHeight, 'Invoice Summary', [
      { label: 'Order', value: safeText(order.order_number) },
      { label: 'Invoice Date', value: invoiceDate },
      { label: 'Due Date', value: dueDate },
      { label: 'Currency', value: 'EUR' },
    ]);
    drawInfoCard(left + cardWidth + cardGap, y, cardWidth, cardHeight, 'Payment Details', [
      { label: 'Method', value: toTitle(payment?.provider_method || payment?.method || 'manual') },
      { label: 'Provider', value: toTitle(payment?.provider || 'manual') },
      { label: 'Status', value: toTitle(payment?.status || order.payment_status || 'pending') },
      { label: 'Amount', value: formatMoney(payment?.amount || total) },
    ]);
    drawInfoCard(left + (cardWidth + cardGap) * 2, y, cardWidth, cardHeight, 'Shipment Details', [
      { label: 'Provider', value: toTitle(shipment?.provider || 'not_assigned') },
      { label: 'Status', value: toTitle(shipment?.status || order.shipping_status || 'not_created') },
      { label: 'Tracking', value: safeText(shipment?.tracking_code || order.shipping_tracking_code || '-') },
      { label: 'Updated', value: formatDateTime(shipment?.updated_at || order.updated_at) },
    ]);

    y += cardHeight + 12;

    // Bill to
    doc.roundedRect(left, y, contentWidth, 86, 8).fill(palette.panel);
    doc.roundedRect(left + 8, y + 8, contentWidth * 0.49, 70, 6).fill(palette.white);
    doc.roundedRect(left + contentWidth * 0.51, y + 8, contentWidth * 0.49 - 8, 70, 6).fill(palette.white);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(palette.slate).text('Bill To', left + 16, y + 16);
    doc.font('Helvetica').fontSize(9).fillColor(palette.ink);
    doc.text(safeText(order.customer_name), left + 12, y + 30);
    doc.text(safeText(order.customer_email), left + 12, y + 46, { width: contentWidth * 0.46 });

    doc.font('Helvetica-Bold').fontSize(9).fillColor(palette.slate).text('Ship To', left + contentWidth * 0.53, y + 16);
    doc.font('Helvetica').fontSize(9).fillColor(palette.ink);
    doc.text(safeText(order.shipping_address), left + contentWidth * 0.53, y + 30, { width: contentWidth * 0.44 });
    doc.text(`Region: ${safeText(order.shipping_region, '-')}`, left + contentWidth * 0.53, y + 62, {
      width: contentWidth * 0.44,
    });

    y += 102;

    // Items table
    const cols = {
      item: { x: left + 8, w: 152 },
      sku: { x: left + 164, w: 65 },
      spec: { x: left + 233, w: 120 },
      qty: { x: left + 357, w: 30 },
      unit: { x: left + 391, w: 58 },
      total: { x: left + 453, w: 58 },
    };
    const rowHeight = 32;

    y = drawTableHeader(doc, y, cols);

    doc.font('Helvetica').fontSize(8.5);
    safeItems.forEach((item, index) => {
      if (y > pageBottom - 170) {
        doc.addPage();
        y = 56;
        y = drawTableHeader(doc, y, cols);
      }

      if (index % 2 === 0) {
        doc.rect(left, y, contentWidth, rowHeight).fill('#FDFEFF');
      }

      const specsText = truncateText(safeText(item.specification_summary, 'Standard product configuration'), 54);

      doc.fillColor(palette.ink);
      doc.text(truncateText(safeText(item.product_name), 42), cols.item.x, y + 8, { width: cols.item.w });
      doc.text(truncateText(safeText(item.sku), 18), cols.sku.x, y + 8, { width: cols.sku.w });
      doc.fillColor(palette.slate).fontSize(7.8).text(specsText, cols.spec.x, y + 8, { width: cols.spec.w });
      doc.fillColor(palette.ink).fontSize(8.5);
      doc.text(String(Number(item.quantity || 0)), cols.qty.x, y + 8, { width: cols.qty.w, align: 'right' });
      doc.text(formatMoney(item.unit_price), cols.unit.x, y + 8, { width: cols.unit.w, align: 'right' });
      doc.text(formatMoney(item.line_total), cols.total.x, y + 8, { width: cols.total.w, align: 'right' });
      y += rowHeight;
    });

    doc.strokeColor(palette.line).lineWidth(1).moveTo(left, y).lineTo(right, y).stroke();
    y += 14;

    if (y > pageBottom - 160) {
      doc.addPage();
      y = 56;
    }

    // Totals
    const totalsWidth = 230;
    const totalsX = right - totalsWidth;
    const totalsHeight = 84;
    doc.roundedRect(totalsX, y, totalsWidth, totalsHeight, 8).fill(palette.panel);
    doc.fillColor(palette.slate).font('Helvetica').fontSize(10);
    doc.text('Subtotal', totalsX + 12, y + 12);
    doc.text(formatMoney(subtotal), totalsX + 12, y + 12, { width: totalsWidth - 24, align: 'right' });
    doc.text('Discount', totalsX + 12, y + 33);
    doc.text(`- ${formatMoney(discount)}`, totalsX + 12, y + 33, { width: totalsWidth - 24, align: 'right' });
    doc.strokeColor(palette.line).moveTo(totalsX + 10, y + 52).lineTo(totalsX + totalsWidth - 10, y + 52).stroke();
    doc.font('Helvetica-Bold').fontSize(12).fillColor(palette.ink);
    doc.text('Total', totalsX + 12, y + 60);
    doc.text(formatMoney(total), totalsX + 12, y + 60, { width: totalsWidth - 24, align: 'right' });

    // Additional shipment + payment note
    const noteX = left;
    const noteWidth = contentWidth - totalsWidth - 12;
    if (noteWidth > 120) {
      doc.roundedRect(noteX, y, noteWidth, totalsHeight, 8).fill(palette.accentSoft);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(palette.accentDark).text('Fulfillment & Payment Notes', noteX + 10, y + 10);
      doc.font('Helvetica').fontSize(8.5).fillColor(palette.accentDark);
      doc.text(
        `Payment via ${toTitle(payment?.provider_method || payment?.method || 'manual')} (${toTitle(
          payment?.status || order.payment_status || 'pending'
        )}). Shipment ${toTitle(shipment?.status || order.shipping_status || 'not_created')} with tracking ${safeText(
          shipment?.tracking_code || order.shipping_tracking_code || 'pending'
        )}.`,
        noteX + 10,
        y + 26,
        { width: noteWidth - 20 }
      );
    }

    y += totalsHeight + 14;

    if (y > pageBottom - 110) {
      doc.addPage();
      y = 56;
    }

    // Product specification recap
    doc.roundedRect(left, y, contentWidth, 56, 8).fill(palette.panel);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(palette.slate).text('Product Specification Recap', left + 12, y + 10);
    const specPreview = safeItems
      .slice(0, 3)
      .map((item) => `${truncateText(safeText(item.product_name), 22)} - ${truncateText(safeText(item.specification_summary), 46)}`)
      .join('  |  ');
    doc.font('Helvetica').fontSize(8.3).fillColor(palette.ink).text(specPreview || 'Specifications are based on product master data.', left + 12, y + 26, {
      width: contentWidth - 24,
    });

    // Footer note
    const footerY = Math.max(y + 70, pageBottom - 34);
    doc.fillColor(palette.muted).font('Helvetica').fontSize(9);
    doc.text('Thank you for your purchase. Need help? Contact support@bruno-marketplace.com', left, footerY, {
      width: contentWidth,
      align: 'center',
    });

    doc.end();
  });
}

async function generateInvoiceForOrder(pool, orderId) {
  const orderResult = await pool.query(`
    SELECT o.*, CONCAT('INV-', LPAD(o.id::text, 6, '0')) AS invoice_number
    FROM orders o
    WHERE o.id = $1
  `, [orderId]);

  if (orderResult.rows.length === 0) {
    throw new Error('Order not found');
  }

  const order = orderResult.rows[0];

  const existing = await pool.query(`SELECT * FROM invoices WHERE order_id = $1`, [orderId]);
  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const itemsResult = await pool.query(`SELECT * FROM order_items WHERE order_id = $1 ORDER BY id ASC`, [orderId]);
  const paymentResult = await pool.query(
    `SELECT method, provider, provider_method, status, amount, transaction_ref, created_at
     FROM payments
     WHERE order_id = $1
     ORDER BY id DESC
     LIMIT 1`,
    [orderId]
  );
  const shipmentResult = await pool.query(
    `SELECT provider, status, tracking_code, label_url, created_at, updated_at
     FROM shipments
     WHERE order_id = $1
     ORDER BY id DESC
     LIMIT 1`,
    [orderId]
  );

  const itemRows = itemsResult.rows;
  const skus = [...new Set(itemRows.map((item) => safeText(item.sku, '').trim()).filter(Boolean))];
  const specsBySku = new Map();

  if (skus.length > 0) {
    const productsResult = await pool.query(
      `SELECT sku, specifications
       FROM products
       WHERE sku = ANY($1::text[])`,
      [skus]
    );

    productsResult.rows.forEach((product) => {
      specsBySku.set(safeText(product.sku, '').trim(), summarizeSpecifications(product.specifications));
    });
  }

  const enrichedItems = itemRows.map((item) => {
    const sku = safeText(item.sku, '').trim();
    return {
      ...item,
      specification_summary: specsBySku.get(sku) || 'Standard product configuration',
    };
  });

  const pdfBase64 = await renderInvoicePdf(order, enrichedItems, {
    payment: paymentResult.rows[0] || null,
    shipment: shipmentResult.rows[0] || null,
  });

  const invoiceResult = await pool.query(
    `INSERT INTO invoices (invoice_number, order_id, pdf_base64, synced)
     VALUES ($1, $2, $3, false)
     RETURNING *`,
    [order.invoice_number, orderId, pdfBase64]
  );

  const invoice = invoiceResult.rows[0];

  await sendInvoiceEmail(order.customer_email, invoice.invoice_number, pdfBase64);

  const syncResult = await syncInvoice(pool, {
    invoice_number: invoice.invoice_number,
    order_number: order.order_number,
    total: order.total,
    created_at: invoice.created_at,
  });

  if (syncResult.synced) {
    await pool.query(`UPDATE invoices SET synced = true WHERE id = $1`, [invoice.id]);
    invoice.synced = true;
  }

  return invoice;
}

module.exports = { generateInvoiceForOrder };
