import logger from '../config/logger.js';

export const errorHandler = (err, req, res, next) => {
  const status = err.status || 500;
  const message = err.message || 'Error interno del servidor';

  // Log estructurado
  logger.error({
    message: message,
    status: status,
    stack: err.stack,
    path: req.originalUrl,
    method: req.method,
    ip: req.ip
  });

  res.status(status).json({
    ok: false,
    error: message,
    // Mostrar stack trace solo en desarrollo para depuración
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};
