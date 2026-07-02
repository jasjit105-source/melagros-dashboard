const { getSQL, ok, err, options } = require("./_db");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();
  if (event.httpMethod !== "POST") return err("POST only", 405);
  const sql = getSQL();

  try {
    const body = JSON.parse(event.body);
    const action = body.action;

    if (action === "save_daily_sales") {
      const { sale_date, store, abono1, abono2, abono3, otro_venta, gastos } = body;
      // Only update the fields the girl fills in manually (Abonos, Gastos, Otro)
      // Preserve Corte-filled fields (cb, venta, total_venta, tarjeta, mayoreo, cb_next)
      const existing = await sql`SELECT * FROM daily_sales WHERE sale_date = ${sale_date} AND store = ${store} LIMIT 1`;
      const prev = existing[0] || {};

      // A field left BLANK keeps the previous (Corte) value; an explicit 0 is respected.
      const given = v => v !== undefined && v !== null && v !== '';
      const pick = (bodyVal, prevVal) => given(bodyVal) ? (Number(bodyVal) || 0) : (Number(prevVal) || 0);

      const cb = pick(body.cb, prev.cb);
      const venta = pick(body.venta, prev.venta);
      const otro = pick(otro_venta, prev.otro_venta);
      const total_venta = cb + venta + otro;
      const g = pick(gastos, prev.gastos);
      const gastosManual = given(gastos) && Number(gastos) !== Number(prev.gastos || 0) ? true : (prev.gastos_manual || false);
      const a1 = pick(abono1, prev.abono1);
      const a2 = pick(abono2, prev.abono2);
      const a3 = pick(abono3, prev.abono3);
      const tarjeta = pick(body.tarjeta, prev.tarjeta);
      const mayoreo = pick(body.mayoreo, prev.mayoreo);
      const deposito = a1 + a2 + a3;
      const cb_next = Number(prev.cb_next) || (total_venta - g - deposito - tarjeta - mayoreo);

      const rows = await sql`
        INSERT INTO daily_sales (sale_date, store, cb, venta, otro_venta, total_venta, gastos, gastos_manual, abono1, abono2, abono3, tarjeta, mayoreo, cb_next, deposito, source)
        VALUES (${sale_date}, ${store}, ${cb}, ${venta}, ${otro}, ${total_venta}, ${g}, ${gastosManual}, ${a1}, ${a2}, ${a3}, ${tarjeta}, ${mayoreo}, ${cb_next}, ${deposito}, ${prev.source || 'manual'})
        ON CONFLICT (sale_date, store) DO UPDATE SET
          cb = EXCLUDED.cb, venta = EXCLUDED.venta, otro_venta = EXCLUDED.otro_venta,
          total_venta = EXCLUDED.total_venta, gastos = EXCLUDED.gastos, gastos_manual = EXCLUDED.gastos_manual,
          abono1 = EXCLUDED.abono1, abono2 = EXCLUDED.abono2, abono3 = EXCLUDED.abono3,
          tarjeta = EXCLUDED.tarjeta, mayoreo = EXCLUDED.mayoreo,
          cb_next = EXCLUDED.cb_next, deposito = EXCLUDED.deposito,
          updated_at = NOW()
        RETURNING *`;

      // Auto-update Caja "abono tienda" with total cash (Abono1+2+3) from ALL stores
      const allSales = await sql`SELECT abono1, abono2, abono3 FROM daily_sales WHERE sale_date = ${sale_date}`;
      const totalCash = allSales.reduce((sum, s) => sum + (Number(s.abono1)||0) + (Number(s.abono2)||0) + (Number(s.abono3)||0), 0);
      const existingCaja = await sql`SELECT id FROM caja WHERE tx_date = ${sale_date} AND LOWER(account) = 'tienda centro' AND LOWER(description) = 'abono tienda' LIMIT 1`;
      if (existingCaja.length > 0) {
        await sql`UPDATE caja SET abono = ${totalCash}, updated_at = NOW() WHERE id = ${existingCaja[0].id}`;
      } else if (totalCash > 0) {
        const lb = await sql`SELECT saldo FROM caja ORDER BY id DESC LIMIT 1`;
        await sql`INSERT INTO caja (tx_date, category, account, description, abono, gasto, saldo) VALUES (${sale_date}, 'Abono', 'Tienda Centro', 'abono tienda', ${totalCash}, 0, ${(Number(lb[0]?.saldo)||0) + totalCash})`;
      }

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

    if (action === "update_daily_sales") {
      const { id } = body;
      const fields = ['cb','venta','otro_venta','gastos','abono1','abono2','abono3','tarjeta','mayoreo'];
      const existing = await sql`SELECT * FROM daily_sales WHERE id = ${id}`;
      if (!existing.length) return err("Row not found", 404);
      const row = existing[0];
      const vals = {};
      fields.forEach(f => { vals[f] = body[f] !== undefined ? Number(body[f])||0 : Number(row[f])||0; });
      vals.total_venta = vals.cb + vals.venta + vals.otro_venta;
      const deposito = vals.abono1 + vals.abono2 + vals.abono3;
      vals.cb_next = vals.total_venta - vals.gastos - deposito - vals.tarjeta - vals.mayoreo;
      const gastosManual = body.gastos !== undefined && Number(body.gastos) !== Number(row.gastos || 0) ? true : (row.gastos_manual || false);
      const rows = await sql`
        UPDATE daily_sales SET
          cb=${vals.cb}, venta=${vals.venta}, otro_venta=${vals.otro_venta},
          total_venta=${vals.total_venta}, gastos=${vals.gastos}, gastos_manual=${gastosManual},
          abono1=${vals.abono1}, abono2=${vals.abono2}, abono3=${vals.abono3},
          tarjeta=${vals.tarjeta}, mayoreo=${vals.mayoreo},
          cb_next=${vals.cb_next}, deposito=${deposito},
          updated_at=NOW()
        WHERE id = ${id} RETURNING *`;

      // Keep Caja "abono tienda" in sync when Abonos are edited here
      const saleDate = row.sale_date;
      const allSales = await sql`SELECT abono1, abono2, abono3 FROM daily_sales WHERE sale_date = ${saleDate}`;
      const totalCash = allSales.reduce((s, r2) => s + (Number(r2.abono1)||0) + (Number(r2.abono2)||0) + (Number(r2.abono3)||0), 0);
      const cajaRow = await sql`SELECT id FROM caja WHERE tx_date = ${saleDate} AND LOWER(account) = 'tienda centro' AND LOWER(description) = 'abono tienda' LIMIT 1`;
      if (cajaRow.length > 0) {
        await sql`UPDATE caja SET abono = ${totalCash}, updated_at = NOW() WHERE id = ${cajaRow[0].id}`;
      } else if (totalCash > 0) {
        await sql`INSERT INTO caja (tx_date, category, account, description, abono, gasto, saldo) VALUES (${saleDate}, 'Abono', 'Tienda Centro', 'abono tienda', ${totalCash}, 0, 0)`;
      }

      return ok(rows[0]);
    }

    if (action === "update_caja") {
      const { id, abono, gasto, description } = body;
      const rows = await sql`
        UPDATE caja SET
          abono = ${Number(abono)||0},
          gasto = ${Number(gasto)||0},
          description = COALESCE(${description}, description),
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING *`;
      if (!rows.length) return err("Row not found", 404);
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
      if (table === "caja") await sql`DELETE FROM caja WHERE id = ${id}`;
      else if (table === "caja_fuerte") await sql`DELETE FROM caja_fuerte WHERE id = ${id}`;
      else if (table === "nomina") await sql`DELETE FROM nomina WHERE id = ${id}`;
      else if (table === "prestamos") await sql`DELETE FROM prestamos WHERE id = ${id}`;
      else if (table === "valle_control") await sql`DELETE FROM valle_control WHERE id = ${id}`;
      else if (table === "daily_sales") await sql`DELETE FROM daily_sales WHERE id = ${id}`;
      else return err("Cannot delete from " + table, 400);
      return ok({ deleted: true });
    }

    return err("Unknown action: " + action, 400);
  } catch (e) { return err(e.message); }
};
