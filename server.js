const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = require('./config/app');
const pool = require('./config/db');
const { ensureSchema } = require('./db/schema');
const { startReportScheduler } = require('./services/reports/reportScheduler');

const PORT = process.env.PORT || 5000;

async function bootstrap() {
  await ensureSchema();
  startReportScheduler(pool);

  app.listen(PORT, () => {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.warn('EMAIL_USER/EMAIL_PASS missing. OTP/report/invoice emails may fail.');
    }
    console.log(`Server running on port ${PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});