// backend/src/authKeycloak.js
/**
 * Примитивный разбор JWT без проверки подписи.
 * Для прототипа ок, но в реальной системе нужно проверять подпись и iss/aud.
 */
function parseJwt(token) {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid JWT format");
    }
  
    const payloadB64 = parts[1];
    const payloadJson = Buffer.from(payloadB64, "base64url").toString("utf8");
    return JSON.parse(payloadJson);
  }
  
  /**
   * Находим или создаём пользователя по данным токена Keycloak.
   *
   * provider = 'keycloak'
   * provider_user_id = payload.sub
   * email = payload.email || payload.preferred_username
   *
   * Возвращаем:
   * {
   *   user: { ...из таблицы users... },
   *   created: true/false
   * }
   */
  async function getOrCreateUserFromKeycloak(pool, payload, logAudit) {
    const provider = "keycloak";
  
    const sub = payload.sub;
    if (!sub) {
      throw new Error("Keycloak token does not contain 'sub'");
    }
  
    const providerUserId = String(sub);
    const email =
      payload.email ||
      payload.preferred_username ||
      `user-${providerUserId}@noemail.local`;
  
    let userId;
    let primaryEmail;
    let created = false;
  
    // 1. Пробуем найти существующий external_account
    const extResult = await pool.query(
      `SELECT ea.id,
              ea.user_id,
              u.primary_email
       FROM external_accounts ea
       JOIN users u ON u.id = ea.user_id
       WHERE ea.provider = $1 AND ea.provider_user_id = $2
       LIMIT 1`,
      [provider, providerUserId]
    );
  
    if (extResult.rowCount > 0) {
      const row = extResult.rows[0];
      userId = row.user_id;
      primaryEmail = row.primary_email;
  
      await logAudit(userId, "KEYCLOAK_LOGIN_EXISTING", {
        provider,
        provider_user_id: providerUserId
      });
    } else {
      // 2. Пользователя ещё нет → создаём user
      const userResult = await pool.query(
        `INSERT INTO users (primary_email)
         VALUES ($1)
         RETURNING id, primary_email, is_active, created_at`,
        [email]
      );
  
      const user = userResult.rows[0];
      userId = user.id;
      primaryEmail = user.primary_email;
      created = true;
  
      await logAudit(userId, "USER_CREATED_FROM_KEYCLOAK", {
        primary_email: primaryEmail
      });
  
      // 3. Привязываем external_account
      const extInsert = await pool.query(
        `INSERT INTO external_accounts (user_id, provider, provider_user_id, provider_email)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [userId, provider, providerUserId, payload.email || null]
      );
  
      await logAudit(userId, "EXTERNAL_ACCOUNT_LINKED", {
        provider,
        provider_user_id: providerUserId,
        external_account_id: extInsert.rows[0].id
      });
    }
  
    // 4. Загружаем роли пользователя
    const rolesResult = await pool.query(
      `SELECT role_name FROM user_roles WHERE user_id = $1`,
      [userId]
    );
  
    const roles = rolesResult.rows.map(r => r.role_name);
  
    return {
      user: {
        id: userId,
        primary_email: primaryEmail,
        roles
      },
      created
    };
  }
  
  module.exports = {
    parseJwt,
    getOrCreateUserFromKeycloak
  };
  