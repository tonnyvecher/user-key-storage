// backend/src/authMiddleware.js
const { parseJwt, getOrCreateUserFromKeycloak } = require("./authKeycloak");
const pool = require("./db");
const { logAudit } = require("./audit");

/**
 * Middleware аутентификации через Keycloak.
 *
 * Ожидает заголовок:
 *   Authorization: Bearer <access_token>
 *
 * На выходе:
 *   req.user = { id, primary_email, roles: [...] }
 *   req.auth = { provider: "keycloak", payload, created }
 */
async function authKeycloakMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const [scheme, token] = authHeader.split(" ");

    if (scheme !== "Bearer" || !token) {
      return res.status(401).json({
        status: "error",
        message: "Authorization header with Bearer token is required"
      });
    }

    let payload;
    try {
      payload = parseJwt(token);
    } catch (e) {
      console.error("Failed to parse Keycloak token:", e);
      return res.status(400).json({
        status: "error",
        message: "Invalid JWT token"
      });
    }

    const { user, created } = await getOrCreateUserFromKeycloak(
      pool,
      payload,
      logAudit
    );

    req.user = user;
    req.auth = {
      provider: "keycloak",
      payload,
      created
    };

    next();
  } catch (err) {
    console.error("authKeycloakMiddleware error:", err);
    res.status(500).json({
      status: "error",
      message: "Internal auth error"
    });
  }
}

module.exports = {
  authKeycloakMiddleware
};
