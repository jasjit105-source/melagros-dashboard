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
          corte_raw = EXCLUDED.corte_raw,
          source = 'corte',
          updated_at = NOW()
        RETURNING *`;

      results.push({ store, parsed: p, saved: rows[0] });
    }

    return ok({ fecha, synced: results.length, results });
  } catch (e) { return err(e.message); }
};
