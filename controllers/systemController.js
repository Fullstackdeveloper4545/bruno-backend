const { getModuleSettings, setModuleEnabled } = require('../services/moduleSettingsService');

async function getModules(req, res) {
  try {
    const settings = await getModuleSettings();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

async function updateModule(req, res) {
  try {
    const moduleKey = String(req.params.module || '').trim().toLowerCase();
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ message: 'enabled must be boolean' });
    }

    const settings = await setModuleEnabled(moduleKey, enabled);
    res.json(settings);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ message: error.message });
  }
}

module.exports = {
  getModules,
  updateModule,
};
