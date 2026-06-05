const { getSQL, ok, err, options } = require("./_db");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();
  const sql = getSQL();
  const params = event.queryStringParameters || {};
  const table = params.table;
  const limit = Math.min(parseInt(params.limit) || 500, 5000);
  const offset = parseInt(params.offset) || 0;

  try {
    if (table === "daily_sales") {
      const from = params.from || "2026-01-01";
      const to = params.to || "2099-12-31";
      const rows = await sql`SELECT * FROM daily_sales WHERE sale_date >= ${from} AND sale_date <= ${to} ORDER BY sale_date DESC, store LIMIT ${limit} OFFSET ${offset}`;
      return ok(rows);
    }
    if (table === "caja") {
      const from = params.from || "2026-01-01";
      const to = params.to || "2099-12-31";
      const rows = await sql`SELECT * FROM caja WHERE tx_date >= ${from} AND tx_date <= ${to} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`;
      const bal = await sql`SELECT saldo FROM caja ORDER BY id DESC LIMIT 1`;
      return ok({ rows, balance: bal[0]?.saldo || 0 });
    }
    if (table === "caja_fuerte") {
      const rows = await sql`SELECT * FROM caja_fuerte ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`;
      const bal = await sql`SELECT saldo FROM caja_fuerte ORDER BY id DESC LIMIT 1`;
      return ok({ rows, balance: bal[0]?.saldo || 0 });
    }
    if (table === "nomina") {
      const rows = await sql`SELECT * FROM nomina ORDER BY pay_date DESC, store LIMIT ${limit}`;
      return ok(rows);
    }
    if (table === "prestamos") {
      const rows = await sql`SELECT * FROM prestamos ORDER BY id DESC LIMIT ${limit}`;
      const bal = await sql`SELECT saldo FROM prestamos ORDER BY id DESC LIMIT 1`;
      return ok({ rows, balance: bal[0]?.saldo || 0 });
    }
    if (table === "valle_control") {
      const rows = await sql`SELECT * FROM valle_control ORDER BY id DESC LIMIT ${limit}`;
      const bal = await sql`SELECT saldo FROM valle_control ORDER BY id DESC LIMIT 1`;
      return ok({ rows, balance: bal[0]?.saldo || 0 });
    }
    if (table === "categories") {
      const rows = await sql`SELECT DISTINCT category FROM account_categories ORDER BY category`;
      return ok(rows.map(r => r.category));
    }
    if (table === "sub_accounts") {
      const cat = params.category;
      const rows = await sql`SELECT sub_account FROM account_categories WHERE category = ${cat} ORDER BY sub_account`;
      return ok(rows.map(r => r.sub_account));
    }
    if (table === "employees") {
      const rows = await sql`SELECT * FROM employees WHERE active = true ORDER BY store, name`;
      return ok(rows);
    }
    if (table === "tarjeta") {
      const from = params.from || "2020-01-01";
      const to = params.to || "2099-12-31";
      const rows = await sql`SELECT * FROM tarjeta_diaria WHERE tx_date >= ${from} AND tx_date <= ${to} ORDER BY tx_date DESC, store LIMIT ${limit}`;
      const totals = await sql`SELECT SUM(amount) as total FROM tarjeta_diaria WHERE tx_date >= ${from} AND tx_date <= ${to}`;
      return ok({ rows, total: totals[0]?.total || 0 });
    }
    if (table === "transferencia") {
      const from = params.from || "2020-01-01";
      const to = params.to || "2099-12-31";
      const rows = await sql`SELECT * FROM transferencia_diaria WHERE tx_date >= ${from} AND tx_date <= ${to} ORDER BY tx_date DESC, store LIMIT ${limit}`;
      const totals = await sql`SELECT SUM(amount) as total FROM transferencia_diaria WHERE tx_date >= ${from} AND tx_date <= ${to}`;
      return ok({ rows, total: totals[0]?.total || 0 });
    }
    if (table === "summary") {
      const today = params.date || new Date().toISOString().slice(0, 10);
      const sales = await sql`SELECT store, venta, total_venta, deposito, gastos FROM daily_sales WHERE sale_date = ${today}`;
      const cajabal = await sql`SELECT saldo FROM caja ORDER BY id DESC LIMIT 1`;
      const cfbal = await sql`SELECT saldo FROM caja_fuerte ORDER BY id DESC LIMIT 1`;
      return ok({ date: today, sales, caja_balance: cajabal[0]?.saldo || 0, caja_fuerte_balance: cfbal[0]?.saldo || 0 });
    }
    return err("Unknown table: " + table, 400);
  } catch (e) { return err(e.message); }
};
