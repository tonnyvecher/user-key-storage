const express = require("express");
const pool = require("./db");
const { logAudit } = require("./audit");
const { authKeycloakMiddleware } = require("./authMiddleware");
const { encryptField, decryptField, signAccessOperation, rotateMasterKey } = require("./cryptoClient");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

/**
 * Health-check сервиса
 */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "backend",
    time: new Date().toISOString()
  });
});

/**
 * Проверка подключения к БД
 */
app.get("/db-health", async (req, res) => {
  try {
    const result = await pool.query("SELECT 1 as ok");
    res.json({
      status: "ok",
      db: true,
      result: result.rows[0]
    });
  } catch (err) {
    console.error("DB health error:", err);
    res.status(500).json({
      status: "error",
      db: false,
      message: err.message
    });
  }
});

/**
 * Список пользователей
 */
app.get("/users", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, primary_email, is_active, created_at FROM users ORDER BY created_at DESC"
    );
    res.json({
      status: "ok",
      count: result.rows.length,
      users: result.rows
    });
  } catch (err) {
    console.error("Error fetching users:", err);
    res.status(500).json({
      status: "error",
      message: err.message
    });
  }
});

/**
 * Создать пользователя
 */
app.post("/users", async (req, res) => {
  try {
    const { primary_email } = req.body;

    if (!primary_email) {
      return res.status(400).json({
        status: "error",
        message: "primary_email is required"
      });
    }

    const result = await pool.query(
      "INSERT INTO users (primary_email) VALUES ($1) RETURNING id, primary_email, is_active, created_at",
      [primary_email]
    );

    const user = result.rows[0];

    // аудит: создан пользователь
    await logAudit(user.id, "USER_CREATED", { primary_email });

    res.status(201).json({
      status: "ok",
      user
    });
  } catch (err) {
    console.error("Error creating user:", err);
    res.status(500).json({
      status: "error",
      message: err.message
    });
  }
});

/**
 * Добавить роль пользователю
 */

// старая версия POST-запроса задавания роли пользователю (без шифрования)
// app.post("/users/:id/roles", async (req, res) => {
//   try {
//     const userId = req.params.id;
//     const { role_name } = req.body;

//     if (!role_name) {
//       return res.status(400).json({
//         status: "error",
//         message: "role_name is required"
//       });
//     }

//     const userCheck = await pool.query(
//       "SELECT id FROM users WHERE id = $1",
//       [userId]
//     );
//     if (userCheck.rowCount === 0) {
//       return res.status(404).json({
//         status: "error",
//         message: "User not found"
//       });
//     }

//     const result = await pool.query(
//       "INSERT INTO user_roles (user_id, role_name) VALUES ($1, $2) RETURNING id, user_id, role_name, created_at",
//       [userId, role_name]
//     );

//     const role = result.rows[0];

//     // аудит: назначена роль
//     await logAudit(userId, "ROLE_ASSIGNED", { role_name });

//     res.status(201).json({
//       status: "ok",
//       role
//     });
//   } catch (err) {
//     console.error("Error adding role:", err);
//     res.status(500).json({
//       status: "error",
//       message: err.message
//     });
//   }
// });

// новая версия POST-запроса (с шифрованием)
app.post("/users/:id/roles", async (req, res) => {
  try {
    const userId = req.params.id;
    const { role_name } = req.body;

    if (!role_name) {
      return res.status(400).json({
        status: "error",
        message: "role_name is required"
      });
    }

    // проверка, что пользователь существует
    const userCheck = await pool.query(
      "SELECT id FROM users WHERE id = $1",
      [userId]
    );
    if (userCheck.rowCount === 0) {
      return res.status(404).json({
        status: "error",
        message: "User not found"
      });
    }

    // получаем подпись операции из обертки
    const signature = await signAccessOperation(userId, role_name, "GRANT_ROLE");

    const result = await pool.query(
      "INSERT INTO user_roles (user_id, role_name, signature) VALUES ($1, $2, $3) RETURNING id, user_id, role_name, created_at, signature",
      [userId, role_name, signature]
    );

    res.status(201).json({
      status: "ok",
      role: result.rows[0]
    });
  } catch (err) {
    console.error("Error adding role:", err);
    res.status(500).json({
      status: "error",
      message: err.message
    });
  }
});

/**
 * Список ролей пользователя
 */
app.get("/users/:id/roles", async (req, res) => {
  try {
    const userId = req.params.id;

    const result = await pool.query(
      "SELECT role_name, created_at FROM user_roles WHERE user_id = $1 ORDER BY created_at DESC",
      [userId]
    );

    res.json({
      status: "ok",
      count: result.rows.length,
      roles: result.rows
    });
  } catch (err) {
    console.error("Error fetching user roles:", err);
    res.status(500).json({
      status: "error",
      message: err.message
    });
  }
});

/**
 * Внешние аккаунты пользователя (список)
 */
app.get("/users/:id/external-accounts", async (req, res) => {
  try {
    const userId = req.params.id;

    const result = await pool.query(
      `SELECT id, provider, provider_user_id, provider_email, created_at
       FROM external_accounts
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json({
      status: "ok",
      count: result.rows.length,
      external_accounts: result.rows
    });
  } catch (err) {
    console.error("Error fetching external accounts:", err);
    res.status(500).json({
      status: "error",
      message: err.message
    });
  }
});

/**
 * Привязать внешний аккаунт к пользователю
 */
app.post("/users/:id/external-accounts", async (req, res) => {
  try {
    const userId = req.params.id;
    const { provider, provider_user_id, provider_email } = req.body;

    if (!provider || !provider_user_id) {
      return res.status(400).json({
        status: "error",
        message: "provider and provider_user_id are required"
      });
    }

    const userCheck = await pool.query(
      "SELECT id FROM users WHERE id = $1",
      [userId]
    );
    if (userCheck.rowCount === 0) {
      return res.status(404).json({
        status: "error",
        message: "User not found"
      });
    }

    const result = await pool.query(
      `INSERT INTO external_accounts (user_id, provider, provider_user_id, provider_email)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, provider, provider_user_id, provider_email, created_at`,
      [userId, provider, provider_user_id, provider_email || null]
    );

    const externalAccount = result.rows[0];

    // аудит: привязан внешний аккаунт
    await logAudit(userId, "EXTERNAL_ACCOUNT_LINKED", {
      provider,
      provider_user_id
    });

    res.status(201).json({
      status: "ok",
      external_account: externalAccount
    });
  } catch (err) {
    console.error("Error creating external account:", err);
    res.status(500).json({
      status: "error",
      message: err.message
    });
  }
});

/**
 * Профиль пользователя: получить
 */
app.get("/users/:id/profile", async (req, res) => {
  try {
    const userId = req.params.id;

    const result = await pool.query(
      `SELECT id, user_id, full_name, phone_encrypted, birth_date_encrypted, settings, created_at, updated_at
       FROM profiles
       WHERE user_id = $1`,
      [userId]
    );

    if (result.rowCount === 0) {
      return res.json({
        status: "ok",
        profile: null
      });
    }

    const row = result.rows[0];

    let phone = null;
    let birthDate = null;

    try {
      phone = await decryptField(userId, "phone", row.phone_encrypted);
      birthDate = await decryptField(
        userId,
        "birth_date",
        row.birth_date_encrypted
      );
    } catch (e) {
      console.error("Error decrypting profile fields:", e.message);
    }

    res.json({
      status: "ok",
      // profile: result.rows[0]
      profile: {
        id: row.id,
        user_id: row.user_id,
        full_name: row.full_name,
        phone,
        birth_date: birthDate,
        settings: row.settings,
        created_at: row.created_at,
        updated_at: row.updated_at
      }
    });
  } catch (err) {
    console.error("Error fetching profile:", err);
    res.status(500).json({
      status: "error",
      message: err.message
    });
  }
});

/**
 * Профиль пользователя: создать/обновить (upsert)
 */
app.post("/users/:id/profile", async (req, res) => {
  try {
    const userId = req.params.id;
    const { full_name, phone, birth_date, settings } = req.body;

    // проверяем, что пользователь существует
    const userCheck = await pool.query(
      "SELECT id FROM users WHERE id = $1",
      [userId]
    );
    if (userCheck.rowCount === 0) {
      return res.status(404).json({
        status: "error",
        message: "User not found"
      });
    }

    // шифруем чувствительные поля через обертку
    const encryptedPhone = phone
      ? await encryptField(userId, "phone", phone)
      : null;

    const encryptedBirthDate = birth_date
      ? await encryptField(userId, "birth_date", birth_date)
      : null;

    const result = await pool.query(
      `INSERT INTO profiles (user_id, full_name, phone_encrypted, birth_date_encrypted, settings)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE
       SET full_name = EXCLUDED.full_name,
           phone_encrypted = EXCLUDED.phone_encrypted,
           birth_date_encrypted = EXCLUDED.birth_date_encrypted,
           settings = EXCLUDED.settings,
           updated_at = now()
       RETURNING id, user_id, full_name, phone_encrypted, birth_date_encrypted, settings, created_at, updated_at`,
      [
        userId,
        full_name || null,
        encryptedPhone,
        encryptedBirthDate,
        settings || null
      ]
    );

    const row = result.rows[0];

    await logAudit(userId, "PROFILE_UPSERTED", {
      has_full_name: !!full_name,
      has_phone: !!phone,
      has_birth_date: !!birth_date,
      encrypted: true
    });

    res.json({
      status: "ok",
      profile: {
        id: row.id,
        user_id: row.user_id,
        full_name: row.full_name,
        phone,        // отдаём уже расшифрованные значения (мы их знаем из запроса)
        birth_date,
        settings: row.settings,
        created_at: row.created_at,
        updated_at: row.updated_at
      }
    });
  } catch (err) {
    console.error("Error upserting profile:", err);
    res.status(500).json({
      status: "error",
      message: err.message
    });
  }
});

/**
 * Тест "защищённого" доступа по роли ADMIN.
 *
 * Ожидает:
 *   Authorization: Bearer <access_token>
 *
 * Пользователь определяется через authKeycloakMiddleware.
 */
app.get("/secure-test", authKeycloakMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      "SELECT 1 FROM user_roles WHERE user_id = $1 AND role_name = $2 LIMIT 1",
      [userId, "ADMIN"]
    );

    if (result.rowCount === 0) {
      await logAudit(userId, "SECURE_TEST_DENIED", {
        required_role: "ADMIN"
      });

      return res.status(403).json({
        status: "forbidden",
        message: "User does not have ADMIN role"
      });
    }

    await logAudit(userId, "SECURE_TEST_GRANTED", {
      required_role: "ADMIN"
    });

    res.json({
      status: "ok",
      message: "User has ADMIN role, access granted",
      user: req.user
    });
  } catch (err) {
    console.error("Error in secure-test:", err);
    res.status(500).json({
      status: "error",
      message: err.message
    });
  }
});


/**
 * Логин через Keycloak-токен.
 *
 * Ожидаем заголовок:
 *   Authorization: Bearer <access_token>
 *
 * Делаем:
 *  - разбираем токен;
 *  - находим или создаём user + external_account;
 *  - возвращаем информацию о внутреннем пользователе.
 */
app.post("/auth/keycloak", authKeycloakMiddleware, (req, res) => {
  const { payload, created } = req.auth;

  res.json({
    status: "ok",
    source: "keycloak",
    created,
    user: req.user,
    token_info: {
      sub: payload.sub,
      email: payload.email || null
    }
  });
});

// Админ-эндпоинт для ротации мастер-ключа профиля.
// В реальной системе его надо защищать, здесь — для демо.
app.post("/admin/rotate-master", async (req, res) => {
  try {
    const result = await rotateMasterKey();
    res.json({
      status: "ok",
      message: result
    });
  } catch (err) {
    console.error("Error rotating master key:", err);
    res.status(500).json({
      status: "error",
      message: err.message
    });
  }
});



app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
