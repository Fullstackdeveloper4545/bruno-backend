const express = require('express');
const path = require('path');
const cors = require('cors');

const loggerMiddleware = require('../middleware/logger.middleware');
const errorHandlerMiddleware = require('../middleware/errorHandler.middleware');
const moduleGate = require('../middleware/moduleGate.middleware');
const featureFlags = require('./featureFlags');

const authRoutes = require('../modules/auth/auth.routes');
const productRoutes = require('../modules/product/product.routes');
const storeRoutes = require('../modules/store/store.routes');
const orderRoutes = require('../modules/order/order.routes');
const paymentRoutes = require('../modules/payment/payment.routes');
const shippingRoutes = require('../modules/shipping/shipping.routes');
const discountRoutes = require('../modules/discount/discount.routes');
const invoiceRoutes = require('../modules/invoice/invoice.routes');
const integrationRoutes = require('../modules/integration/integration.routes');
const reportRoutes = require('../modules/report/report.routes');
const languageRoutes = require('../routes/languageRoutes');
const legacyProductRoutes = require('../routes/productRoutes');
const uploadRoutes = require('../routes/uploadRoutes');
const systemRoutes = require('../routes/systemRoutes');

const app = express();

app.use(cors());
app.use(express.json());
app.use(loggerMiddleware);
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
app.use('/labels', express.static(path.join(__dirname, '..', 'labels')));
app.use('/api/system', systemRoutes);

if (featureFlags.modules.auth) app.use('/api/auth', authRoutes);
if (featureFlags.modules.product) {
  app.use('/api/catalog', moduleGate('product'), productRoutes);
  app.use('/api/products', moduleGate('product'), legacyProductRoutes);
}
if (featureFlags.modules.store) app.use('/api/stores', storeRoutes);
if (featureFlags.modules.order) app.use('/api/orders', moduleGate('order'), orderRoutes);
if (featureFlags.modules.payment) app.use('/api/payments', moduleGate('payment'), paymentRoutes);
if (featureFlags.modules.shipping) app.use('/api/shipping', moduleGate('shipping'), shippingRoutes);
if (featureFlags.modules.discount) app.use('/api/discounts', moduleGate('discount'), discountRoutes);
if (featureFlags.modules.invoice) app.use('/api/invoices', moduleGate('invoice'), invoiceRoutes);
if (featureFlags.modules.integration) app.use('/api/integration', integrationRoutes);
if (featureFlags.modules.report) app.use('/api/reports', moduleGate('report'), reportRoutes);
if (featureFlags.modules.language) app.use('/api/languages', languageRoutes);
app.use('/api/uploads', uploadRoutes);

app.get('/', (req, res) => {
  res.send('Backend Running');
});

app.use(errorHandlerMiddleware);

module.exports = app;
