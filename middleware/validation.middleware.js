function validationMiddleware(validateFn) {
  return (req, res, next) => {
    try {
      const result = validateFn ? validateFn(req) : null;
      if (result && result.valid === false) {
        return res.status(400).json({
          message: result.message || 'Validation failed',
          errors: result.errors || [],
        });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = validationMiddleware;