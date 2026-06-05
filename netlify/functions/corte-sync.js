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

function parseCorteReceipt(data) {
  const allText = data.map(r => r.cadenaSalida || '').join('\n');

  // === INGRESOS ===
  const cb = parseAmount(allText, /Inicial en Caja:\s*\$?([\d,]+(?:\.\d+)?)/i);
  const venta = parseAmount(allText, /Ingresos por Ventas:\s*\$?([\d,]+(?:\.\d+)?)/i);
  const totalIngresos = parseAmount(allText, /Total de Ingresos:\s*\$?([\d,]+(?:\.\d+)?)/i);
  const tarjeta = parseAmount(allText, /Total en Tarjetas:\s*\$?([\d,]+(?:\.\d+)?)/i);
  const transfer = parseAmount(allText, /Total en Transfer:\s*\$?([\d,]+(?:\.\d+)?)/i);
  const efectivo = parseAmount(allText, /Total en Efectivo:\s*\$?([\d,]+(?:\.\d+)?)/i);
  const cobranza = parseAmount(allText, /Ingresos por cobranza:\s*\$?([\d,]+(?:\.\d+)?)/i);

  // === EGRESOS — separate gastos from retiros ===
  const sumaGastos = parseAmount(allText, /Suma de Gastos:\s*\$?([\d,]+(?:\.\d+)?)/i);
  const sumaRetiro = parseAmount(allText, /Suma de Retiro:\s*\$?([\d,]+(?:\.\d+)?)/i);
  const totalEgresos = parseAmount(allText, /Total de Egresos:\s*\$?([\d,]+(?:\.\d+)?)/i);

  // === DEPOSITOS BANCARIOS ===
  const totalDepositos = parseAmount(allText, /Total Depositos:\s*\$?([\d,]+(?:\.\d+)?)/i);

  // === TOTAL EN CAJA (cash left for tomorrow = cb_next) ===
  const totalEnCaja = parseAmount(allText, /Total en caja:\s*\$?([\d,]+(?:\.\d+)?)/i);

  // === CORTE NUMBER ===
  const corteNum = data[0]?.numeroCorte || 0;

  // DB fields as fallback
  const totalCajaDB = data.reduce((a, r) => a + (Number(r.totalCaja) || 0), 0);
  const totalIngresosDB = data.reduce((a, r) => a + (Number(r.totalIngresos) || 0), 0);

  return {
    corte_num: corteNum,
    cb,
    venta: venta || 0,
    total_venta: totalIngresos || totalIngresosDB,
    tarjeta,
    transfer,
    efectivo,
    cobranza,
    // Gastos = only store expenses (parking, shipping, etc), NOT retiros
    gastos: sumaGastos,
    retiro: sumaRetiro,
    total_egresos: totalEgresos,
    // Depositos bancarios from the receipt
    depositos_bancarios: totalDepositos,
    // Cash left in register = tomorrow's CB
    cb_next: totalEnCaja || totalCajaDB,
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
          gastos = EXCLUDED.gastos,
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

      // 1. Total deposit from all stores → Abono / Tienda Centro / "abono tienda"
      const totalDeposit = results.reduce((a, r) => {
        const p = r.parsed;
        return a + p.retiro + p.depositos_bancarios;
      }, 0);

      // 2. Total ventas across all stores (for Seva 5% calc)
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
          SELECT id FROM caja
          WHERE tx_date = ${fecha} AND LOWER(account) = LOWER(${account}) AND LOWER(description) = LOWER(${description})
          LIMIT 1`;

        if (existing.length > 0) {
          // Update existing — recalculate saldo from scratch after
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

      // Post "abono tienda" — income from stores
      if (totalDeposit > 0) {
        const existingAbono = await sql`
          SELECT id FROM caja
          WHERE tx_date = ${fecha} AND LOWER(account) = 'tienda centro' AND LOWER(description) = 'abono tienda'
          LIMIT 1`;
        if (existingAbono.length > 0) {
          await sql`UPDATE caja SET abono = ${totalDeposit}, updated_at = NOW() WHERE id = ${existingAbono[0].id}`;
          cajaEntries.push({ type: 'abono tienda', amount: totalDeposit, action: 'updated' });
        } else {
          saldo = saldo + totalDeposit;
          await sql`
            INSERT INTO caja (tx_date, category, account, description, abono, gasto, saldo)
            VALUES (${fecha}, 'Abono', 'Tienda Centro', 'abono tienda', ${totalDeposit}, 0, ${saldo})`;
          cajaEntries.push({ type: 'abono tienda', amount: totalDeposit, action: 'inserted' });
        }
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

      return ok({ fecha, synced: results.length, results, cajaEntries, totalVentas, totalDeposit, sevaAmount });
    }

    return ok({ fecha, synced: results.length, results });
  } catch (e) { return err(e.message); }
};
