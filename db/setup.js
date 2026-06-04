const { neon } = require("@neondatabase/serverless");
const fs = require("fs");

const DATABASE_URL = process.env.DATABASE_URL;
const sql = neon(DATABASE_URL);

async function run() {
  console.log("=== Creating schema ===");
  const schema = fs.readFileSync(__dirname + "/schema.sql", "utf8");
  const statements = schema.split(";").map(s => s.trim()).filter(s => s.length > 5);
  for (const stmt of statements) {
    try {
      await sql(stmt);
      const preview = stmt.slice(0, 60).replace(/\n/g, " ");
      console.log("  OK: " + preview + "...");
    } catch (e) {
      console.log("  SKIP: " + e.message.slice(0, 80));
    }
  }

  console.log("\n=== Importing historical data ===");
  const importSQL = fs.readFileSync(__dirname + "/import-data.sql", "utf8");
  const lines = importSQL.split("\n").filter(l => l.startsWith("INSERT"));
  console.log(`  Total INSERT statements: ${lines.length}`);

  const BATCH = 50;
  let done = 0, errors = 0;
  for (let i = 0; i < lines.length; i += BATCH) {
    const batch = lines.slice(i, i + BATCH);
    const combined = batch.join(";\n");
    try {
      await sql(combined);
      done += batch.length;
    } catch (e) {
      for (const single of batch) {
        try {
          await sql(single);
          done++;
        } catch (e2) {
          errors++;
          if (errors <= 5) console.log("  ERR: " + e2.message.slice(0, 100));
        }
      }
    }
    if ((i + BATCH) % 500 === 0 || i + BATCH >= lines.length) {
      console.log(`  Progress: ${done}/${lines.length} done, ${errors} errors`);
    }
  }

  console.log("\n=== Verifying ===");
  const counts = await Promise.all([
    sql`SELECT COUNT(*) as c FROM daily_sales`,
    sql`SELECT COUNT(*) as c FROM caja`,
    sql`SELECT COUNT(*) as c FROM caja_fuerte`,
    sql`SELECT COUNT(*) as c FROM valle_control`,
    sql`SELECT COUNT(*) as c FROM prestamos`,
  ]);
  console.log(`  daily_sales: ${counts[0][0].c}`);
  console.log(`  caja:        ${counts[1][0].c}`);
  console.log(`  caja_fuerte: ${counts[2][0].c}`);
  console.log(`  valle:       ${counts[3][0].c}`);
  console.log(`  prestamos:   ${counts[4][0].c}`);

  const balances = await Promise.all([
    sql`SELECT saldo FROM caja ORDER BY id DESC LIMIT 1`,
    sql`SELECT saldo FROM caja_fuerte ORDER BY id DESC LIMIT 1`,
    sql`SELECT saldo FROM valle_control ORDER BY id DESC LIMIT 1`,
    sql`SELECT saldo FROM prestamos ORDER BY id DESC LIMIT 1`,
  ]);
  console.log(`\n  Caja balance:       ${balances[0][0]?.saldo}`);
  console.log(`  Caja Fuerte balance: ${balances[1][0]?.saldo}`);
  console.log(`  Valle balance:       ${balances[2][0]?.saldo}`);
  console.log(`  Prestamos balance:   ${balances[3][0]?.saldo}`);

  console.log("\n=== DONE ===");
}

run().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
