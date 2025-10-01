// backend/src/routes/auth.js
// Justificación: esqueleto de autenticación (login/register)
// Por ahora responde placeholders.

const router = require("express").Router();

// POST /api/auth/login
router.post("/login", (req, res) => {
  res.json({ ok: true, message: "🚧 Login no implementado (placeholder)" });
});

// POST /api/auth/register
router.post("/register", (req, res) => {
  res.json({ ok: true, message: "🚧 Registro no implementado (placeholder)" });
});

module.exports = router;
