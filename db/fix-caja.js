const {neon} = require("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);
(async () => {
  // 1. Add opening balance as the first entry
  console.log("1. Adding opening balance of $50,500...");
  const firstEntry = await sql`SELECT id FROM caja ORDER BY id LIMIT 1`;
  if (firstEntry.length) {
    // Check if opening balance already exists
    const ob = await sql`SELECT id FROM caja WHERE description = 'Saldo de apertura' LIMIT 1`;
    if (!ob.length) {
      await sql`INSERT INTO caja (id, tx_date, category, account, description, abono, gasto, saldo)
        VALUES (0, '2021-12-31', 'Abono', 'Apertura', 'Saldo de apertura', 50500, 0, 50500)`;
      console.log("   Inserted opening balance: $50,500");
    } else {
      console.log("   Opening balance already exists");
    }
  }

  // 2. Fix Valle: $15,000 → $10,000 for June 4
  console.log("2. Fixing Valle June 4: $15,000 → $10,000...");
  await sql`UPDATE caja SET gasto = 10000 WHERE id = 6367`;
  console.log("   Done");

  // 3. Fix Seva: $10,000 → $4,000 for June 4
  console.log("3. Fixing Seva June 4: $10,000 → $4,000...");
  await sql`UPDATE caja SET gasto = 4000 WHERE id = 6368`;
  console.log("   Done");

  // 4. Add missing entries for June 4
  console.log("4. Adding missing June 4 entries...");
  const silvia = await sql`SELECT id FROM caja WHERE tx_date = '2026-06-04' AND LOWER(description) LIKE '%silvia%' LIMIT 1`;
  if (!silvia.length) {
    await sql`INSERT INTO caja (tx_date, category, account, description, abono, gasto, saldo)
      VALUES ('2026-06-04', 'nomina', 'Oyamil', 'SILVIA', 0, 1150, 0)`;
    console.log("   Added nomina Silvia: -$1,150");
  }
  const cf = await sql`SELECT id FROM caja WHERE tx_date = '2026-06-04' AND LOWER(description) LIKE '%caja fuerte%' LIMIT 1`;
  if (!cf.length) {
    await sql`INSERT INTO caja (tx_date, category, account, description, abono, gasto, saldo)
      VALUES ('2026-06-04', 'Abono', 'Caja Fuerte', 'Caja Fuerte', 0, 100000, 0)`;
    console.log("   Added Caja Fuerte: -$100,000");
  }

  // 5. Verify final balance
  const bal = await sql`SELECT SUM(COALESCE(abono,0) - COALESCE(gasto,0)) as net FROM caja`;
  console.log(`\nFinal computed balance: $${Number(bal[0].net).toLocaleString()}`);
  console.log(`Excel target:          $20,150`);
  console.log(`Match: ${Number(bal[0].net) === 20150 ? 'YES ✓' : 'NO — diff: ' + (Number(bal[0].net) - 20150)}`);
})();
