// const { Pool } = require("pg");

// const pool = new Pool({
//     host: process.env.DB_HOST || "192.168.2.61",
//     port: process.env.DB_PORT || 5432,
//     database: process.env.DB_NAME || "task_tracker",
//     user: process.env.DB_USER,
//     password: process.env.DB_PASSWORD,
// });

// module.exports = pool;



const { Pool } = require("pg");
const path = require("path");

require("dotenv").config({
    path: path.resolve(__dirname, "../.env")
});

const pool = new Pool({
    ...(process.env.DATABASE_URL
        ? { connectionString: process.env.DATABASE_URL }
        : {
            host: process.env.DB_HOST || "192.168.2.61",
            port: Number(process.env.DB_PORT || 5432),
            database: process.env.DB_NAME || "task_tracker",
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
        }),
    ...(process.env.DATABASE_SSL === "true"
        ? { ssl: { rejectUnauthorized: true } }
        : {}),
    max: Number(process.env.DATABASE_POOL_MAX || 10),
});

pool.on("error", (err) => {
    console.error("Unexpected PostgreSQL error:", err);
});

module.exports = pool;
