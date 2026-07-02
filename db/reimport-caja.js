const {neon} = require("@neondatabase/serverless");
const fs = require("fs");
const sql = neon(process.env.DATABASE_URL);

(async () => {
  // Read the import-data.sql and extract just the CAJA inserts
  // But first, re-extract from the CURRENT Excel file
  console.log("Step 1: Truncating old caja data...");
  await sql`TRUNCATE TABLE caja RESTART IDENTITY`;

  console.log("Step 2: Inserting opening balance...");
  await sql`INSERT INTO caja (tx_date, category, account, description, abono, gasto, saldo)
    VALUES ('2021-12-31', 'Abono', 'Apertura', 'Saldo de apertura', 50500, 0, 50500)`;

  console.log("Step 3: Re-importing from import-data.sql...");
  const importSQL = fs.readFileSync(__dirname + "/import-data.sql", "utf8");
  const lines = importSQL.split("\n").filter(l => l.startsWith("INSERT INTO caja "));
  console.log(`  Found ${lines.length} CAJA insert statements`);

  let done = 0, errors = 0;
  for (const line of lines) {
    try {
      await sql(line);
      done++;
    } catch (e) {
      errors++;
      if (errors <= 3) console.log(`  ERR: ${e.message.slice(0, 100)}`);
    }
  }
  console.log(`  Imported: ${done}, Errors: ${errors}`);

  // Now fix June 4 with the CORRECT values from the updated Excel
  console.log("\nStep 4: Fixing June 4 entries to match current Excel...");

  // Delete any June 4 entries that came from the old import (they had 0 amounts)
  await sql`DELETE FROM caja WHERE tx_date = '2026-06-04'`;

  // Insert the correct June 4 entries as per the user's Excel
  const jun4 = [
    ['Abono', 'Tienda Centro', 'abono tienda', 132650, 0],
    ['Abono', 'proyecto valle', 'Renta Circunvalacion', 0, 10000],
    ['Abono', 'Seva', 'Seva Dasvant', 0, 4000],
    ['Abono', 'JJ Ahorro', 'jasjit Singh', 0, 10000],
    ['nomina', 'Oyamil', 'SILVIA', 0, 1150],
    ['Abono', 'Caja Fuerte', 'Caja Fuerte', 0, 100000],
  ];
  for (const [cat, acct, desc, ab, ga] of jun4) {
    await sql`INSERT INTO caja (tx_date, category, account, description, abono, gasto, saldo)
      VALUES ('2026-06-04', ${cat}, ${acct}, ${desc}, ${ab}, ${ga}, 0)`;
  }
  console.log(`  Inserted ${jun4.length} correct June 4 entries`);

  // Verify
  const bal = await sql`SELECT SUM(COALESCE(abono,0) - COALESCE(gasto,0)) as net FROM caja`;
  const cnt = await sql`SELECT COUNT(*) as c FROM caja`;
  console.log(`\n=== RESULT ===`);
  console.log(`Total rows: ${cnt[0].c}`);
  console.log(`Computed balance: $${Number(bal[0].net).toLocaleString()}`);
  console.log(`Excel target:     $20,150`);
  console.log(`Match: ${Number(bal[0].net) === 20150 ? 'YES ✓' : 'NO — diff: $' + (Number(bal[0].net) - 20150).toLocaleString()}`);
})();
