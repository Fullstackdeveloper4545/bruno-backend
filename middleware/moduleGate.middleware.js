const { isModuleEnabled } = require('../services/moduleSettingsService');

function moduleGate(moduleKey) {
  return async (req, res, next) => {
    try {
      const enabled = await isModuleEnabled(moduleKey);
      if (!enabled) {
        return res.status(503).json({ message: `${moduleKey} module is disabled` });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = moduleGate;
