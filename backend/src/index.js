const express = require("express");
const pool = require("./db");
const { logAudit } = require("./audit");
const { authKeycloakMiddleware } = require("./authMiddleware");
const { encryptField, decryptField, signAccessOperation, rotateMasterKey } = require("./cryptoClient");

// --------- Role hierarchy for notes access ---------
const ROLE_RANK = {
  USER: 1,
  MANAGER: 2,
  ADMIN: 3,
  SUPERADMIN: 4,
  OWNER: 5
};

function getRoleRank(roleName) {
  if (!roleName) return 0;
  const upper = String(roleName).toUpperCase();
  return ROLE_RANK[upper] || 0;
}

const app = express();
const port = process.env.PORT || 3000;

// Получаем максимальный уровень роли пользователя с учётом проверки подписи через /users/:id/roles/verify
async function getUserMaxRoleRank(userId) {
  try {
    const verifyRes = await fetch(`http://localhost:${port}/users/${userId}/roles/verify`);
    if (!verifyRes.ok) {
      console.error("getUserMaxRoleRank: verify endpoint returned", verifyRes.status);
      return 0;
    }
    const data = await verifyRes.json();
    const roles = data.roles || [];

    let maxRank = 0;
    for (const r of roles) {
      if (r.valid) {
        const rank = getRoleRank(r.role_name);
        if (rank > maxRank) maxRank = rank;
      }
    }
    return maxRank;
  } catch (e) {
    console.error("getUserMaxRoleRank error:", e);
    return 0;
  }
}

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

// лёгкий эндпоинт в backend, который будет:
// читать роли из user_roles,
// для каждой роли:
// если подписи нет → помечаем как «без подписи»;
// если подпись есть → дергаем обёртку, пересчитываем HMAC и сравниваем.

app.get("/users/:id/roles/verify", async (req, res) => {
  try {
    const userId = req.params.id;

    // Берём все роли пользователя
    const result = await pool.query(
      "SELECT id, role_name, created_at, signature FROM user_roles WHERE user_id = $1 ORDER BY created_at DESC",
      [userId]
    );

    const rows = result.rows;

    if (rows.length === 0) {
      return res.json({
        status: "ok",
        count: 0,
        roles: []
      });
    }

    // Для каждой роли проверяем подпись (если она есть)
    const rolesWithCheck = await Promise.all(
      rows.map(async (row) => {
        const base = {
          id: row.id,
          role_name: row.role_name,
          created_at: row.created_at,
          has_signature: !!row.signature
        };

        if (!row.signature) {
          return {
            ...base,
            valid: false,
            integrity: "missing_signature",
            reason: "Role record has no cryptographic signature (legacy or tampered)"
          };
        }

        try {
          // Пересчитываем подпись через обёртку
          const expected = await signAccessOperation(userId, row.role_name, "GRANT_ROLE");

          if (expected === row.signature) {
            return {
              ...base,
              valid: true,
              integrity: "ok",
              reason: "Signature matches HMAC(user_id, role_name, action)"
            };
          } else {
            return {
              ...base,
              valid: false,
              integrity: "signature_mismatch",
              reason: "Stored signature does not match recomputed HMAC"
            };
          }
        } catch (err) {
          console.error("Error verifying role signature:", err);
          return {
            ...base,
            valid: false,
            integrity: "verification_error",
            reason: "Error during HMAC verification: " + err.message
          };
        }
      })
    );

    res.json({
      status: "ok",
      count: rolesWithCheck.length,
      roles: rolesWithCheck
    });
  } catch (err) {
    console.error("Error in /users/:id/roles/verify:", err);
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
app.get("/secure-test", async (req, res) => {
  try {
    // 1. Определяем userId:
    //    - если запрос пришёл с токеном Keycloak → берем из req.user.id
    //    - если тестируешь через PowerShell → можно передать ?userId=...
    const userId = req.user?.id || req.query.userId;

    if (!userId) {
      return res.status(400).json({
        status: "error",
        message: "userId is required (either from auth middleware or query param)"
      });
    }

    // 2. Достаём все роли пользователя
    const result = await pool.query(
      "SELECT id, role_name, signature, created_at FROM user_roles WHERE user_id = $1",
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({
        status: "forbidden",
        message: "User has no roles"
      });
    }

    // 3. Отбираем только ADMIN
    const adminRoles = result.rows.filter((row) => row.role_name === "ADMIN");

    if (adminRoles.length === 0) {
      return res.status(403).json({
        status: "forbidden",
        message: "User does not have ADMIN role"
      });
    }

    // 4. Проверяем подпись для ADMIN ролей
    let hasValidAdmin = false;
    const details = [];

    for (const row of adminRoles) {
      const base = {
        role_name: row.role_name,
        signature: row.signature,
        created_at: row.created_at
      };

      if (!row.signature) {
        details.push({
          ...base,
          valid: false,
          reason: "ADMIN role has no signature (legacy or tampered)"
        });
        continue;
      }

      try {
        const expected = await signAccessOperation(userId, row.role_name, "GRANT_ROLE");

        if (expected === row.signature) {
          hasValidAdmin = true;
          details.push({
            ...base,
            valid: true,
            reason: "Signature matches HMAC(user_id, role_name, action)"
          });
          // можно break, но оставим как есть, если захочешь логировать все
        } else {
          details.push({
            ...base,
            valid: false,
            reason: "Stored signature does not match recomputed HMAC"
          });
        }
      } catch (err) {
        console.error("Error verifying ADMIN signature in /secure-test:", err);
        details.push({
          ...base,
          valid: false,
          reason: "Error during HMAC verification: " + err.message
        });
      }
    }

    if (!hasValidAdmin) {
      return res.status(403).json({
        status: "forbidden",
        message: "User's ADMIN roles are invalid or tampered",
        roles: details
      });
    }

    // 5. Если дошли до сюда — есть хотя бы один валидный ADMIN
    return res.json({
      status: "ok",
      message: "User has valid ADMIN role, access granted",
      roles: details
    });
  } catch (err) {
    console.error("Error in /secure-test:", err);
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

// -------- ADMIN: статус пользователей и целостность ролей --------
app.get("/admin/users/status", async (req, res) => {
  try {
    // 1. Берём всех пользователей из БД
    const usersRes = await pool.query(
      "SELECT id, primary_email, is_active, created_at FROM users ORDER BY created_at DESC"
    );
    const users = usersRes.rows;

    const results = [];

    // 2. Для каждого пользователя дергаем уже существующий эндпоинт /users/:id/roles/verify
    for (const u of users) {
      let rolesCount = 0;
      let hasIssues = false;

      try {
        const verifyRes = await fetch(
          `http://localhost:${port}/users/${u.id}/roles/verify`
        );

        if (verifyRes.ok) {
          const data = await verifyRes.json();
          const roles = data.roles || [];
          rolesCount = data.count ?? roles.length;
          // есть ли хотя бы одна роль с проблемой (valid === false)
          hasIssues = roles.some((r) => r.valid === false);
        } else {
          // если сам запрос /roles/verify вернул ошибку — считаем, что есть проблемы
          hasIssues = true;
        }
      } catch (e) {
        console.error("Error checking roles for user", u.id, e);
        hasIssues = true;
      }

      results.push({
        id: u.id,
        primary_email: u.primary_email,
        is_active: u.is_active,
        created_at: u.created_at,
        roles_count: rolesCount,
        has_issues: hasIssues
      });
    }

    res.json({
      status: "ok",
      count: results.length,
      users: results
    });
  } catch (err) {
    console.error("Error in /admin/users/status:", err);
    res.status(500).json({
      status: "error",
      message: err.message
    });
  }
});

// -------- NOTES: доступ по ролям --------

// Список заметок, доступных пользователю (по его максимальной роли)
app.get("/notes", async (req, res) => {
  const userId = req.query.userId;
  if (!userId) {
    return res.status(400).json({
      status: "error",
      message: "userId query param is required"
    });
  }

  try {
    const userRank = await getUserMaxRoleRank(userId);

    const result = await pool.query(
      "SELECT id, owner_user_id, title, body, min_role, created_at, updated_at FROM notes ORDER BY created_at DESC"
    );

    const visibleNotes = result.rows.filter((note) => {
      const requiredRank = getRoleRank(note.min_role);
      // Пользователь может читать заметку, если его ранг >= требуемого
      return userRank >= requiredRank;
    });

    res.json({
      status: "ok",
      user_id: userId,
      user_max_role_rank: userRank,
      count: visibleNotes.length,
      notes: visibleNotes
    });
  } catch (err) {
    console.error("Error in GET /notes:", err);
    res.status(500).json({
      status: "error",
      message: err.message
    });
  }
});

// Создание заметки. Создавать можно только в пределах своей максимальной роли.
app.post("/notes", async (req, res) => {
  const userId = req.query.userId;
  if (!userId) {
    return res.status(400).json({
      status: "error",
      message: "userId query param is required"
    });
  }

  const { title, body, min_role } = req.body || {};

  if (!title || !body || !min_role) {
    return res.status(400).json({
      status: "error",
      message: "title, body and min_role are required"
    });
  }

  const normalizedRole = String(min_role).toUpperCase();
  const requiredRank = getRoleRank(normalizedRole);

  if (requiredRank === 0) {
    return res.status(400).json({
      status: "error",
      message: `Unknown min_role: ${min_role}`
    });
  }

  try {
    const userRank = await getUserMaxRoleRank(userId);

    if (userRank === 0) {
      return res.status(403).json({
        status: "forbidden",
        message: "User has no valid roles for note creation"
      });
    }

    if (requiredRank > userRank) {
      return res.status(403).json({
        status: "forbidden",
        message: `You cannot create a note with min_role ${normalizedRole} higher than your max role`
      });
    }

    const insertRes = await pool.query(
      `INSERT INTO notes (owner_user_id, title, body, min_role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, owner_user_id, title, body, min_role, created_at, updated_at`,
      [userId, title, body, normalizedRole]
    );

    res.status(201).json({
      status: "ok",
      note: insertRes.rows[0]
    });
  } catch (err) {
    console.error("Error in POST /notes:", err);
    res.status(500).json({
      status: "error",
      message: err.message
    });
  }
});

app.get("/notes/:id", async (req, res) => {
  const userId = req.query.userId;
  const noteId = req.params.id;

  if (!userId) {
    return res.status(400).json({
      status: "error",
      message: "userId query param is required"
    });
  }

  try {
    const noteRes = await pool.query(
      "SELECT id, owner_user_id, title, body, min_role, created_at, updated_at FROM notes WHERE id = $1",
      [noteId]
    );

    if (noteRes.rowCount === 0) {
      return res.status(404).json({
        status: "error",
        message: "Note not found"
      });
    }

    const note = noteRes.rows[0];
    const requiredRank = getRoleRank(note.min_role);
    const userRank = await getUserMaxRoleRank(userId);

    if (userRank < requiredRank) {
      return res.status(403).json({
        status: "forbidden",
        message: "Insufficient role to read this note"
      });
    }

    res.json({
      status: "ok",
      note
    });
  } catch (err) {
    console.error("Error in GET /notes/:id:", err);
    res.status(500).json({
      status: "error",
      message: err.message
    });
  }
});

app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
