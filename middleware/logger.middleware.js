function loggerMiddleware(req, res, next) {
  const startedAt = Date.now();

  res.on('finish', () => {
    const elapsedMs = Date.now() - startedAt;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ${res.statusCode} ${elapsedMs}ms`);
  });

  next();
}

module.exports = loggerMiddleware;