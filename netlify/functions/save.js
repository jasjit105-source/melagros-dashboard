const { getSQL, ok, err, options } = require("./_db");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();
  if (event.httpMethod !== "POST") return err("POST only", 405);
  const sql = getSQL();

  try {
    const body = JSON.parse(event.body);
    const action = body.action;

    if (action === "save_daily_sales") {
      const { sale_date, store, cb, venta, otro_venta, gastos, abono1, abono2, abono3, tarjeta, mayoreo } = body;
      const total_venta = (Number(cb) || 0) + (Number(venta) || 0) + (Number(otro_venta) || 0);
      const deposito = (Number(abono1) || 0) + (Number(abono2) || 0) + (Number(abono3) || 0);
      const cb_next = total_venta - (Number(gastos) || 0) - deposito - (Number(tarjeta) || 0) - (Number(mayoreo) || 0);
      const rows = await sql`
        INSERT INTO daily_sales (sale_date, store, cb, venta, otro_venta, total_venta, gastos, abono1, abono2, abono3, tarjeta, mayoreo, cb_next, deposito, source)
        VALUES (${sale_date}, ${store}, ${cb||0}, ${venta||0}, ${otro_venta||0}, ${total_venta}, ${gastos||0}, ${abono1||0}, ${abono2||0}, ${abono3||0}, ${tarjeta||0}, ${mayoreo||0}, ${cb_next}, ${deposito}, 'manual')
        ON CONFLICT (sale_date, store) DO UPDATE SET
          cb = EXCLUDED.cb, venta = EXCLUDED.venta, otro_venta = EXCLUDED.otro_venta,
          total_venta = EXCLUDED.total_venta, gastos = EXCLUDED.gastos,
          abono1 = EXCLUDED.abono1, abono2 = EXCLUDED.abono2, abono3 = EXCLUDED.abono3,
          tarjeta = EXCLUDED.tarjeta, mayoreo = EXCLUDED.mayoreo,
          cb_next = EXCLUDED.cb_next, deposito = EXCLUDED.deposito,
          updated_at = NOW()
        RETURNING *`;
      return ok(rows[0]);
    }

    if (action === "save_caja") {
      const { tx_date, category, account, description, abono, gasto } = body;
      const lastBal = await sql`SELECT saldo FROM caja ORDER BY id DESC LIMIT 1`;
      const prev = Number(lastBal[0]?.saldo) || 0;
      const saldo = prev + (Number(abono) || 0) - (Number(gasto) || 0);
      const rows = await sql`
        INSERT INTO caja (tx_date, category, account, description, abono, gasto, saldo)
        VALUES (${tx_date}, ${category}, ${account}, ${description}, ${abono||0}, ${gasto||0}, ${saldo})
        RETURNING *`;
      return ok(rows[0]);
    }

    if (action === "save_caja_fuerte") {
      const { tx_date, description, deposit, debit } = body;
      const lastBal = await sql`SELECT saldo FROM caja_fuerte ORDER BY id DESC LIMIT 1`;
      const prev = Number(lastBal[0]?.saldo) || 0;
      const saldo = prev + (Number(deposit) || 0) - (Number(debit) || 0);
      const rows = await sql`
        INSERT INTO caja_fuerte (tx_date, description, deposit, debit, saldo)
        VALUES (${tx_date}, ${description}, ${deposit||0}, ${debit||0}, ${saldo})
        RETURNING *`;
      return ok(rows[0]);
    }

    if (action === "save_nomina") {
      const { pay_date, employee_name, store, amount, notes } = body;
      const rows = await sql`
        INSERT INTO nomina (pay_date, employee_name, store, amount, notes)
        VALUES (${pay_date}, ${employee_name}, ${store}, ${amount||0}, ${notes||''})
        RETURNING *`;
      return ok(rows[0]);
    }

    if (action === "save_prestamo") {
      const { tx_date, description, abono, gasto, account_name } = body;
      const acct = account_name || 'JJ Ahorro';
      const lastBal = await sql`SELECT saldo FROM prestamos WHERE account_name = ${acct} ORDER BY id DESC LIMIT 1`;
      const prev = Number(lastBal[0]?.saldo) || 0;
      const saldo = prev + (Number(abono) || 0) - (Number(gasto) || 0);
      const rows = await sql`
        INSERT INTO prestamos (account_name, tx_date, description, abono, gasto, saldo)
        VALUES (${acct}, ${tx_date}, ${description}, ${abono||0}, ${gasto||0}, ${saldo})
        RETURNING *`;
      return ok(rows[0]);
    }

    if (action === "save_valle") {
      const { tx_date, description, abono, gasto } = body;
      const lastBal = await sql`SELECT saldo FROM valle_control ORDER BY id DESC LIMIT 1`;
      const prev = Number(lastBal[0]?.saldo) || 0;
      const saldo = prev + (Number(abono) || 0) - (Number(gasto) || 0);
      const rows = await sql`
        INSERT INTO valle_control (tx_date, description, abono, gasto, saldo)
        VALUES (${tx_date}, ${description}, ${abono||0}, ${gasto||0}, ${saldo})
        RETURNING *`;
      return ok(rows[0]);
    }

    if (action === "save_employee") {
      const { name, store, salary, start_date } = body;
      const rows = await sql`
        INSERT INTO employees (name, store, salary, start_date)
        VALUES (${name}, ${store}, ${salary||0}, ${start_date})
        RETURNING *`;
      return ok(rows[0]);
    }

    if (action === "delete_row") {
      const { table, id } = body;
      const allowed = ["caja", "caja_fuerte", "nomina", "prestamos", "valle_control", "daily_sales"];
      if (!allowed.includes(table)) return err("Cannot delete from " + table, 400);
      await sql`DELETE FROM ${sql(table)} WHERE id = ${id}`;
      return ok({ deleted: true });
    }

    return err("Unknown action: " + action, 400);
  } catch (e) { return err(e.message); }
};
