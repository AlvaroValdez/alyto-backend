// backend/src/middleware/errorHandler.js
module.exports = function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const body = {
    ok: false,
    error: err.message || 'Error interno',
  };
  if (err.data) body.details = err.data;
  res.status(status).json(body);
};
