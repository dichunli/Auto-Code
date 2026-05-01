const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const sqlFile = path.join(__dirname, '..', 'supabase', 'migrations', '20260501000003_p0_security_fixes.sql');
const sql = fs.readFileSync(sqlFile, 'utf8');

const client = new Client({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '54322', 10),
  database: process.env.PGDATABASE || 'postgres',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
});

async function main() {
  try {
    await client.connect();
    console.log('Connected to PostgreSQL');
    await client.query(sql);
    console.log('P0 migration applied successfully!');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
