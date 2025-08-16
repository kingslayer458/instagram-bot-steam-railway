import fs from "fs/promises";
import pkg from "pg";

const { Client } = pkg;

async function migrateHistory() {
  // Load local history file
  let localHistory = [];
  try {
    const data = await fs.readFile("./posted_history.json", "utf-8");
    localHistory = JSON.parse(data);
  } catch (err) {
    console.log("⚠️ No local posted_history.json found, skipping migration.");
    return;
  }

  // Connect to PostgreSQL
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Ensure table exists
  await client.query(`
    CREATE TABLE IF NOT EXISTS posted_screenshots (
      screenshot_url VARCHAR(500) PRIMARY KEY,
      posted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Insert old history
  for (const url of localHistory) {
    await client.query(
      `INSERT INTO posted_screenshots (screenshot_url) VALUES ($1) ON CONFLICT DO NOTHING`,
      [url]
    );
  }

  await client.end();
  console.log(`✅ Migrated ${localHistory.length} screenshots into PostgreSQL.`);
}

migrateHistory().catch(console.error);
