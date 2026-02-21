const { runDueSchedules } = require('./reportService');

let timer = null;

function startReportScheduler(pool) {
  if (timer) return;

  timer = setInterval(async () => {
    try {
      await runDueSchedules(pool);
    } catch (error) {
      console.error('Daily report scheduler failed:', error.message);
    }
  }, 60 * 1000);
}

module.exports = { startReportScheduler };
