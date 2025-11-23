const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
  user: process.env.DB_USER || "app",
  password: process.env.DB_PASSWORD || "secret",
  database: process.env.DB_NAME || "appdb"
});

module.exports = pool;
