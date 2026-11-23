
const pool = require("./config/db");

async function testConnection() {
    try {
        const result = await pool.query(
            "SELECT NOW(), current_database()"
        );

        console.log("PostgreSQL connected successfully!");
        console.log(result.rows[0]);
    } catch (err) {
        console.error("Connection failed:", err.message);
    } finally {
        await pool.end();
    }
}

testConnection();
