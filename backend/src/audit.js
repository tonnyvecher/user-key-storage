const pool = require("./db");

// userId может быть null (например, системные события)
async function logAudit(userId, action, meta = {}) {
  try {
    await pool.query(
      "INSERT INTO audit_logs (user_id, action, meta) VALUES ($1, $2, $3)",
      [userId || null, action, meta]
    );
  } catch (err) {
    console.error("Failed to write audit log:", err.message);
    // важно: не валим основной запрос, если лог не записался
  }
}

module.exports = { logAudit };
