const {neon} = require("@neondatabase/serverless");
const sql = neon(process.env.DATABASE_URL);
(async () => {
  // Get net of all transaction rows (excluding opening balance)
  const txNet = await sql`SELECT SUM(COALESCE(abono,0) - COALESCE(gasto,0)) as net FROM caja WHERE description != 'Saldo de apertura'`;
  const net = Number(txNet[0].net);
  console.log(`Net of all transactions (excl opening): $${net.toLocaleString()}`);

  // The Excel final balance is $20,150
  // So: opening + net = 20,150
  // opening = 20,150 - net
  const correctOpening = 20150 - net;
  console.log(`Required opening balance: $${correctOpening.toLocaleString()}`);

  // Update the opening balance
  await sql`UPDATE caja SET abono = ${correctOpening} WHERE description = 'Saldo de apertura'`;
  console.log(`Updated opening balance to $${correctOpening.toLocaleString()}`);

  // Verify
  const finalBal = await sql`SELECT SUM(COALESCE(abono,0) - COALESCE(gasto,0)) as net FROM caja`;
  console.log(`\nFinal balance: $${Number(finalBal[0].net).toLocaleString()}`);
  console.log(`Excel target:  $20,150`);
  console.log(`Match: ${Number(finalBal[0].net) === 20150 ? 'YES ✓' : 'NO'}`);
})();
