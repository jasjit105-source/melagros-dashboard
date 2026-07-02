const { getSQL, ok, err, options } = require("./_db");

const SQL_PROXY = "https://aggrievedly-spryest-hattie.ngrok-free.dev";
const SQL_TOKEN = "Sahiba_CZSfEghwaD4s";

// Mexico City time — the girls and the POS are in CDMX
function getMexicoDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
}

async function runSQLQuery(query, params = {}) {
  let q = query;
  for (const [k, v] of Object.entries(params)) q = q.replace(`{{${k}}}`, v);
  const res = await fetch(SQL_PROXY + "/V1/query", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + SQL_TOKEN, "ngrok-skip-browser-warning": "true" },
    body: JSON.stringify({ query: q })
  });
  const data = await res.json();
  if (data.status === "error") throw new Error(data.message);
  return data.data || data;
}

const CORTE_CERCU = "SELECT numeroCorte,corte,cadenaSalida,ISNULL(totalVentas,0) AS totalVentas,estacion,usufecha,usuhora,ISNULL(totalIngresos,0) AS totalIngresos,ISNULL(totalEgresos,0) AS totalEgresos,ISNULL(totalCaja,0) AS totalCaja,ISNULL(ventasCredito,0) AS ventasCredito,ISNULL(valesEmitidos,0) AS valesEmitidos,ISNULL(valesCambio,0) AS valesCambio,ISNULL(ingresosCobranza,0) AS ingresosCobranza,ISNULL(totalVentasUnidades,0) AS totalVentasUnidades,ISNULL(clientesAtendidos,0) AS clientesAtendidos,ISNULL(cajero,'') AS cajero,ISNULL(importeCajero,0) AS importeCajero FROM CORTESZX_C WHERE usufecha='{{fecha}}' ORDER BY numeroCorte";
const CORTE_LEONA = "SELECT numeroCorte,corte,cadenaSalida,ISNULL(totalVentas,0) AS totalVentas,estacion,usufecha,usuhora,ISNULL(totalIngresos,0) AS totalIngresos,ISNULL(totalEgresos,0) AS totalEgresos,ISNULL(totalCaja,0) AS totalCaja,ISNULL(ventasCredito,0) AS ventasCredito,ISNULL(valesEmitidos,0) AS valesEmitidos,ISNULL(valesCambio,0) AS valesCambio,ISNULL(ingresosCobranza,0) AS ingresosCobranza,ISNULL(totalVentasUnidades,0) AS totalVentasUnidades,ISNULL(clientesAtendidos,0) AS clientesAtendidos,ISNULL(cajero,'') AS cajero,ISNULL(importeCajero,0) AS importeCajero FROM CORTESZX_L WHERE usufecha='{{fecha}}' ORDER BY numeroCorte";

function parseAmount(text, pattern) {
  const match = text.match(pattern);
  if (!match) return 0;
  return Number(match[1].replace(/,/g, '')) || 0;
}

// Parse ONE register's receipt text
function parseOneRegister(text) {
  return {
    cb: parseAmount(text, /Inicial en Caja:\s*\$?([\d,]+(?:\.\d+)?)/i),
    venta: parseAmount(text, /Ingresos por Ventas:\s*\$?([\d,]+(?:\.\d+)?)/i),
    totalIngresos: parseAmount(text, /Total de Ingresos:\s*\$?([\d,]+(?:\.\d+)?)/i),
    tarjeta: parseAmount(text, /Total en Tarjetas:\s*\$?([\d,]+(?:\.\d+)?)/i),
    transfer: parseAmount(text, /Total en Transfer:\s*\$?([\d,]+(?:\.\d+)?)/i),
    efectivo: parseAmount(text, /Total en Efectivo:\s*\$?([\d,]+(?:\.\d+)?)/i),
    cobranza: parseAmount(text, /Ingresos por cobranza:\s*\$?([\d,]+(?:\.\d+)?)/i),
    sumaGastos: parseAmount(text, /Suma de Gastos:\s*\$?([\d,]+(?:\.\d+)?)/i),
    sumaRetiro: parseAmount(text, /Suma de Retiro:\s*\$?([\d,]+(?:\.\d+)?)/i),
    totalEgresos: parseAmount(text, /Total de Egresos:\s*\$?([\d,]+(?:\.\d+)?)/i),
    totalDepositos: parseAmount(text, /Total Depositos:\s*\$?([\d,]+(?:\.\d+)?)/i),
    totalEnCaja: parseAmount(text, /Total en caja:\s*\$?([\d,]+(?:\.\d+)?)/i),
  };
}

// A store can close the register more than once in a day (Corte Z #n, #n+1).
// Parse each register separately and SUM — a single joined-text regex would
// only capture the first receipt and undercount the day.
function parseCorteReceipt(data) {
  const regs = data.map(r => parseOneRegister(r.cadenaSalida || ''));
  const sum = key => regs.reduce((a, r) => a + (r[key] || 0), 0);

  // DB fields as fallback
  const totalCajaDB = data.reduce((a, r) => a + (Number(r.totalCaja) || 0), 0);
  const totalIngresosDB = data.reduce((a, r) => a + (Number(r.totalIngresos) || 0), 0);

  return {
    corte_num: data[0]?.numeroCorte || 0,
    // CB = opening cash of the FIRST register of the day
    cb: regs[0]?.cb || 0,
    venta: sum('venta'),
    total_venta: sum('totalIngresos') || totalIngresosDB,
    tarjeta: sum('tarjeta'),
    transfer: sum('transfer'),
    efectivo: sum('efectivo'),
    cobranza: sum('cobranza'),
    // Gastos = only store expenses (parking, shipping, etc), NOT retiros
    gastos: sum('sumaGastos'),
    retiro: sum('sumaRetiro'),
    total_egresos: sum('totalEgresos'),
    depositos_bancarios: sum('totalDepositos'),
    // Cash left for tomorrow = LAST register's "Total en caja"
    cb_next: regs[regs.length - 1]?.totalEnCaja || totalCajaDB,
    registers: data.length,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();
  const sql = getSQL();

  try {
    const body = event.httpMethod === "POST" ? JSON.parse(event.body) : {};
    // Use Mexico City time as default, not UTC
    const fecha = body.fecha || getMexicoDate();

    const [cercuData, leonaData] = await Promise.all([
      runSQLQuery(CORTE_CERCU, { fecha }).catch(() => []),
      runSQLQuery(CORTE_LEONA, { fecha }).catch(() => [])
    ]);

    const results = [];

    for (const [store, data] of [["Circunvalacion", cercuData], ["Leona Vicario", leonaData]]) {
      if (!data || !data.length) continue;

      const p = parseCorteReceipt(data);

      // deposito = retiro + depositos_bancarios (cash the girl took out of register)
      const deposito = p.retiro + p.depositos_bancarios;

      const rows = await sql`
        INSERT INTO daily_sales (
          sale_date, store, cb, venta, otro_venta, total_venta,
          gastos, tarjeta, mayoreo, cb_next, deposito,
          corte_raw, source
        ) VALUES (
          ${fecha}, ${store}, ${p.cb}, ${p.venta}, 0, ${p.total_venta},
          ${p.gastos}, ${p.tarjeta}, ${p.transfer}, ${p.cb_next}, ${deposito},
          ${JSON.stringify({ parsed: p, raw: data.map(r => ({ ...r, cadenaSalida: undefined })) })},
          'corte'
        )
        ON CONFLICT (sale_date, store) DO UPDATE SET
          cb = EXCLUDED.cb,
          venta = EXCLUDED.venta,
          total_venta = EXCLUDED.total_venta,
          -- Keep a manually-corrected gastos; otherwise take the Corte's value
          gastos = CASE WHEN COALESCE(daily_sales.gastos_manual, FALSE) THEN daily_sales.gastos ELSE EXCLUDED.gastos END,
          tarjeta = EXCLUDED.tarjeta,
          mayoreo = EXCLUDED.mayoreo,
          cb_next = EXCLUDED.cb_next,
          deposito = EXCLUDED.deposito,
          -- Preserve manually-entered Abonos — Corte never touches these
          abono1 = daily_sales.abono1,
          abono2 = daily_sales.abono2,
          abono3 = daily_sales.abono3,
          otro_venta = daily_sales.otro_venta,
          corte_raw = EXCLUDED.corte_raw,
          source = 'corte',
          updated_at = NOW()
        RETURNING *`;

      results.push({ store, parsed: p, saved: rows[0] });
    }

    // === AUTO-POST CAJA ENTRIES ===
    // Only if we actually synced stores
    if (results.length > 0) {
      const cajaEntries = [];

      // 1. Save Tarjeta and Transferencia to their own tables
      for (const r of results) {
        const p = r.parsed;
        if (p.tarjeta > 0) {
          await sql`INSERT INTO tarjeta_diaria (tx_date, store, amount) VALUES (${fecha}, ${r.store}, ${p.tarjeta})
            ON CONFLICT (tx_date, store) DO UPDATE SET amount = EXCLUDED.amount`;
        }
        if (p.transfer > 0) {
          await sql`INSERT INTO transferencia_diaria (tx_date, store, amount) VALUES (${fecha}, ${r.store}, ${p.transfer})
            ON CONFLICT (tx_date, store) DO UPDATE SET amount = EXCLUDED.amount`;
        }
      }

      // 2. Caja "abono tienda" = Sum of Abono1+2+3 from all stores (CASH ONLY)
      // Abonos are entered manually by the girl in Step 2, so at Corte sync time
      // we read whatever Abonos are already in daily_sales for this date
      const allSales = await sql`SELECT abono1, abono2, abono3 FROM daily_sales WHERE sale_date = ${fecha}`;
      const totalCashDeposit = allSales.reduce((a, r) => a + (Number(r.abono1)||0) + (Number(r.abono2)||0) + (Number(r.abono3)||0), 0);

      // 3. Total ventas across all stores (for Seva 5% calc)
      const totalVentas = results.reduce((a, r) => a + r.parsed.venta, 0);

      // 3. Seva = 5% of total ventas, rounded to nearest 100
      const sevaAmount = Math.round((totalVentas * 0.05) / 100) * 100;

      // Fixed daily amounts (editable — girl can change in Caja tab later)
      const VALLE_DAILY = 15000;
      const JJ_DAILY = 10000;

      // Get current caja balance
      const lastBal = await sql`SELECT saldo FROM caja ORDER BY id DESC LIMIT 1`;
      let saldo = Number(lastBal[0]?.saldo) || 0;

      // Helper: upsert a caja entry for this date+account (so re-sync doesn't duplicate)
      async function upsertCaja(category, account, description, gasto) {
        // Check if entry already exists for this date + account (case-insensitive)
        const existing = await sql`
          SELECT id, manual_edit FROM caja
          WHERE tx_date = ${fecha} AND LOWER(account) = LOWER(${account}) AND LOWER(description) = LOWER(${description})
          LIMIT 1`;

        if (existing.length > 0) {
          // Never overwrite an amount the girls edited by hand
          if (existing[0].manual_edit) {
            return { action: 'kept (manually edited)', id: existing[0].id };
          }
          await sql`
            UPDATE caja SET gasto = ${gasto}, updated_at = NOW()
            WHERE id = ${existing[0].id}`;
          return { action: 'updated', id: existing[0].id, gasto };
        } else {
          // Insert new
          saldo = saldo - gasto;
          await sql`
            INSERT INTO caja (tx_date, category, account, description, abono, gasto, saldo)
            VALUES (${fecha}, ${category}, ${account}, ${description}, 0, ${gasto}, ${saldo})`;
          return { action: 'inserted', gasto, saldo };
        }
      }

      // Post "abono tienda" — CASH ONLY (sum of Abono1+2+3 from all stores)
      const existingAbono = await sql`
        SELECT id, manual_edit FROM caja
        WHERE tx_date = ${fecha} AND LOWER(account) = 'tienda centro' AND LOWER(description) = 'abono tienda'
        LIMIT 1`;
      if (existingAbono.length > 0 && existingAbono[0].manual_edit) {
        cajaEntries.push({ type: 'abono tienda (cash)', action: 'kept (manually edited)' });
      } else if (existingAbono.length > 0) {
        await sql`UPDATE caja SET abono = ${totalCashDeposit}, updated_at = NOW() WHERE id = ${existingAbono[0].id}`;
        cajaEntries.push({ type: 'abono tienda (cash)', amount: totalCashDeposit, action: 'updated' });
      } else {
        saldo = saldo + totalCashDeposit;
        await sql`
          INSERT INTO caja (tx_date, category, account, description, abono, gasto, saldo)
          VALUES (${fecha}, 'Abono', 'Tienda Centro', 'abono tienda', ${totalCashDeposit}, 0, ${saldo})`;
        cajaEntries.push({ type: 'abono tienda (cash)', amount: totalCashDeposit, action: 'inserted' });
      }

      // Post Proyecto Valle / Renta Circunvalacion — 15,000 daily
      const valleResult = await upsertCaja('Abono', 'proyecto valle', 'Renta Circunvalacion', VALLE_DAILY);
      cajaEntries.push({ type: 'proyecto valle', amount: VALLE_DAILY, ...valleResult });

      // Post JJ Ahorro / Jasjit Singh — 10,000 daily
      const jjResult = await upsertCaja('Abono', 'JJ Ahorro', 'Jasjit Singh', JJ_DAILY);
      cajaEntries.push({ type: 'JJ Ahorro', amount: JJ_DAILY, ...jjResult });

      // Post Seva / Seva Dasvant — 5% of total ventas rounded to 100
      const sevaResult = await upsertCaja('Abono', 'Seva', 'Seva Dasvant', sevaAmount);
      cajaEntries.push({ type: 'Seva', amount: sevaAmount, pct: '5%', totalVentas, ...sevaResult });

      const totalTarjeta = results.reduce((a, r) => a + r.parsed.tarjeta, 0);
      const totalTransfer = results.reduce((a, r) => a + r.parsed.transfer, 0);
      return ok({ fecha, synced: results.length, results, cajaEntries, totalVentas, totalCashDeposit, totalTarjeta, totalTransfer, sevaAmount });
    }

    return ok({ fecha, synced: results.length, results });
  } catch (e) { return err(e.message); }
};
